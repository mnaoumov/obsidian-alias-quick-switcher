import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  TARGET_FOLDER_ALIAS,
  TARGET_FOLDER_NOTE_PATH,
  TARGET_NOTE_ALIAS,
  TARGET_NOTE_PATH
} from '../scripts/helpers/generate-performance-vault.ts';

/*
 * The claim the whole design rests on, measured rather than asserted: this switcher answers a whole-vault
 * query fast enough to type into, at the scale it was written for.
 *
 * The vault this suite opens is generated to the ratios measured in the maintainer's own: ~36,000 notes,
 * folders in the same order of magnitude, 42% of notes aliased and 9% of folders carrying a folder note.
 * The last two matter — 42% is why "only scan aliased notes" is not a useful pre-filter, and 9% is why the
 * segment walk usually does not branch.
 *
 * Reachable ONLY via `npm run test:integration:desktop:performance`; never from a routine
 * `npm run test:integration` (G51).
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 600_000;

/**
 * The budget for one keystroke over the whole vault. Obsidian's own switcher does a full fuzzy scan of
 * every note on every key press and stays usable; a quarter of a second is the point at which typing stops
 * feeling immediate, so it is the bar rather than a number tuned to whatever the code happens to do.
 */
const KEYSTROKE_BUDGET_IN_MILLISECONDS = 250;

/**
 * Opening is a one-off: the candidate list is built and the folder-note setup re-resolved once per switcher
 * session, so it is allowed to cost more than a keystroke — but not so much that the modal appears late.
 */
const OPEN_BUDGET_IN_MILLISECONDS = 2000;

interface LatencyResult {
  readonly candidateCount: number;
  readonly maxKeystrokeInMilliseconds: number;
  readonly medianKeystrokeInMilliseconds: number;
  readonly openInMilliseconds: number;
  readonly wasTargetFound: boolean;
}

describe('Per-keystroke latency at real scale', () => {
  it('answers a whole-vault alias query fast enough to type into', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, pluginId, targetFolderAlias, targetFolderNotePath, targetNoteAlias, targetNotePath }): Promise<LatencyResult> {
        const WAIT_TIMEOUT_IN_MILLISECONDS = 300_000;
        const KEYSTROKE_COUNT = 9;
        const MIDDLE = 0.5;
        const MINIMUM_VAULT_SIZE = 1000;

        await waitUntil({
          message: 'the generated vault is indexed',
          predicate: () => app.vault.getMarkdownFiles().length > MINIMUM_VAULT_SIZE,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        // The file count says the vault is SCANNED; it says nothing about the frontmatter being parsed,
        // And this query is answerable only through aliases. The candidate list is built once when the
        // Switcher opens, so opening before the aliases land would memoize labels that lack them — and
        // Measure a query that matches nothing rather than the one this plugin exists for.
        await waitUntil({
          message: 'the target aliases are in the metadata cache',
          predicate: () => {
            const folderNote = app.vault.getFileByPath(targetFolderNotePath);
            const target = app.vault.getFileByPath(targetNotePath);
            if (!folderNote || !target) {
              return false;
            }

            return Boolean(app.metadataCache.getFileCache(folderNote)?.frontmatter)
              && Boolean(app.metadataCache.getFileCache(target)?.frontmatter);
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        await waitUntil({
          message: 'no switcher left open',
          predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        // Opening is where the candidate list is built and the folder-note setup re-resolved, so it is
        // Timed separately rather than folded into the first keystroke.
        const openStart = performance.now();
        app.commands.executeCommandById(`${pluginId}:open`);
        await waitUntil({
          message: 'the switcher is open',
          predicate: () => document.querySelector('.alias-quick-switcher-modal') !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const openInMilliseconds = performance.now() - openStart;

        const input = document.querySelector('.alias-quick-switcher-modal .prompt-input');
        if (!(input instanceof HTMLInputElement)) {
          throw new TypeError('The switcher has no input.');
        }

        // The query only this plugin can answer: a folder named by its folder note's alias, then a note
        // Named by its own. Typed one character at a time, because a keystroke is the unit being measured.
        const query = `${targetFolderAlias}/${targetNoteAlias}`;
        const durations: number[] = [];

        for (let length = query.length - KEYSTROKE_COUNT; length <= query.length; length++) {
          // A dispatched event rather than trusted input (G107): the harness's key path adds its own
          // Latency, which would be measured alongside the plugin's and drown it.
          input.value = query.slice(0, Math.max(length, 1));
          const start = performance.now();
          input.dispatchEvent(new Event('input', { bubbles: true }));
          durations.push(performance.now() - start);
        }

        const wasTargetFound = [...document.querySelectorAll('.suggestion-item')]
          .some((el) => el.textContent.includes(targetNoteAlias));
        const candidateCount = app.vault.getMarkdownFiles().length;

        // Trusted input, so the modal really receives the key the way a user's Escape reaches it.
        pressKey({ key: 'Escape' });

        const sorted = [...durations].sort((a, b) => a - b);

        return {
          candidateCount,
          maxKeystrokeInMilliseconds: sorted.at(-1) ?? 0,
          medianKeystrokeInMilliseconds: sorted[Math.floor(sorted.length * MIDDLE)] ?? 0,
          openInMilliseconds,
          wasTargetFound
        };
      },
      input: {
        pluginId: PLUGIN_ID,
        targetFolderAlias: TARGET_FOLDER_ALIAS,
        targetFolderNotePath: TARGET_FOLDER_NOTE_PATH,
        targetNoteAlias: TARGET_NOTE_ALIAS,
        targetNotePath: TARGET_NOTE_PATH
      }
    });

    // The measurements are not logged: a failing bound prints both sides, which is where the numbers
    // Matter, and the fleet forbids console output from plugin code and its suites alike.

    // The query is one no other switcher can answer, so finding the note is itself part of the measurement:
    // A fast run that found nothing would be measuring the pre-filter rejecting everything.
    expect(result.wasTargetFound).toBe(true);
    expect(result.candidateCount).toBeGreaterThan(1000);
    expect(result.medianKeystrokeInMilliseconds).toBeLessThan(KEYSTROKE_BUDGET_IN_MILLISECONDS);
    expect(result.maxKeystrokeInMilliseconds).toBeLessThan(KEYSTROKE_BUDGET_IN_MILLISECONDS);
    expect(result.openInMilliseconds).toBeLessThan(OPEN_BUDGET_IN_MILLISECONDS);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
