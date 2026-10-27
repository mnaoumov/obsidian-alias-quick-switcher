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
 * The row's markers, end to end against a real Obsidian: an alias hit and a frontmatter-property hit are
 * told apart at a glance, and each marker actually DRAWS.
 *
 * The second half is why this suite exists at all. `IconName` is unconstrained in `obsidian.d.ts`, so a
 * misspelt icon id compiles, passes every unit test — the mock's `setIcon` does not resolve anything —
 * and ships as a blank flair nobody notices. Only a real app can say whether `lucide-forward` and
 * `lucide-text` are ids Obsidian resolves, which is what `getIconIds()` is asked here.
 *
 * DESKTOP rather than cross-platform, deliberately: the icon set is bundled with the app and is the same
 * on both platforms, while the Android leg's ~30s per-eval budget is the scarce thing in this repo (see
 * `AGENTS.md`). Nothing here is platform-dependent, so paying that budget twice would buy nothing.
 */

const PLUGIN_ID = 'alias-quick-switcher';

// The plugin that owns the title properties this switcher reads, and whose Titles module a frame switches on.
const ADVANCED_METADATA_CACHE_PLUGIN_ID = 'advanced-metadata-cache';

const ALIAS_FLAIR_ICON_ID = 'lucide-forward';
const PROPERTY_FLAIR_ICON_ID = 'lucide-text';

const TITLE_PROPERTY_NAME = 'title';

const MODAL_SELECTOR = '.alias-quick-switcher-modal';
const SUGGESTION_SELECTOR = '.suggestion-item';

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

const STAMP_RANGE = 1000;

interface RenderedFlair {
  readonly ariaLabel: null | string;
  readonly iconClass: null | string;
}

