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
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47). Split across calls because one
 * `evalInObsidian` is one `execute/sync`, which WebDriver caps at 30 seconds.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

const SETTLE_DELAY_IN_MILLISECONDS = 500;

const STAMP_RANGE = 1000;

interface BareFolderResult {
  readonly wasBareFolderOffered: boolean;
  readonly wasFolderNoteCreated: boolean;
}

interface FolderPickResult {
  readonly openedPath: string;
  readonly wasFolderRowOffered: boolean;
}

describe('Folders as results', () => {
  it('offers a folder by its folder note alias and opens that note, while never offering a folder without one', async () => {
    const stamp = `${Date.now().toString()}-${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
    const noted = `Noted-${stamp}`;
    const bare = `Bare-${stamp}`;
    const delta = `Delta-${stamp}`;
    const folderNotePath = `${noted}/${noted}.md`;

    await evalInObsidian({
      async callback({ app, bare: bareFolder, delta: deltaAlias, lib: { waitUntil }, noted: notedFolder, waitTimeoutInMilliseconds }): Promise<void> {
        const notePath = `${notedFolder}/${notedFolder}.md`;

        await app.vault.createFolder(notedFolder);
        await app.vault.createFolder(bareFolder);
        await app.vault.create(notePath, `---\naliases:\n  - ${deltaAlias}\n---\n`);
        // A note INSIDE the bare folder, so the folder exists in the vault for real and is genuinely
        // Declined for having no folder note rather than for being empty.
        await app.vault.create(`${bareFolder}/Inside-${bareFolder}.md`, 'inside');

        await waitUntil({
          message: 'the folder note alias is in the metadata cache',
          predicate: () => {
            const folderNote = app.vault.getFileByPath(notePath);
            return folderNote !== null && Boolean(app.metadataCache.getFileCache(folderNote)?.frontmatter);
          },
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });
      },
      input: { bare, delta, noted, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS }
    });

    const pick = await evalInObsidian({
      async callback({ app, delta: deltaAlias, folderNotePath: notePath, lib: { waitUntil }, pluginId, waitTimeoutInMilliseconds }): Promise<FolderPickResult> {
        await waitUntil({
          message: 'no switcher left open by an earlier suite',
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

        // A dispatched event rather than trusted input (G107): the harness drives keys through Electron's
        // Input API, which does not exist on Android, and this has to be proven on both.
        input.value = deltaAlias;
        input.dispatchEvent(new Event('input', { bubbles: true }));

        await waitUntil({
          message: 'the folder is offered by its alias',
          predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(deltaAlias)),
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });

        const folderRow = [...document.querySelectorAll('.suggestion-item')].find((el) => el.textContent.includes(deltaAlias));
        if (!(folderRow instanceof HTMLElement)) {
          throw new TypeError('The folder was not offered.');
        }

        const wasFolderRowOffered = folderRow.hasClass('alias-quick-switcher-modal__folder');
        folderRow.click();

        await waitUntil({
          message: 'the folder note is open',
          predicate: () => app.workspace.getActiveFile()?.path === notePath,
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });

        return { openedPath: app.workspace.getActiveFile()?.path ?? '', wasFolderRowOffered };
      },
      input: { delta, folderNotePath, pluginId: PLUGIN_ID, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS }
    });

    const bareFolderResult = await evalInObsidian({
      async callback({ app, bare: bareFolder, lib: { waitUntil }, pluginId, settleDelayInMilliseconds, waitTimeoutInMilliseconds }): Promise<BareFolderResult> {
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

        input.value = bareFolder;
        input.dispatchEvent(new Event('input', { bubbles: true }));

        await waitUntil({
          message: 'the note inside the bare folder is offered, so the list has settled',
          predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(`Inside-${bareFolder}`)),
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });
        await sleep(settleDelayInMilliseconds);

        // The FOLDER itself must not be among the rows — only the note inside it.
        const wasBareFolderOffered = [...document.querySelectorAll('.suggestion-item')]
          .some((el) => el.hasClass('alias-quick-switcher-modal__folder'));

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

        return {
          wasBareFolderOffered,
          // Resolving a folder note must never CREATE one — the bare folder is still bare afterwards.
          wasFolderNoteCreated: app.vault.getFileByPath(`${bareFolder}/${bareFolder}.md`) !== null
        };
      },
      input: {
        bare,
        pluginId: PLUGIN_ID,
        settleDelayInMilliseconds: SETTLE_DELAY_IN_MILLISECONDS,
        waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      }
    });

    expect(pick.wasFolderRowOffered).toBe(true);
    expect(pick.openedPath).toBe(folderNotePath);
    expect(bareFolderResult.wasBareFolderOffered).toBe(false);
    expect(bareFolderResult.wasFolderNoteCreated).toBe(false);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
