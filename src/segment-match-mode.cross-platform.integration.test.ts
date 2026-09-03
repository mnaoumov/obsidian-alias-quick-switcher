import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * The `segmentMatchMode` setting, end to end against a real Obsidian. Under `Substring` — the rule
 * `obsidian-link-picker` uses, and the default — a segment must appear as one unbroken run, so `Brv` finds
 * nothing. Under `Fuzzy` the characters only have to appear in order, so it finds `Bravo`.
 *
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47). Split across calls because one
 * `evalInObsidian` is one `execute/sync`, which WebDriver caps at 30 seconds.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

const SETTLE_DELAY_IN_MILLISECONDS = 500;

const STAMP_RANGE = 1000;

describe('The segment matching setting', () => {
  it('rejects a broken-up segment under substring matching and accepts it under fuzzy', async () => {
    const stamp = `${Date.now().toString()}${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
    const noteName = `Bravo${stamp}`;
    // `Brv` is inside `Bravo` in order but not contiguously — exactly the case the two modes disagree
    // About. The stamp rides along so the query cannot match a note some other suite left behind.
    const brokenUpQuery = `Brv${stamp}`;

    await evalInObsidian({
      async callback({ app, lib: { waitUntil }, noteName: name, waitTimeoutInMilliseconds }): Promise<void> {
        await app.vault.create(`${name}.md`, 'body');
        await waitUntil({
          message: 'the note is in the vault',
          predicate: () => app.vault.getFileByPath(`${name}.md`) !== null,
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });
      },
      input: { noteName, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS }
    });

    async function checkIsFound(): Promise<boolean> {
      return await evalInObsidian({
        async callback({ app, lib: { waitUntil }, noteName: name, pluginId, query, settleDelayInMilliseconds, waitTimeoutInMilliseconds }): Promise<boolean> {
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
          input.value = query;
          input.dispatchEvent(new Event('input', { bubbles: true }));

          // A settle rather than a `waitUntil`, because one of the two assertions is about a row being
          // ABSENT.
          await sleep(settleDelayInMilliseconds);
          const isFound = [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(name));

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

          return isFound;
        },
        input: {
          noteName,
          pluginId: PLUGIN_ID,
          query: brokenUpQuery,
          settleDelayInMilliseconds: SETTLE_DELAY_IN_MILLISECONDS,
          waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        }
      });
    }

    async function setSegmentMatchMode(mode: string): Promise<void> {
      await evalInObsidian({
        async callback({ app, mode: newMode, pluginId }): Promise<void> {
          interface SwitcherSettingsLike {
            segmentMatchMode: string;
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
            settings.segmentMatchMode = newMode;
          });
        },
        input: { mode, pluginId: PLUGIN_ID }
      });
    }

    const wasFoundUnderSubstring = await checkIsFound();
    await setSegmentMatchMode('Fuzzy');
    const wasFoundUnderFuzzy = await checkIsFound();
    // Left as it was found, because these suites share one Obsidian and one settings file.
    await setSegmentMatchMode('Substring');

    expect(wasFoundUnderSubstring).toBe(false);
    expect(wasFoundUnderFuzzy).toBe(true);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
