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
 * Link texts, end to end against a real Obsidian and the REAL `Advanced Metadata Cache` index: a note nobody
 * aliased is found by the text another note's link to it was written with, an attachment by the text of its
 * embed, and the `shouldMatchLinkTexts` setting turns both off.
 *
 * Cross-platform: the manifest declares `isDesktopOnly: false`. Split across calls because one
 * `evalInObsidian` is one `execute/sync`, which the transport caps at ~30s — and **the waiting is done
 * from Node**, since a 60s budget declared inside a closure is one the cap can never honour.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const MODAL_SELECTOR = '.alias-quick-switcher-modal';
const SUGGESTION_SELECTOR = '.suggestion-item';

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

const SETTLE_DELAY_IN_MILLISECONDS = 500;

const STAMP_RANGE = 1000;

interface Row {
  readonly flairs: readonly (null | string)[];
  readonly note: null | string;
  readonly title: string;
}

interface SwitcherSettingsPatch {
  readonly shouldIncludeNonMarkdownFiles?: boolean;
  readonly shouldMatchLinkTexts?: boolean;
}

describe('Link texts', () => {
  it('finds a note and an attachment by the texts links to them are written with, until turned off', async () => {
    const stamp = `${Date.now().toString()}-${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
    const folder = `LinkTexts-${stamp}`;
    const targetPath = `${folder}/Bravo.md`;
    const attachmentPath = `${folder}/Sketch.canvas`;
    const sourcePath = `${folder}/Source.md`;
    // Stamped, so the query can match nothing else in the shared vault.
    const noteLinkText = `Lima${stamp}`;
    const attachmentLinkText = `Whiteboard${stamp}`;

    await pollInObsidian({
      input: { attachmentLinkText, attachmentPath, folder, noteLinkText, sourcePath, targetPath },
      poll({ app, attachmentPath: attachment, sourcePath: source, targetPath: target }): boolean {
        const links = app.metadataCache.resolvedLinks[source] ?? {};
        return (links[target] ?? 0) > 0 && (links[attachment] ?? 0) > 0;
      },
      async start({ app, attachmentLinkText: attachmentText, attachmentPath: attachment, folder: folderPath, noteLinkText: noteText, sourcePath: source, targetPath: target }): Promise<void> {
        await app.vault.createFolder(folderPath);
        await app.vault.create(target, 'nobody aliased this note');
        await app.vault.create(attachment, '{}');
        // Both in markdown form, the one the demo vault uses, since a wikilink would not render there on GitHub.
        await app.vault.create(source, `[${noteText}](Bravo.md)\n\n![${attachmentText}](Sketch.canvas)\n`);
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the links never resolved',
      until: (isResolved: boolean): boolean => isResolved
    });

    async function collectRows(query: string): Promise<Row[]> {
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

      // The settle stays INSIDE the closure: the off-setting assertion is about rows being ABSENT, and polling for
      // an absence that is already true would accept instantly whether or not the list had rendered yet.
      const rows = await evalInObsidian({
        async callback({ modalSelector, query: text, settleDelayInMilliseconds, suggestionSelector }): Promise<Row[]> {
          const input = document.querySelector(`${modalSelector} .prompt-input`);
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('The switcher has no input.');
          }

          // A NOTIFICATION event, not a pretend keystroke: nothing on this path gates on `isTrusted`, and
          // `SuggestModal` rebuilds its list from this `input` event exactly as a real keystroke makes it.
          // Kept over a per-character trusted `pressKey` deliberately — `AGENTS.md` says what that costs.
          input.value = text;
          input.dispatchEvent(new Event('input', { bubbles: true }));

          await sleep(settleDelayInMilliseconds);

          return [...document.querySelectorAll(suggestionSelector)].map((el) => ({
            flairs: [...el.querySelectorAll('.suggestion-flair')].map((flair) => flair.getAttribute('aria-label')),
            note: el.querySelector('.suggestion-note')?.textContent ?? null,
            title: el.querySelector('.suggestion-title')?.textContent ?? ''
          }));
        },
        input: {
          modalSelector: MODAL_SELECTOR,
          query,
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
          // A trusted Escape, which reaches Android too; a tap on `.modal-bg` would land on the switcher itself.
          await pressKey({ key: 'Escape' });
        },
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the switcher never closed',
        until: (isClosed: boolean): boolean => isClosed
      });

      return rows;
    }

    async function editSettings(patch: SwitcherSettingsPatch): Promise<void> {
      await evalInObsidian({
        async callback({ app, patch: newValues, pluginId }): Promise<void> {
          interface SettingsEditor {
            readonly editAndSave: (this: void, settingsEditor: (settings: Record<string, unknown>) => void) => Promise<void>;
          }

          const plugin = app.plugins.getPlugin(pluginId);
          if (!plugin) {
            throw new Error('The plugin is not enabled.');
          }

          // Read structurally rather than asserted through `unknown`: this reaches a member the plugin
          // base keeps protected, so a version that renamed it must fail loudly here.
          if (!('pluginSettingsComponent' in plugin)) {
            throw new Error('The plugin exposes no settings component.');
          }

          const candidate: unknown = plugin.pluginSettingsComponent;
          if (typeof candidate !== 'object' || candidate === null || !('editAndSave' in candidate)) {
            throw new TypeError('The settings component cannot save.');
          }

          await (candidate as SettingsEditor).editAndSave((settings) => {
            Object.assign(settings, newValues);
          });
        },
        input: { patch, pluginId: PLUGIN_ID }
      });
    }

    const noteRows = await collectRows(noteLinkText);
    const attachmentRowsWithoutAttachments = await collectRows(attachmentLinkText);
    await editSettings({ shouldIncludeNonMarkdownFiles: true });
    const attachmentRows = await collectRows(attachmentLinkText);
    await editSettings({ shouldMatchLinkTexts: false });
    const noteRowsWhenOff = await collectRows(noteLinkText);
    const attachmentRowsWhenOff = await collectRows(attachmentLinkText);
    // Left as they were found, because these suites share one Obsidian and one settings file.
    await editSettings({ shouldIncludeNonMarkdownFiles: false, shouldMatchLinkTexts: true });

    expect(noteRows).toStrictEqual([{ flairs: ['Link text'], note: `${folder}/Bravo`, title: noteLinkText }]);
    expect(attachmentRowsWithoutAttachments).toStrictEqual([]);
    expect(attachmentRows).toStrictEqual([{ flairs: ['Link text'], note: attachmentPath, title: attachmentLinkText }]);
    expect(noteRowsWhenOff).toStrictEqual([]);
    expect(attachmentRowsWhenOff).toStrictEqual([]);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
