import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * The one UI decision no competitor makes, end to end against a real Obsidian: a row shows the path AS
 * MATCHED — the satisfying label in place of each real name — with the real path beneath it when the two
 * differ. Without it the user cannot tell why a row matched.
 *
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47). Split across calls because one
 * `evalInObsidian` is one `execute/sync`, which WebDriver caps at 30 seconds.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

const STAMP_RANGE = 1000;

interface RowRendering {
  readonly hasSecondLine: boolean;
  readonly highlights: readonly string[];
  readonly labels: string;
  readonly realPath: string;
}

describe('The matched rendering', () => {
  it('shows the labels that satisfied the query, with the real path beneath them', async () => {
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

    async function readRow(query: string): Promise<RowRendering> {
      return await evalInObsidian({
        async callback({ app, lib: { waitUntil }, pluginId, query: currentQuery, targetName, waitTimeoutInMilliseconds }): Promise<RowRendering> {
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
            message: `a row is offered for ${currentQuery}`,
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(targetName)),
            timeoutInMilliseconds: waitTimeoutInMilliseconds
          });

          const row = [...document.querySelectorAll('.suggestion-item')].find((el) => el.textContent.includes(targetName));
          if (!(row instanceof HTMLElement)) {
            throw new TypeError('No row was offered.');
          }

          const rendering: RowRendering = {
            hasSecondLine: row.querySelector('.alias-quick-switcher-modal__path') !== null,
            highlights: [...row.querySelectorAll('.suggestion-highlight')].map((el) => el.textContent),
            labels: row.querySelector('.alias-quick-switcher-modal__labels')?.textContent ?? '',
            realPath: row.querySelector('.alias-quick-switcher-modal__path')?.textContent ?? ''
          };

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

          return rendering;
        },
        input: { pluginId: PLUGIN_ID, query, targetName: charlie, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS }
      });
    }

    const aliasRow = await readRow(`${alpha}/${delta}/${echo}`);
    const realNameRow = await readRow(`${alpha}/${bravo}/${charlie}`);

    expect(aliasRow.labels).toBe(`${alpha}/${delta}/${echo}`);
    expect(aliasRow.realPath).toBe(`${alpha}/${bravo}/${charlie}.md`);
    expect(aliasRow.highlights).toHaveLength(3);

    // Nothing about this match differs from the path, so a second line would only repeat it.
    expect(realNameRow.hasSecondLine).toBe(false);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
