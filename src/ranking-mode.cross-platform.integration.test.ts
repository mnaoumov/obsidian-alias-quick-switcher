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
 * The `rankingMode` setting, end to end against a real Obsidian, and with it the promise the default
 * carries: under `Tiered` a note matched by its REAL NAME outranks one matched by an alias, so turning the
 * plugin on never reshuffles the results Obsidian's own switcher already gives. `LinkPicker` ranks by how
 * well the query matched instead and deliberately gives that up — here the alias hit is the exact one, so
 * it comes first.
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

const STAMP_RANGE = 1000;

describe('The ranking setting', () => {
  it('puts real names first under tiered ranking and the strongest match first under link picker ranking', async () => {
    const stamp = `${Date.now().toString()}${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
    const query = `Kilo${stamp}`;
    // The real-name note only PREFIXES the query, while the aliased note matches it EXACTLY. So the two
    // orders genuinely disagree: one leads with the real name, the other with the stronger match.
    const realNameNote = `${query}Extra`;
    const aliasedNote = `Lima${stamp}`;

    await pollInObsidian({
      input: { aliasedNote, query, realNameNote },
      poll({ aliasedNote: aliased, app }): boolean {
        const file = app.vault.getFileByPath(`${aliased}.md`);
        return file !== null && Boolean(app.metadataCache.getFileCache(file)?.frontmatter);
      },
      async start({ aliasedNote: aliased, app, query: aliasText, realNameNote: realName }): Promise<void> {
        await app.vault.create(`${realName}.md`, 'body');
        await app.vault.create(`${aliased}.md`, `---\naliases:\n  - ${aliasText}\n---\n`);
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the alias never reached the metadata cache',
      until: (isCached: boolean): boolean => isCached
    });

    async function readFirstRow(): Promise<string> {
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

      await evalInObsidian({
        callback({ modalSelector, query: currentQuery }): void {
          const input = document.querySelector(`${modalSelector} .prompt-input`);
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('The switcher has no input.');
          }

          // A dispatched event rather than trusted input: the harness drives keys through
          // Electron's input API, which does not exist on Android, and this has to be proven on both.
          input.value = currentQuery;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        },
        input: { modalSelector: MODAL_SELECTOR, query }
      });

      await pollInObsidian({
        input: { aliasedNote, realNameNote, suggestionSelector: SUGGESTION_SELECTOR },
        poll({ aliasedNote: aliased, realNameNote: realName, suggestionSelector }): boolean {
          const rows = [...document.querySelectorAll(suggestionSelector)];
          return rows.some((el) => el.textContent.includes(realName)) && rows.some((el) => el.textContent.includes(aliased));
        },
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'both notes were never offered together',
        until: (areBothOffered: boolean): boolean => areBothOffered
      });

      // The row is read in ONE closure: reading it after a separate round trip would let a re-render
      // reorder the list under the assertion.
      const firstRowText = await evalInObsidian({
        callback({ suggestionSelector }): string {
          const text = document.querySelector(suggestionSelector)?.textContent ?? '';

          return text;
        },
        input: { suggestionSelector: SUGGESTION_SELECTOR }
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

      return firstRowText;
    }

    async function setRankingMode(mode: string): Promise<void> {
      await evalInObsidian({
        async callback({ app, mode: newMode, pluginId }): Promise<void> {
          interface SwitcherSettingsLike {
            rankingMode: string;
          }

          interface SettingsEditor {
            editAndSave: (this: void, settingsEditor: (settings: SwitcherSettingsLike) => void) => Promise<void>;
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
