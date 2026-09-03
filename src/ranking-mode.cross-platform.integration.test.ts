import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * The `rankingMode` setting, end to end against a real Obsidian, and with it the promise the default
 * carries: under `Tiered` a note matched by its REAL NAME outranks one matched by an alias, so turning the
 * plugin on never reshuffles the results Obsidian's own switcher already gives. `LinkPicker` ranks by how
 * well the query matched instead and deliberately gives that up — here the alias hit is the exact one, so
 * it comes first.
 *
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47).
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

interface RankingModeResult {
  readonly firstRowUnderLinkPicker: string;
  readonly firstRowUnderTiered: string;
}

describe('The ranking setting', () => {
  it('puts real names first under tiered ranking and the strongest match first under link picker ranking', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, pluginId }): Promise<RankingModeResult> {
        interface SwitcherSettingsLike {
          rankingMode: string;
        }

        interface SettingsEditor {
          editAndSave(this: void, settingsEditor: (settings: SwitcherSettingsLike) => void): Promise<void>;
        }

        const WAIT_TIMEOUT_IN_MILLISECONDS = 30_000;
        const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
        const query = `Kilo${stamp}`;

        // The real-name note only PREFIXES the query, while the aliased note matches it EXACTLY. So the
        // Two orders genuinely disagree: one leads with the real name, the other with the stronger match.
        const realNameNote = `${query}Extra`;
        const aliasedNote = `Lima${stamp}`;

        await app.vault.create(`${realNameNote}.md`, 'body');
        await app.vault.create(`${aliasedNote}.md`, `---\naliases:\n  - ${query}\n---\n`);

        // `getFileByPath` answers `null` until the vault has caught up and `getFileCache` needs a real
        // File, so the two questions are asked together rather than nested.
        function checkHasFrontmatter(path: string): boolean {
          const file = app.vault.getFileByPath(path);
          return file !== null && Boolean(app.metadataCache.getFileCache(file)?.frontmatter);
        }

        await waitUntil({
          message: 'the alias is in the metadata cache',
          predicate: () => checkHasFrontmatter(`${aliasedNote}.md`),
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

        async function readFirstRow(): Promise<string> {
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
          input.value = query;
          input.dispatchEvent(new Event('input', { bubbles: true }));

          await waitUntil({
            message: 'both notes are offered',
            predicate: () => {
              const rows = [...document.querySelectorAll('.suggestion-item')];
              return rows.some((el) => el.textContent.includes(realNameNote)) && rows.some((el) => el.textContent.includes(aliasedNote));
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          const firstRowText = document.querySelector('.suggestion-item')?.textContent ?? '';

          // Trusted input, so the modal really receives the key the way a user's Escape reaches it.
          pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'the switcher closed',
            predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          return firstRowText;
        }

        const firstRowUnderTiered = await readFirstRow();

        await settingsComponent.editAndSave((settings) => {
          settings.rankingMode = 'LinkPicker';
        });

        const firstRowUnderLinkPicker = await readFirstRow();

        // Left as it was found, because these suites share one Obsidian and one settings file.
        await settingsComponent.editAndSave((settings) => {
          settings.rankingMode = 'Tiered';
        });

        return { firstRowUnderLinkPicker, firstRowUnderTiered };
      },
      input: { pluginId: PLUGIN_ID }
    });

    expect(result.firstRowUnderTiered).toMatch(/^Kilo.+Extra/);
    expect(result.firstRowUnderLinkPicker).toMatch(/^Kilo/);
    expect(result.firstRowUnderLinkPicker).not.toBe(result.firstRowUnderTiered);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
