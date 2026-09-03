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
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47). One `evalInObsidian` call per query,
 * because a call is one `execute/sync` and WebDriver caps a single script at 30 seconds — eight queries in
 * one closure is exactly the shape that blows through it on a phone.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 600_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

const STAMP_RANGE = 1000;

describe('Matching an alias in every path segment', () => {
  it('finds the note for every mixture of real names and aliases, including the ones the built-in cannot', async () => {
    const stamp = `${Date.now().toString()}-${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
    const alpha = `Alpha-${stamp}`;
    const bravo = `Bravo-${stamp}`;
    const charlie = `Charlie-${stamp}`;
    const delta = `Delta-${stamp}`;
    const echo = `Echo-${stamp}`;

    await evalInObsidian({
      async callback({ alpha: alphaName, app, bravo: bravoName, charlie: charlieName, delta: deltaAlias, echo: echoAlias, lib: { waitUntil }, waitTimeoutInMilliseconds }): Promise<void> {
        const folderNotePath = `${alphaName}/${bravoName}/${bravoName}.md`;
        const charliePath = `${alphaName}/${bravoName}/${charlieName}.md`;

        await app.vault.createFolder(`${alphaName}/${bravoName}`);
        // The folder note of the inner folder, under the default `Folder/Folder.md` convention, aliased so
        // The folder answers to a second name.
        await app.vault.create(folderNotePath, `---\naliases:\n  - ${deltaAlias}\n---\n`);
        await app.vault.create(charliePath, `---\naliases:\n  - ${echoAlias}\n---\n`);

        await waitUntil({
          message: 'both aliases are in the metadata cache',
          predicate: () => {
            const folderNote = app.vault.getFileByPath(folderNotePath);
            const leaf = app.vault.getFileByPath(charliePath);
            if (!folderNote || !leaf) {
              return false;
            }

            return Boolean(app.metadataCache.getFileCache(folderNote)?.frontmatter)
              && Boolean(app.metadataCache.getFileCache(leaf)?.frontmatter);
          },
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });
      },
      input: { alpha, bravo, charlie, delta, echo, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS }
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
      offeredCounts.push(
        await evalInObsidian({
          async callback({ app, lib: { waitUntil }, pluginId, query: currentQuery, targetName, waitTimeoutInMilliseconds }): Promise<number> {
            await waitUntil({
              message: 'no switcher left open',
              predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
              timeoutInMilliseconds: waitTimeoutInMilliseconds
            });

            app.commands.executeCommandById(`${pluginId}:open`);
            await waitUntil({
              message: 'the switcher is open',
              predicate: () => document.querySelector('.alias-quick-switcher-modal') !== null,
              timeoutInMilliseconds: waitTimeoutInMilliseconds
            });

            const input = document.querySelector('.alias-quick-switcher-modal .prompt-input');
            if (!(input instanceof HTMLInputElement)) {
              throw new TypeError('The switcher has no input.');
            }

            // A dispatched event rather than trusted input (G107): the harness drives keys through
            // Electron's input API, which does not exist on Android, and this has to be proven on both.
            input.value = currentQuery;
            input.dispatchEvent(new Event('input', { bubbles: true }));

            await waitUntil({
              message: `the note is offered for ${currentQuery}`,
              predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(targetName)),
              timeoutInMilliseconds: waitTimeoutInMilliseconds
            });

            const count = [...document.querySelectorAll('.suggestion-item')].filter((el) => el.textContent.includes(targetName)).length;

            // Closed by clicking the modal background rather than by pressing Escape: the harness's
            // Trusted-key helpers are Electron-only (they reach for `remote`, which Android has none of),
            // And a dispatched KeyboardEvent is untrusted and ignored. A plain click is the one gesture
            // That works on both.
            const background = document.querySelector('.modal-bg');
            if (background instanceof HTMLElement) {
              background.click();
            }
            await waitUntil({
              message: 'the switcher closed',
              predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
              timeoutInMilliseconds: waitTimeoutInMilliseconds
            });

            return count;
          },
          input: { pluginId: PLUGIN_ID, query, targetName: charlie, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS }
        })
      );
    }

    // Every one of the eight forms finds the note exactly once — the four the built-in already handles,
    // And the four it returns an empty list for.
    expect(offeredCounts).toStrictEqual(queries.map(() => 1));
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
