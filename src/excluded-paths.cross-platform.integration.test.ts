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
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47).
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

interface ExcludedPathsResult {
  readonly wasOfferedAfterExcluding: boolean;
  readonly wasOfferedBeforeExcluding: boolean;
}

describe('The excluded paths setting', () => {
  it('stops offering a note as soon as its folder is excluded', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, pluginId }): Promise<ExcludedPathsResult> {
        interface SwitcherSettingsLike {
          excludedPathPatterns: string[];
        }

        interface SettingsEditor {
          editAndSave(this: void, settingsEditor: (settings: SwitcherSettingsLike) => void): Promise<void>;
        }

        const WAIT_TIMEOUT_IN_MILLISECONDS = 30_000;
        const SETTLE_DELAY_IN_MILLISECONDS = 400;
        const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
        const archive = `Archive-${stamp}`;
        const noteName = `Old-${stamp}`;

        await app.vault.createFolder(archive);
        await app.vault.create(`${archive}/${noteName}.md`, 'archived');
        await waitUntil({
          message: 'the note is in the vault',
          predicate: () => app.vault.getFileByPath(`${archive}/${noteName}.md`) !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

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

        const settingsComponentCandidate: unknown = plugin.pluginSettingsComponent;
        if (typeof settingsComponentCandidate !== 'object' || settingsComponentCandidate === null || !('editAndSave' in settingsComponentCandidate)) {
          throw new TypeError('The settings component cannot save.');
        }

        const settingsComponent = settingsComponentCandidate as SettingsEditor;

        async function checkIsOffered(): Promise<boolean> {
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
          input.value = noteName;
          input.dispatchEvent(new Event('input', { bubbles: true }));

          // A short settle rather than a `waitUntil`: the assertion is about a row being ABSENT, and
          // Waiting for an absence that is already true would pass instantly whether or not the list had
          // Been rendered yet.
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);
          const isOffered = [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(noteName));

          // Trusted input, so the modal really receives the key the way a user's Escape reaches it.
          pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'the switcher closed',
            predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          return isOffered;
        }

        const wasOfferedBeforeExcluding = await checkIsOffered();

        await settingsComponent.editAndSave((settings) => {
          settings.excludedPathPatterns = [archive];
        });

        const wasOfferedAfterExcluding = await checkIsOffered();

        // Left as it was found, because these suites share one Obsidian and one settings file.
        await settingsComponent.editAndSave((settings) => {
          settings.excludedPathPatterns = [];
        });

        return { wasOfferedAfterExcluding, wasOfferedBeforeExcluding };
      },
      input: { pluginId: PLUGIN_ID }
    });

    expect(result.wasOfferedBeforeExcluding).toBe(true);
    expect(result.wasOfferedAfterExcluding).toBe(false);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
