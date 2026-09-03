import { evalInObsidian } from 'obsidian-integration-testing';
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
 * `evalInObsidian` is one `execute/sync`, which WebDriver caps at 30 seconds.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

const SETTLE_DELAY_IN_MILLISECONDS = 500;

const STAMP_RANGE = 1000;

describe('The excluded paths setting', () => {
  it('stops offering a note as soon as its folder is excluded', async () => {
    const stamp = `${Date.now().toString()}-${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
    const archive = `Archive-${stamp}`;
    const noteName = `Old-${stamp}`;

    await evalInObsidian({
      async callback({ app, archive: archiveFolder, lib: { waitUntil }, noteName: name, waitTimeoutInMilliseconds }): Promise<void> {
        await app.vault.createFolder(archiveFolder);
        await app.vault.create(`${archiveFolder}/${name}.md`, 'archived');
        await waitUntil({
          message: 'the note is in the vault',
          predicate: () => app.vault.getFileByPath(`${archiveFolder}/${name}.md`) !== null,
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });
      },
      input: { archive, noteName, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS }
    });

    async function checkIsOffered(): Promise<boolean> {
      return await evalInObsidian({
        async callback({ app, lib: { waitUntil }, noteName: name, pluginId, settleDelayInMilliseconds, waitTimeoutInMilliseconds }): Promise<boolean> {
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
          input.value = name;
          input.dispatchEvent(new Event('input', { bubbles: true }));

          // A settle rather than a `waitUntil`: one of the two assertions is about a row being ABSENT, and
          // Waiting for an absence that is already true would pass instantly whether or not the list had
          // Been rendered yet.
          await sleep(settleDelayInMilliseconds);
          const isOffered = [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(name));

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

          return isOffered;
        },
        input: {
          noteName,
          pluginId: PLUGIN_ID,
          settleDelayInMilliseconds: SETTLE_DELAY_IN_MILLISECONDS,
          waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        }
      });
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
