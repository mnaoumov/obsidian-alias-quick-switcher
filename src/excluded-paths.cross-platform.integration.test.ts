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
 * The `excludedPathPatterns` setting, end to end against a real Obsidian: a note the user excluded is
 * never offered, and the setting takes effect on the next open with no reload.
 *
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47). Split across calls because one
 * `evalInObsidian` is one `execute/sync`, which the transport caps at ~30s — and **the waiting is done
 * from Node** for the same reason: a 60s budget declared inside a closure is one the cap can never
 * honour, so `pollInObsidian` re-runs a short closure until the Node-side `until` accepts.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const MODAL_SELECTOR = '.alias-quick-switcher-modal';
const SUGGESTION_SELECTOR = '.suggestion-item';

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

const SETTLE_DELAY_IN_MILLISECONDS = 500;

const STAMP_RANGE = 1000;

describe('The excluded paths setting', () => {
  it('stops offering a note as soon as its folder is excluded', async () => {
    const stamp = `${Date.now().toString()}-${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
    const archive = `Archive-${stamp}`;
    const noteName = `Old-${stamp}`;

    await pollInObsidian({
      input: { archive, noteName },
      poll({ app, archive: archiveFolder, noteName: name }): boolean {
        return app.vault.getFileByPath(`${archiveFolder}/${name}.md`) !== null;
      },
      async start({ app, archive: archiveFolder, noteName: name }): Promise<void> {
        await app.vault.createFolder(archiveFolder);
        await app.vault.create(`${archiveFolder}/${name}.md`, 'archived');
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the note never appeared in the vault',
      until: (isPresent: boolean): boolean => isPresent
    });

    async function checkIsOffered(): Promise<boolean> {
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

      /*
       * The settle stays INSIDE the closure, and is the one wait that has to: one of the two assertions is
       * about a row being ABSENT, and polling for an absence that is already true would accept instantly
       * whether or not the list had rendered yet. At 500ms it is nowhere near the cap; what made the old
       * shape unsafe was this settle sharing one budget with four 60s waits.
       */
      const isOffered = await evalInObsidian({
        async callback({ modalSelector, noteName: name, settleDelayInMilliseconds, suggestionSelector }): Promise<boolean> {
          const input = document.querySelector(`${modalSelector} .prompt-input`);
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('The switcher has no input.');
          }

          // A dispatched event rather than trusted input (G107): the harness drives keys through
          // Electron's input API, which does not exist on Android, and this has to be proven on both.
          input.value = name;
          input.dispatchEvent(new Event('input', { bubbles: true }));

          await sleep(settleDelayInMilliseconds);

          return [...document.querySelectorAll(suggestionSelector)].some((el) => el.textContent.includes(name));
        },
        input: {
          modalSelector: MODAL_SELECTOR,
          noteName,
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

      return isOffered;
    }

    async function setExcludedPaths(patterns: string[]): Promise<void> {
      await evalInObsidian({
        async callback({ app, patterns: newPatterns, pluginId }): Promise<void> {
          interface SwitcherSettingsLike {
            excludedPathPatterns: string[];
          }

          interface SettingsEditor {
            editAndSave(this: void, settingsEditor: (settings: SwitcherSettingsLike) => void): Promise<void>;
          }

          const plugin = app.plugins.getPlugin(pluginId);
          if (!plugin) {
            throw new Error('The plugin is not enabled.');
          }

          // Read structurally rather than asserted through `unknown`: this reaches a member the plugin
          // Base keeps protected, so a version that renamed it must fail loudly here rather than at the
          // First property access.
          if (!('pluginSettingsComponent' in plugin)) {
            throw new Error('The plugin exposes no settings component.');
          }

          const candidate: unknown = plugin.pluginSettingsComponent;
          if (typeof candidate !== 'object' || candidate === null || !('editAndSave' in candidate)) {
            throw new TypeError('The settings component cannot save.');
          }

          await (candidate as SettingsEditor).editAndSave((settings) => {
            settings.excludedPathPatterns = newPatterns;
          });
        },
        input: { patterns, pluginId: PLUGIN_ID }
      });
    }

    const wasOfferedBeforeExcluding = await checkIsOffered();
    await setExcludedPaths([archive]);
    const wasOfferedAfterExcluding = await checkIsOffered();
    // Left as it was found, because these suites share one Obsidian and one settings file.
    await setExcludedPaths([]);

    expect(wasOfferedBeforeExcluding).toBe(true);
    expect(wasOfferedAfterExcluding).toBe(false);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
