import {
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
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
 * `evalInObsidian` is one `execute/sync`, which the transport caps at ~30s — and **the waiting is done
 * from Node**, since a 60s budget declared inside a closure is one the cap can never honour.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const FOLDER_ROW_CLASS = 'alias-quick-switcher-modal__folder';
const MODAL_SELECTOR = '.alias-quick-switcher-modal';
const SUGGESTION_SELECTOR = '.suggestion-item';

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

const SETTLE_DELAY_IN_MILLISECONDS = 500;

const STAMP_RANGE = 1000;

interface BareFolderResult {
  readonly wasBareFolderOffered: boolean;
  readonly wasFolderNoteCreated: boolean;
}

describe('Folders as results', () => {
  it('offers a folder by its folder note alias and opens that note, while never offering a folder without one', async () => {
    const stamp = `${Date.now().toString()}-${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
    const noted = `Noted-${stamp}`;
    const bare = `Bare-${stamp}`;
    const delta = `Delta-${stamp}`;
    const folderNotePath = `${noted}/${noted}.md`;

    await pollInObsidian({
      input: { bare, delta, noted },
      poll({ app, noted: notedFolder }): boolean {
        const folderNote = app.vault.getFileByPath(`${notedFolder}/${notedFolder}.md`);
        return folderNote !== null && Boolean(app.metadataCache.getFileCache(folderNote)?.frontmatter);
      },
      async start({ app, bare: bareFolder, delta: deltaAlias, noted: notedFolder }): Promise<void> {
        await app.vault.createFolder(notedFolder);
        await app.vault.createFolder(bareFolder);
        await app.vault.create(`${notedFolder}/${notedFolder}.md`, `---\naliases:\n  - ${deltaAlias}\n---\n`);
        // A note INSIDE the bare folder, so the folder exists in the vault for real and is genuinely
        // Declined for having no folder note rather than for being empty.
        await app.vault.create(`${bareFolder}/Inside-${bareFolder}.md`, 'inside');
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the folder note alias never reached the metadata cache',
      until: (isCached: boolean): boolean => isCached
    });

    async function openEmptySwitcher(): Promise<void> {
      await pollInObsidian({
        input: { modalSelector: MODAL_SELECTOR },
        poll({ modalSelector }): boolean {
          return document.querySelector(modalSelector) === null;
        },
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'a switcher was left open',
        until: (isClosed: boolean): boolean => isClosed
      });

      await pollInObsidian({
        input: { modalSelector: MODAL_SELECTOR, pluginId: PLUGIN_ID },
        poll({ modalSelector }): boolean {
          return document.querySelector(modalSelector) !== null;
        },
        start({ app, pluginId }): void {
          app.commands.executeCommandById(`${pluginId}:open`);
        },
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the switcher never opened',
        until: (isOpen: boolean): boolean => isOpen
      });
    }

    async function typeQuery(query: string): Promise<void> {
      await evalInObsidian({
        callback({ modalSelector, query: currentQuery }): void {
          const input = document.querySelector(`${modalSelector} .prompt-input`);
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('The switcher has no input.');
          }

          // A dispatched event rather than trusted input (G107): the harness drives keys through Electron's
          // Input API, which does not exist on Android, and this has to be proven on both.
          input.value = currentQuery;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        },
        input: { modalSelector: MODAL_SELECTOR, query }
      });
    }

    await openEmptySwitcher();
    await typeQuery(delta);

    await pollInObsidian({
      input: { delta, suggestionSelector: SUGGESTION_SELECTOR },
      poll({ delta: deltaAlias, suggestionSelector }): boolean {
        return [...document.querySelectorAll(suggestionSelector)].some((el) => el.textContent.includes(deltaAlias));
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the folder was never offered by its alias',
      until: (isOffered: boolean): boolean => isOffered
    });

    // The row is read and clicked in one closure: reading its class after a separate round trip would let
    // A re-render replace the element between the read and the click.
    const wasFolderRowOffered = await evalInObsidian({
      callback({ delta: deltaAlias, folderRowClass, suggestionSelector }): boolean {
        const folderRow = [...document.querySelectorAll(suggestionSelector)].find((el) => el.textContent.includes(deltaAlias));
        if (!(folderRow instanceof HTMLElement)) {
          throw new TypeError('The folder was not offered.');
        }

        const isFolderRow = folderRow.hasClass(folderRowClass);
        folderRow.click();

        return isFolderRow;
      },
      input: { delta, folderRowClass: FOLDER_ROW_CLASS, suggestionSelector: SUGGESTION_SELECTOR }
    });

    // `until` runs in Node, so it compares against the path this test already holds.
    const openedPath = await pollInObsidian({
      poll({ app }): string {
        return app.workspace.getActiveFile()?.path ?? '';
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the folder note never became the active file',
      until: (path: string): boolean => path === folderNotePath
    });

    await openEmptySwitcher();
    await typeQuery(bare);

    await pollInObsidian({
      input: { bare, suggestionSelector: SUGGESTION_SELECTOR },
      poll({ bare: bareFolder, suggestionSelector }): boolean {
        return [...document.querySelectorAll(suggestionSelector)].some((el) => el.textContent.includes(`Inside-${bareFolder}`));
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the note inside the bare folder was never offered, so the list never settled',
      until: (hasSettled: boolean): boolean => hasSettled
    });

    // The settle stays INSIDE the closure: the assertion is about a row being ABSENT, and polling for an
    // Absence that is already true would accept before the folder row had a chance to appear.
    const bareFolderResult = await evalInObsidian({
      async callback({ app, bare: bareFolder, folderRowClass, settleDelayInMilliseconds, suggestionSelector }): Promise<BareFolderResult> {
        await sleep(settleDelayInMilliseconds);

        // The FOLDER itself must not be among the rows — only the note inside it.
        const wasBareFolderOffered = [...document.querySelectorAll(suggestionSelector)]
          .some((el) => el.hasClass(folderRowClass));

        return {
          wasBareFolderOffered,
          // Resolving a folder note must never CREATE one — the bare folder is still bare afterwards.
          wasFolderNoteCreated: app.vault.getFileByPath(`${bareFolder}/${bareFolder}.md`) !== null
        };
      },
      input: {
        bare,
        folderRowClass: FOLDER_ROW_CLASS,
        settleDelayInMilliseconds: SETTLE_DELAY_IN_MILLISECONDS,
        suggestionSelector: SUGGESTION_SELECTOR
      }
    });

    await pollInObsidian({
      input: { modalSelector: MODAL_SELECTOR },
      poll({ modalSelector }): boolean {
        return document.querySelector(modalSelector) === null;
      },
      async start({ lib: { pressKey } }): Promise<void> {
        /*
         * Closed with a trusted Escape, which the harness delivers on Android too since 12.0.0. A click on
         * `.modal-bg` was the old answer and is the wrong one now: a TRUSTED tap is hit-tested at the
         * element's centre, and the background's centre lies behind the switcher, so the tap would land on
         * the switcher and dismiss nothing.
         */
        await pressKey({ key: 'Escape' });
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the switcher never closed',
      until: (isClosed: boolean): boolean => isClosed
    });

    expect(wasFolderRowOffered).toBe(true);
    expect(openedPath).toBe(folderNotePath);
    expect(bareFolderResult.wasBareFolderOffered).toBe(false);
    expect(bareFolderResult.wasFolderNoteCreated).toBe(false);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
