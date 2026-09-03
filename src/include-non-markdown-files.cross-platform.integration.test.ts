import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * The `shouldIncludeNonMarkdownFiles` setting, end to end against a real Obsidian: files that are not
 * notes are left out until the user asks for them, the way Obsidian's own switcher behaves.
 *
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47).
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

interface IncludeNonMarkdownResult {
  readonly wasOfferedWhenIncluded: boolean;
  readonly wasOfferedWhenNotIncluded: boolean;
}

describe('The include non-markdown files setting', () => {
  it('leaves a canvas out by default and offers it once turned on', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, pluginId }): Promise<IncludeNonMarkdownResult> {
        interface SwitcherSettingsLike {
          shouldIncludeNonMarkdownFiles: boolean;
        }

        interface SettingsEditor {
          editAndSave(this: void, settingsEditor: (settings: SwitcherSettingsLike) => void): Promise<void>;
        }

        const WAIT_TIMEOUT_IN_MILLISECONDS = 30_000;
        const SETTLE_DELAY_IN_MILLISECONDS = 400;
        const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
        const canvasName = `Diagram-${stamp}`;

        await app.vault.create(`${canvasName}.canvas`, '{}');
        await waitUntil({
          message: 'the canvas is in the vault',
          predicate: () => app.vault.getFileByPath(`${canvasName}.canvas`) !== null,
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
          input.value = canvasName;
          input.dispatchEvent(new Event('input', { bubbles: true }));

          // A short settle rather than a `waitUntil`, because one of the two assertions is about a row
          // Being ABSENT.
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);
          const isOffered = [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(canvasName));

          // Trusted input, so the modal really receives the key the way a user's Escape reaches it.
          pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'the switcher closed',
            predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          return isOffered;
        }

        const wasOfferedWhenNotIncluded = await checkIsOffered();

        await settingsComponent.editAndSave((settings) => {
          settings.shouldIncludeNonMarkdownFiles = true;
        });

        const wasOfferedWhenIncluded = await checkIsOffered();

        // Left as it was found, because these suites share one Obsidian and one settings file.
        await settingsComponent.editAndSave((settings) => {
          settings.shouldIncludeNonMarkdownFiles = false;
        });

        return { wasOfferedWhenIncluded, wasOfferedWhenNotIncluded };
      },
      input: { pluginId: PLUGIN_ID }
    });

    expect(result.wasOfferedWhenNotIncluded).toBe(false);
    expect(result.wasOfferedWhenIncluded).toBe(true);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
