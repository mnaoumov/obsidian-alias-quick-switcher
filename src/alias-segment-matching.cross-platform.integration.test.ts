import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * The reason the plugin exists, end to end against a real Obsidian.
 *
 * Measured over CDP on Obsidian 1.13.7 before any code was written: the built-in switcher returns an EMPTY
 * list for `Alpha/Bravo/Echo`, `Alpha/Delta/Charlie` and `Alpha/Delta/Echo`, because it scores a candidate
 * as `max(fuzzy(query, path), fuzzy(query, alias))` and never combines the two. All three must find the
 * note here, and so must the forms the built-in already handles.
 *
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47).
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 180_000;

interface SegmentMatchingResult {
  readonly offeredCounts: readonly number[];
  readonly queries: readonly string[];
}

describe('Matching an alias in every path segment', () => {
  it('finds the note for every mixture of real names and aliases, including the three the built-in cannot', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, pluginId }): Promise<SegmentMatchingResult> {
        const WAIT_TIMEOUT_IN_MILLISECONDS = 30_000;
        const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
        const alpha = `Alpha-${stamp}`;
        const bravo = `Bravo-${stamp}`;
        const charlie = `Charlie-${stamp}`;
        const delta = `Delta-${stamp}`;
        const echo = `Echo-${stamp}`;
        const charliePath = `${alpha}/${bravo}/${charlie}.md`;

        await app.vault.createFolder(`${alpha}/${bravo}`);
        // The folder note of `${bravo}`, under the default `Folder/Folder.md` convention, aliased so the
        // Folder answers to a second name.
        await app.vault.create(`${alpha}/${bravo}/${bravo}.md`, `---\naliases:\n  - ${delta}\n---\n`);
        await app.vault.create(charliePath, `---\naliases:\n  - ${echo}\n---\n`);

        // `getFileByPath` answers `null` until the vault has caught up and `getFileCache` needs a real
        // File, so the two questions are asked together rather than nested.
        function checkHasFrontmatter(path: string): boolean {
          const file = app.vault.getFileByPath(path);
          return file !== null && Boolean(app.metadataCache.getFileCache(file)?.frontmatter);
        }

        await waitUntil({
          message: 'both aliases are in the metadata cache',
          predicate: () => checkHasFrontmatter(`${alpha}/${bravo}/${bravo}.md`) && checkHasFrontmatter(charliePath),
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const queries = [
          `${alpha}/${bravo}/${charlie}`,
          `${alpha} ${bravo} ${charlie}`,
          `${bravo} ${charlie}`,
          echo,
          `${alpha}/${bravo}/${echo}`,
          `${alpha}/${delta}/${charlie}`,
          `${alpha}/${delta}/${echo}`,
          `${delta}/${echo}`
        ];

        const offeredCounts: number[] = [];

        for (const query of queries) {
          await waitUntil({
            message: 'no switcher left open',
            predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          app.commands.executeCommandById(`${pluginId}:open`);
          await waitUntil({
            message: 'the switcher is open',
            predicate: () => document.querySelector('.alias-quick-switcher-modal') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          const input = document.querySelector('.alias-quick-switcher-modal .prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('The switcher has no input.');
          }

          // A dispatched event rather than trusted input (G107): the harness drives keys through
          // Electron's input API, which does not exist on Android, and this has to be proven on both.
          input.value = query;
          input.dispatchEvent(new Event('input', { bubbles: true }));

          await waitUntil({
            message: `the note is offered for ${query}`,
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(charlie)),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          offeredCounts.push([...document.querySelectorAll('.suggestion-item')].filter((el) => el.textContent.includes(charlie)).length);

          // Trusted input, so the modal really receives the key the way a user's Escape reaches it.
          pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'the switcher closed',
            predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
        }

        return { offeredCounts, queries };
      },
      input: { pluginId: PLUGIN_ID }
    });

    // Every one of the eight forms finds the note exactly once — the four the built-in already handles,
    // And the four it returns an empty list for.
    expect(result.offeredCounts).toStrictEqual(result.queries.map(() => 1));
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
