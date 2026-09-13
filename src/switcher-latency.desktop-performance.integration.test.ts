import {
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
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
 * **The waiting for that vault to index happens in NODE.** Indexing 36,000 notes is minutes of work on a
 * cold machine, and the transport kills any single closure at ~30s — so the old shape, which awaited it
 * inside one closure under a 300s ceiling, declared a budget the cap could never honour and would have
 * died on exactly the slow machine the budget was for. Only the measurement itself is one closure now,
 * because a round trip between two `performance.now()` calls would be measuring the harness.
 *
 * Reachable ONLY via `npm run test:integration:desktop:performance`; never from a routine
 * `npm run test:integration` (G51).
 */

const PLUGIN_ID = 'alias-quick-switcher';

const MODAL_SELECTOR = '.alias-quick-switcher-modal';
const SUGGESTION_SELECTOR = '.suggestion-item';

const TEST_TIMEOUT_IN_MILLISECONDS = 600_000;

/**
 * The Node-side budget for the generated vault to finish indexing. Long because it is genuinely minutes of
 * work; safe to be long because Node does the waiting, one short poll at a time.
 */
const INDEX_TIMEOUT_IN_MILLISECONDS = 300_000;

/**
 * The in-closure ceiling on the modal appearing, kept far below the transport's ~30s cap. The assertion
 * below fails anything over {@link OPEN_BUDGET_IN_MILLISECONDS} anyway, so this only has to be generous
 * enough that a slow machine reports a real number rather than a timeout.
 */
const OPEN_WAIT_TIMEOUT_IN_MILLISECONDS = 10_000;

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

const MINIMUM_VAULT_SIZE = 1000;

interface LatencyResult {
  readonly candidateCount: number;
  readonly maxKeystrokeInMilliseconds: number;
  readonly medianKeystrokeInMilliseconds: number;
  readonly openInMilliseconds: number;
  readonly wasTargetFound: boolean;
}

describe('Per-keystroke latency at real scale', () => {
  it('answers a whole-vault alias query fast enough to type into', async () => {
    await pollInObsidian({
      poll({ app }): number {
        return app.vault.getMarkdownFiles().length;
      },
      timeoutInMilliseconds: INDEX_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the generated vault never finished indexing',
      until: (fileCount: number): boolean => fileCount > MINIMUM_VAULT_SIZE
    });

    /*
     * The file count says the vault is SCANNED; it says nothing about the frontmatter being parsed, and
     * this query is answerable only through aliases. The candidate list is built once when the switcher
     * opens, so opening before the aliases land would memoize labels that lack them — and measure a query
     * that matches nothing rather than the one this plugin exists for.
     */
    await pollInObsidian({
      input: { targetFolderNotePath: TARGET_FOLDER_NOTE_PATH, targetNotePath: TARGET_NOTE_PATH },
      poll({ app, targetFolderNotePath, targetNotePath }): boolean {
        const folderNote = app.vault.getFileByPath(targetFolderNotePath);
        const target = app.vault.getFileByPath(targetNotePath);
        if (!folderNote || !target) {
          return false;
        }

        return Boolean(app.metadataCache.getFileCache(folderNote)?.frontmatter)
          && Boolean(app.metadataCache.getFileCache(target)?.frontmatter);
      },
      timeoutInMilliseconds: INDEX_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the target aliases never reached the metadata cache',
      until: (areCached: boolean): boolean => areCached
    });

    await pollInObsidian({
      input: { modalSelector: MODAL_SELECTOR },
      poll({ modalSelector }): boolean {
        return document.querySelector(modalSelector) === null;
      },
      timeoutInMilliseconds: INDEX_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'a switcher was left open',
      until: (isClosed: boolean): boolean => isClosed
    });

    // Everything below is ONE closure on purpose: it is the measurement, and a transport round trip between
    // Two `performance.now()` calls would be timing the harness rather than the plugin. Its only wait is
    // The bounded open ceiling, which keeps the whole closure far inside the cap.
    const result = await evalInObsidian({
      async callback({
        app,
        lib: { pressKey, waitUntil },
        modalSelector,
        openWaitTimeoutInMilliseconds,
        pluginId,
        suggestionSelector,
        targetFolderAlias,
        targetNoteAlias
      }): Promise<LatencyResult> {
        const KEYSTROKE_COUNT = 9;
        const MIDDLE = 0.5;

        // Opening is where the candidate list is built and the folder-note setup re-resolved, so it is
        // Timed separately rather than folded into the first keystroke.
        const openStart = performance.now();
        app.commands.executeCommandById(`${pluginId}:open`);
        await waitUntil({
          message: 'the switcher is open',
          predicate: () => document.querySelector(modalSelector) !== null,
          timeoutInMilliseconds: openWaitTimeoutInMilliseconds
        });
        const openInMilliseconds = performance.now() - openStart;

        const input = document.querySelector(`${modalSelector} .prompt-input`);
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

        const wasTargetFound = [...document.querySelectorAll(suggestionSelector)]
          .some((el) => el.textContent.includes(targetNoteAlias));
        const candidateCount = app.vault.getMarkdownFiles().length;

        // Trusted input, so the modal really receives the key the way a user's Escape reaches it.
        await pressKey({ key: 'Escape' });

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
        modalSelector: MODAL_SELECTOR,
        openWaitTimeoutInMilliseconds: OPEN_WAIT_TIMEOUT_IN_MILLISECONDS,
        pluginId: PLUGIN_ID,
        suggestionSelector: SUGGESTION_SELECTOR,
        targetFolderAlias: TARGET_FOLDER_ALIAS,
        targetNoteAlias: TARGET_NOTE_ALIAS
      }
    });

    // The measurements are not logged: a failing bound prints both sides, which is where the numbers
    // Matter, and console output is not allowed from plugin code or its suites.

    // The query is one no other switcher can answer, so finding the note is itself part of the measurement:
    // A fast run that found nothing would be measuring the pre-filter rejecting everything.
    expect(result.wasTargetFound).toBe(true);
    expect(result.candidateCount).toBeGreaterThan(MINIMUM_VAULT_SIZE);
    expect(result.medianKeystrokeInMilliseconds).toBeLessThan(KEYSTROKE_BUDGET_IN_MILLISECONDS);
    expect(result.maxKeystrokeInMilliseconds).toBeLessThan(KEYSTROKE_BUDGET_IN_MILLISECONDS);
    expect(result.openInMilliseconds).toBeLessThan(OPEN_BUDGET_IN_MILLISECONDS);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
