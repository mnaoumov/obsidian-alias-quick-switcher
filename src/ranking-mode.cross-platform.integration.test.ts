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
 * Cross-platform: the manifest declares `isDesktopOnly: false` (G47). Split across calls because one
 * `evalInObsidian` is one `execute/sync`, which WebDriver caps at 30 seconds.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

const STAMP_RANGE = 1000;

describe('The ranking setting', () => {
  it('puts real names first under tiered ranking and the strongest match first under link picker ranking', async () => {
    const stamp = `${Date.now().toString()}${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
    const query = `Kilo${stamp}`;
    // The real-name note only PREFIXES the query, while the aliased note matches it EXACTLY. So the two
    // Orders genuinely disagree: one leads with the real name, the other with the stronger match.
    const realNameNote = `${query}Extra`;
    const aliasedNote = `Lima${stamp}`;

    await evalInObsidian({
      async callback({ aliasedNote: aliased, app, lib: { waitUntil }, query: aliasText, realNameNote: realName, waitTimeoutInMilliseconds }): Promise<void> {
        await app.vault.create(`${realName}.md`, 'body');
        await app.vault.create(`${aliased}.md`, `---\naliases:\n  - ${aliasText}\n---\n`);

        await waitUntil({
          message: 'the alias is in the metadata cache',
          predicate: () => {
            const file = app.vault.getFileByPath(`${aliased}.md`);
            return file !== null && Boolean(app.metadataCache.getFileCache(file)?.frontmatter);
          },
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });
      },
      input: { aliasedNote, query, realNameNote, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS }
    });

    async function readFirstRow(): Promise<string> {
      return await evalInObsidian({
        async callback({ aliasedNote: aliased, app, lib: { waitUntil }, pluginId, query: currentQuery, realNameNote: realName, waitTimeoutInMilliseconds }): Promise<string> {
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
          input.value = currentQuery;
          input.dispatchEvent(new Event('input', { bubbles: true }));

          await waitUntil({
            message: 'both notes are offered',
            predicate: () => {
              const rows = [...document.querySelectorAll('.suggestion-item')];
              return rows.some((el) => el.textContent.includes(realName)) && rows.some((el) => el.textContent.includes(aliased));
            },
            timeoutInMilliseconds: waitTimeoutInMilliseconds
          });

          const firstRowText = document.querySelector('.suggestion-item')?.textContent ?? '';

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

          return firstRowText;
        },
        input: { aliasedNote, pluginId: PLUGIN_ID, query, realNameNote, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS }
      });
    }

    async function setRankingMode(mode: string): Promise<void> {
      await evalInObsidian({
        async callback({ app, mode: newMode, pluginId }): Promise<void> {
          interface SwitcherSettingsLike {
            rankingMode: string;
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
            settings.rankingMode = newMode;
          });
        },
        input: { mode, pluginId: PLUGIN_ID }
      });
    }

    const firstRowUnderTiered = await readFirstRow();
    await setRankingMode('LinkPicker');
    const firstRowUnderLinkPicker = await readFirstRow();
    // Left as it was found, because these suites share one Obsidian and one settings file.
    await setRankingMode('Tiered');

    expect(firstRowUnderTiered.startsWith(realNameNote)).toBe(true);
    expect(firstRowUnderLinkPicker.startsWith(query)).toBe(true);
    expect(firstRowUnderLinkPicker).not.toBe(firstRowUnderTiered);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
