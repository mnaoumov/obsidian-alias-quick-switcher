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
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47).
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

interface SegmentMatchModeResult {
  readonly wasFoundUnderFuzzy: boolean;
  readonly wasFoundUnderSubstring: boolean;
}

describe('The segment matching setting', () => {
  it('rejects a broken-up segment under substring matching and accepts it under fuzzy', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, pluginId }): Promise<SegmentMatchModeResult> {
        interface SwitcherSettingsLike {
          segmentMatchMode: string;
        }

        interface SettingsEditor {
          editAndSave(this: void, settingsEditor: (settings: SwitcherSettingsLike) => void): Promise<void>;
        }

        const WAIT_TIMEOUT_IN_MILLISECONDS = 30_000;
        const SETTLE_DELAY_IN_MILLISECONDS = 400;
        const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
        const noteName = `Bravo${stamp}`;
        // `Brv` is inside `Bravo` in order but not contiguously — exactly the case the two modes disagree
        // About. The stamp rides along so the query cannot match a note some other suite left behind.
        const brokenUpQuery = `Brv${stamp}`;

        await app.vault.create(`${noteName}.md`, 'body');
        await waitUntil({
          message: 'the note is in the vault',
          predicate: () => app.vault.getFileByPath(`${noteName}.md`) !== null,
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

        async function checkIsFound(): Promise<boolean> {
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
          input.value = brokenUpQuery;
          input.dispatchEvent(new Event('input', { bubbles: true }));

          // A short settle rather than a `waitUntil`, because one of the two assertions is about a row
          // Being ABSENT.
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);
          const isFound = [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(noteName));

          // Trusted input, so the modal really receives the key the way a user's Escape reaches it.
          pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'the switcher closed',
            predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          return isFound;
        }

        const wasFoundUnderSubstring = await checkIsFound();

        await settingsComponent.editAndSave((settings) => {
          settings.segmentMatchMode = 'Fuzzy';
        });

        const wasFoundUnderFuzzy = await checkIsFound();

        // Left as it was found, because these suites share one Obsidian and one settings file.
        await settingsComponent.editAndSave((settings) => {
          settings.segmentMatchMode = 'Substring';
        });

        return { wasFoundUnderFuzzy, wasFoundUnderSubstring };
      },
      input: { pluginId: PLUGIN_ID }
    });

    expect(result.wasFoundUnderSubstring).toBe(false);
    expect(result.wasFoundUnderFuzzy).toBe(true);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
