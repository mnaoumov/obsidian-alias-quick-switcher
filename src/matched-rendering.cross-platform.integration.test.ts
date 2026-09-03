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
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47).
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

interface MatchedRenderingResult {
  readonly aliasRowLabels: string;
  readonly aliasRowRealPath: string;
  readonly highlights: readonly string[];
  readonly realNameRowHasSecondLine: boolean;
}

describe('The matched rendering', () => {
  it('shows the labels that satisfied the query, with the real path beneath them', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, pluginId }): Promise<MatchedRenderingResult> {
        const WAIT_TIMEOUT_IN_MILLISECONDS = 30_000;
        const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
        const alpha = `Alpha-${stamp}`;
        const bravo = `Bravo-${stamp}`;
        const charlie = `Charlie-${stamp}`;
        const delta = `Delta-${stamp}`;
        const echo = `Echo-${stamp}`;
        const charliePath = `${alpha}/${bravo}/${charlie}.md`;

        await app.vault.createFolder(`${alpha}/${bravo}`);
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

        async function readRow(query: string): Promise<HTMLElement> {
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
            message: `a row is offered for ${query}`,
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(charlie)),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          const row = [...document.querySelectorAll('.suggestion-item')].find((el) => el.textContent.includes(charlie));
          if (!(row instanceof HTMLElement)) {
            throw new TypeError('No row was offered.');
          }

          return row;
        }

        function closeSwitcher(): void {
          // Trusted input, so the modal really receives the key the way a user's Escape reaches it.
          pressKey({ key: 'Escape' });
        }

        const aliasRow = await readRow(`${alpha}/${delta}/${echo}`);
        const aliasRowLabels = aliasRow.querySelector('.alias-quick-switcher-modal__labels')?.textContent ?? '';
        const aliasRowRealPath = aliasRow.querySelector('.alias-quick-switcher-modal__path')?.textContent ?? '';
        const highlights = [...aliasRow.querySelectorAll('.suggestion-highlight')].map((el) => el.textContent);
        closeSwitcher();

        const realNameRow = await readRow(`${alpha}/${bravo}/${charlie}`);
        // Nothing about this match differs from the path, so a second line would only repeat it.
        const hasRealNameRowSecondLine = realNameRow.querySelector('.alias-quick-switcher-modal__path') !== null;
        closeSwitcher();

        await waitUntil({
          message: 'the switcher closed',
          predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        return { aliasRowLabels, aliasRowRealPath, highlights, realNameRowHasSecondLine: hasRealNameRowSecondLine };
      },
      input: { pluginId: PLUGIN_ID }
    });

    expect(result.aliasRowLabels).toMatch(/^Alpha-.+\/Delta-.+\/Echo-.+$/);
    expect(result.aliasRowRealPath).toMatch(/^Alpha-.+\/Bravo-.+\/Charlie-.+\.md$/);
    expect(result.highlights).toHaveLength(3);
    expect(result.realNameRowHasSecondLine).toBe(false);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