describe('The source flairs', () => {
  it('names both of its markers with icon ids Obsidian actually resolves', async () => {
    const found = await evalInObsidian({
      callback({ aliasIconId, obsidianModule, propertyIconId }): Record<string, boolean> {
        const iconIds = new Set(obsidianModule.getIconIds());
        return { [aliasIconId]: iconIds.has(aliasIconId), [propertyIconId]: iconIds.has(propertyIconId) };
      },
      input: { aliasIconId: ALIAS_FLAIR_ICON_ID, propertyIconId: PROPERTY_FLAIR_ICON_ID }
    });

    expect(found).toStrictEqual({ [ALIAS_FLAIR_ICON_ID]: true, [PROPERTY_FLAIR_ICON_ID]: true });
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('marks an alias hit and a property hit differently on the same row', async () => {
    const stamp = `${Date.now().toString()}-${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
    const alpha = `Alpha-${stamp}`;
    const bravo = `Bravo-${stamp}`;
    const charlie = `Charlie-${stamp}`;
    const delta = `Delta-${stamp}`;
    const foxtrot = `Foxtrot-${stamp}`;

    await pollInObsidian({
      input: { alpha, bravo, charlie, delta, foxtrot },
      poll({ alpha: alphaName, app, bravo: bravoName, charlie: charlieName }): boolean {
        const folderNote = app.vault.getFileByPath(`${alphaName}/${bravoName}/${bravoName}.md`);
        const leaf = app.vault.getFileByPath(`${alphaName}/${bravoName}/${charlieName}.md`);
        return folderNote !== null && leaf !== null
          && Boolean(app.metadataCache.getFileCache(folderNote)?.frontmatter)
          && Boolean(app.metadataCache.getFileCache(leaf)?.frontmatter);
      },
      async start({ alpha: alphaName, app, bravo: bravoName, charlie: charlieName, delta: deltaAlias, foxtrot: foxtrotTitle }): Promise<void> {
        await app.vault.createFolder(`${alphaName}/${bravoName}`);

        // The folder answers to an ALIAS, the note to a frontmatter PROPERTY — so one row needs both
        // markers, which is the case the built-in switcher has no vocabulary for.
        await app.vault.create(`${alphaName}/${bravoName}/${bravoName}.md`, `---\naliases:\n  - ${deltaAlias}\n---\n`);
        await app.vault.create(`${alphaName}/${bravoName}/${charlieName}.md`, `---\ntitle: ${foxtrotTitle}\n---\n`);
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the alias and the title never reached the metadata cache',
      until: (areCached: boolean): boolean => areCached
    });

    async function setTitleProperties(propertyNames: string[]): Promise<void> {
      await evalInObsidian({
        async callback({ app, pluginId, propertyNames: newPropertyNames }): Promise<void> {
          interface SettingsEditor {
            editAndSave: (this: void, settingsEditor: (settings: TitlesSettingsLike) => void) => Promise<void>;
          }

          interface TitlesSettingsLike {
            isTitlesModuleEnabled: boolean;
            titlePropertyNames: string[];
          }

          const plugin = app.plugins.getPlugin(pluginId);
          if (!plugin) {
            throw new Error('The plugin is not enabled.');
          }

          // Read structurally rather than asserted through `unknown`: this reaches a member the plugin
          // base keeps protected, so a version that renamed it must fail loudly here rather than at the
          // first property access.
          if (!('pluginSettingsComponent' in plugin)) {
            throw new Error('The plugin exposes no settings component.');
          }

          const candidate: unknown = plugin.pluginSettingsComponent;
          if (typeof candidate !== 'object' || candidate === null || !('editAndSave' in candidate)) {
            throw new TypeError('The settings component cannot save.');
          }

          await (candidate as SettingsEditor).editAndSave((settings) => {
            settings.isTitlesModuleEnabled = newPropertyNames.length > 0;
            // Left as it was on the way out, so switching the module off restores exactly what a fresh install has.
            if (newPropertyNames.length > 0) {
              settings.titlePropertyNames = newPropertyNames;
            }
          });
        },
        input: { pluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID, propertyNames }
      });
    }

    async function readFlairs(query: string): Promise<RenderedFlair[]> {
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

          // A NOTIFICATION event, not a pretend keystroke: nothing on this path gates on `isTrusted`, and
          // `SuggestModal` rebuilds its list from this `input` event exactly as a real keystroke makes it.
          // Kept over a per-character trusted `pressKey` deliberately — `AGENTS.md` says what that costs.
          input.value = currentQuery;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        },
        input: { modalSelector: MODAL_SELECTOR, query }
      });

      await pollInObsidian({
        input: { suggestionSelector: SUGGESTION_SELECTOR, targetName: charlie },
        poll({ suggestionSelector, targetName }): boolean {
          return [...document.querySelectorAll(suggestionSelector)].some((el) => el.textContent.includes(targetName));
        },
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: `no row was ever offered for ${query}`,
        until: (isOffered: boolean): boolean => isOffered
      });

      const flairs = await evalInObsidian({
        callback({ suggestionSelector, targetName }): RenderedFlair[] {
          const row = [...document.querySelectorAll(suggestionSelector)].find((el) => el.textContent.includes(targetName));
          if (!(row instanceof HTMLElement)) {
            throw new TypeError('No row was offered.');
          }

          // The svg's class is read, not merely its presence: a blank flair is what a misspelt icon id
          // produces, and two markers that both drew the SAME glyph would pass a presence check while
          // conveying nothing.
          return [...row.querySelectorAll(':scope .suggestion-aux .suggestion-flair')].map((flair) => ({
            ariaLabel: flair.getAttribute('aria-label'),
            iconClass: flair.querySelector('svg')?.getAttribute('class') ?? null
          }));
        },
        input: { suggestionSelector: SUGGESTION_SELECTOR, targetName: charlie }
      });

      await pollInObsidian({
        input: { modalSelector: MODAL_SELECTOR },
        poll({ modalSelector }): boolean {
          return document.querySelector(modalSelector) === null;
        },
        async start({ lib: { pressKey } }): Promise<void> {
          // Closed with a trusted Escape, which the harness delivers on Android too since 12.0.0. A click
          // on `.modal-bg` was the old answer and is the wrong one now: a TRUSTED tap is hit-tested at the
          // element's centre, and the background's centre lies behind the switcher.
          await pressKey({ key: 'Escape' });
        },
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the switcher never closed',
        until: (isClosed: boolean): boolean => isClosed
      });

      return flairs;
    }

    await setTitleProperties([TITLE_PROPERTY_NAME]);
    const mixedRowFlairs = await readFlairs(`${alpha}/${delta}/${foxtrot}`);
    const realNameRowFlairs = await readFlairs(`${alpha}/${bravo}/${charlie}`);
    // Left as it was found, because these suites share one Obsidian and one settings file.
    await setTitleProperties([]);

    // In PATH order, so the markers read left to right in the same order as the labels they explain.
    expect(mixedRowFlairs).toHaveLength(2);
    expect(mixedRowFlairs[0]?.ariaLabel).toBe('Alias');
    expect(mixedRowFlairs[0]?.iconClass).toContain(ALIAS_FLAIR_ICON_ID);

    // The tooltip names the frontmatter key, because one glyph stands for every configured property.
    expect(mixedRowFlairs[1]?.ariaLabel).toBe(TITLE_PROPERTY_NAME);
    expect(mixedRowFlairs[1]?.iconClass).toContain(PROPERTY_FLAIR_ICON_ID);

    // A row matched by real names alone earns no marker: there is nothing to explain.
    expect(realNameRowFlairs).toStrictEqual([]);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
