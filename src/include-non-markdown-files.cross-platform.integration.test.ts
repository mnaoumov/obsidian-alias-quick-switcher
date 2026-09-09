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
 * The `shouldIncludeNonMarkdownFiles` setting, end to end against a real Obsidian: files that are not
 * notes are left out until the user asks for them, the way Obsidian's own switcher behaves.
 *
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47). Split across calls because one
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

describe('The include non-markdown files setting', () => {
  it('leaves a canvas out by default and offers it once turned on', async () => {
    const stamp = `${Date.now().toString()}-${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
    const canvasName = `Diagram-${stamp}`;

    await pollInObsidian({
      input: { canvasName },
      poll({ app, canvasName: name }): boolean {
        return app.vault.getFileByPath(`${name}.canvas`) !== null;
      },
      async start({ app, canvasName: name }): Promise<void> {
        await app.vault.create(`${name}.canvas`, '{}');
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the canvas never appeared in the vault',
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

      // The settle stays INSIDE the closure, and is the one wait that has to: one of the two assertions is
      // About a row being ABSENT, and polling for an absence that is already true would accept instantly
      // Whether or not the list had rendered yet. At 500ms it is nowhere near the cap.
      const isOffered = await evalInObsidian({
        async callback({ canvasName: name, modalSelector, settleDelayInMilliseconds, suggestionSelector }): Promise<boolean> {
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
          canvasName,
          modalSelector: MODAL_SELECTOR,
          settleDelayInMilliseconds: SETTLE_DELAY_IN_MILLISECONDS,
          suggestionSelector: SUGGESTION_SELECTOR
        }
      });

      await pollInObsidian({
        input: { modalSelector: MODAL_SELECTOR },
        poll({ modalSelector }): boolean {
          return document.querySelector(modalSelector) === null;
        },
        start(): void {
          // Closed by clicking the modal background rather than by pressing Escape: the harness's
          // Trusted-key helpers are Electron-only (they reach for `remote`, which Android has none of),
          // And a dispatched KeyboardEvent is untrusted and ignored. A plain click is the one gesture
          // That works on both.
          const background = document.querySelector('.modal-bg');
          if (background instanceof HTMLElement) {
            background.click();
          }
        },
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the switcher never closed',
        until: (isClosed: boolean): boolean => isClosed
      });

      return isOffered;
    }

    async function setShouldIncludeNonMarkdownFiles(shouldInclude: boolean): Promise<void> {
      await evalInObsidian({
        async callback({ app, pluginId, shouldInclude: newValue }): Promise<void> {
          interface SwitcherSettingsLike {
            shouldIncludeNonMarkdownFiles: boolean;
          }

          interface SettingsEditor {
            editAndSave(this: void, settingsEditor: (settings: SwitcherSettingsLike) => void): Promise<void>;
          }

          const plugin = app.plugins.getPlugin(pluginId);
          if (!plugin) {
            throw new Error('The plugin is not enabled.');
          }

          // Read structurally rather than asserted through `unknown`: this reaches a member the plugin
          // Base keeps protected, so a version that renamed it must fail loudly here.
          if (!('pluginSettingsComponent' in plugin)) {
            throw new Error('The plugin exposes no settings component.');
          }

          const candidate: unknown = plugin.pluginSettingsComponent;
          if (typeof candidate !== 'object' || candidate === null || !('editAndSave' in candidate)) {
            throw new TypeError('The settings component cannot save.');
          }

          await (candidate as SettingsEditor).editAndSave((settings) => {
            settings.shouldIncludeNonMarkdownFiles = newValue;
          });
        },
        input: { pluginId: PLUGIN_ID, shouldInclude }
      });
    }

    const wasOfferedWhenNotIncluded = await checkIsOffered();
    await setShouldIncludeNonMarkdownFiles(true);
    const wasOfferedWhenIncluded = await checkIsOffered();
    // Left as it was found, because these suites share one Obsidian and one settings file.
    await setShouldIncludeNonMarkdownFiles(false);

    expect(wasOfferedWhenNotIncluded).toBe(false);
    expect(wasOfferedWhenIncluded).toBe(true);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
