import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * Folders as results, end to end against a real Obsidian. In the vault this plugin was written for all
 * 1,715 folder notes share one name, so the built-in switcher cannot reach any of them by name and the
 * folder's alias is the only handle there is. Picking the folder opens its folder note; a folder with no
 * folder note is never offered, and resolving one never creates it.
 *
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47).
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

interface FolderResultsResult {
  readonly openedPath: string;
  readonly wasBareFolderOffered: boolean;
  readonly wasFolderNoteCreated: boolean;
  readonly wasFolderRowOffered: boolean;
}

describe('Folders as results', () => {
  it('offers a folder by its folder note alias and opens that note, while never offering a folder without one', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, pluginId }): Promise<FolderResultsResult> {
        const WAIT_TIMEOUT_IN_MILLISECONDS = 30_000;
        const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
        const noted = `Noted-${stamp}`;
        const bare = `Bare-${stamp}`;
        const delta = `Delta-${stamp}`;
        const folderNotePath = `${noted}/${noted}.md`;

        await app.vault.createFolder(noted);
        await app.vault.createFolder(bare);
        await app.vault.create(folderNotePath, `---\naliases:\n  - ${delta}\n---\n`);
        // A note INSIDE the bare folder, so the folder exists in the vault for real and is genuinely
        // Declined for having no folder note rather than for being empty.
        await app.vault.create(`${bare}/Inside-${stamp}.md`, 'inside');

        // `getFileByPath` answers `null` until the vault has caught up and `getFileCache` needs a real
        // File, so the two questions are asked together rather than nested.
        function checkHasFrontmatter(path: string): boolean {
          const file = app.vault.getFileByPath(path);
          return file !== null && Boolean(app.metadataCache.getFileCache(file)?.frontmatter);
        }

        await waitUntil({
          message: 'the folder note alias is in the metadata cache',
          predicate: () => checkHasFrontmatter(folderNotePath),
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        await waitUntil({
          message: 'no switcher left open by an earlier suite',
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

        // A dispatched event rather than trusted input (G107): the harness drives keys through Electron's
        // Input API, which does not exist on Android, and this has to be proven on both.
        input.value = delta;
        input.dispatchEvent(new Event('input', { bubbles: true }));

        await waitUntil({
          message: 'the folder is offered by its alias',
          predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(delta)),
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const folderRow = [...document.querySelectorAll('.suggestion-item')].find((el) => el.textContent.includes(delta));
        if (!(folderRow instanceof HTMLElement)) {
          throw new TypeError('The folder was not offered.');
        }

        const wasFolderRowOffered = folderRow.hasClass('alias-quick-switcher-modal__folder');
        folderRow.click();

        await waitUntil({
          message: 'the folder note is open',
          predicate: () => app.workspace.getActiveFile()?.path === folderNotePath,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const openedPath = app.workspace.getActiveFile()?.path ?? '';

        app.commands.executeCommandById(`${pluginId}:open`);
        await waitUntil({
          message: 'the switcher is open again',
          predicate: () => document.querySelector('.alias-quick-switcher-modal') !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const secondInput = document.querySelector('.alias-quick-switcher-modal .prompt-input');
        if (!(secondInput instanceof HTMLInputElement)) {
          throw new TypeError('The switcher has no input.');
        }

        secondInput.value = bare;
        secondInput.dispatchEvent(new Event('input', { bubbles: true }));

        await waitUntil({
          message: 'the note inside the bare folder is offered, so the list has settled',
          predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(`Inside-${stamp}`)),
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        // The FOLDER itself must not be among the rows — only the note inside it.
        const wasBareFolderOffered = [...document.querySelectorAll('.suggestion-item')]
          .some((el) => el.hasClass('alias-quick-switcher-modal__folder'));

        // Trusted input, so the modal really receives the key the way a user's Escape reaches it.
        pressKey({ key: 'Escape' });

        await waitUntil({
          message: 'the switcher closed',
          predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        return {
          openedPath,
          wasBareFolderOffered,
          // Resolving a folder note must never CREATE one — the bare folder is still bare afterwards.
          wasFolderNoteCreated: app.vault.getFileByPath(`${bare}/${bare}.md`) !== null,
          wasFolderRowOffered
        };
      },
      input: { pluginId: PLUGIN_ID }
    });

    expect(result.wasFolderRowOffered).toBe(true);
    expect(result.openedPath).toMatch(/^Noted-.+\/Noted-.+\.md$/);
    expect(result.wasBareFolderOffered).toBe(false);
    expect(result.wasFolderNoteCreated).toBe(false);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
