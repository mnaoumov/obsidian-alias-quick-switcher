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
 * The one UI decision no competitor makes, end to end against a real Obsidian: a row shows the path AS
 * MATCHED — the satisfying label in place of each real name — with the real path beneath it when the two
 * differ. Without it the user cannot tell why a row matched.
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

interface RowRendering {
  readonly hasAliasFlair: boolean;
  readonly hasSecondLine: boolean;
  readonly highlights: readonly string[];
  readonly labels: string;
  readonly realPath: string;
}

describe('The matched rendering', () => {
  it('shows the labels that satisfied the query, with the real path beneath them', async () => {
    const stamp = `${Date.now().toString()}-${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
    const alpha = `Alpha-${stamp}`;
    const bravo = `Bravo-${stamp}`;
    const charlie = `Charlie-${stamp}`;
    const delta = `Delta-${stamp}`;
    const echo = `Echo-${stamp}`;

    await pollInObsidian({
      input: { alpha, bravo, charlie, delta, echo },
      poll({ alpha: alphaName, app, bravo: bravoName, charlie: charlieName }): boolean {
        const folderNote = app.vault.getFileByPath(`${alphaName}/${bravoName}/${bravoName}.md`);
        const leaf = app.vault.getFileByPath(`${alphaName}/${bravoName}/${charlieName}.md`);
        if (!folderNote || !leaf) {
          return false;
        }

        return Boolean(app.metadataCache.getFileCache(folderNote)?.frontmatter)
          && Boolean(app.metadataCache.getFileCache(leaf)?.frontmatter);
      },
      async start({ alpha: alphaName, app, bravo: bravoName, charlie: charlieName, delta: deltaAlias, echo: echoAlias }): Promise<void> {
        await app.vault.createFolder(`${alphaName}/${bravoName}`);
        await app.vault.create(`${alphaName}/${bravoName}/${bravoName}.md`, `---\naliases:\n  - ${deltaAlias}\n---\n`);
        await app.vault.create(`${alphaName}/${bravoName}/${charlieName}.md`, `---\naliases:\n  - ${echoAlias}\n---\n`);
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'both aliases never reached the metadata cache',
      until: (areCached: boolean): boolean => areCached
    });

    async function readRow(query: string): Promise<RowRendering> {
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
        input: { suggestionSelector: SUGGESTION_SELECTOR, targetName: charlie },
        poll({ suggestionSelector, targetName }): boolean {
          return [...document.querySelectorAll(suggestionSelector)].some((el) => el.textContent.includes(targetName));
        },
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: `no row was ever offered for ${query}`,
        until: (isOffered: boolean): boolean => isOffered
      });

      // The whole rendering is read in ONE closure: reading it across separate round trips would let a
      // Re-render change the row between the five reads.
      const rendering = await evalInObsidian({
        callback({ suggestionSelector, targetName }): RowRendering {
          const row = [...document.querySelectorAll(suggestionSelector)].find((el) => el.textContent.includes(targetName));
          if (!(row instanceof HTMLElement)) {
            throw new TypeError('No row was offered.');
          }

          const read: RowRendering = {
            hasAliasFlair: row.querySelector(':scope .suggestion-aux .suggestion-flair') !== null,
            hasSecondLine: row.querySelector('.suggestion-note') !== null,
            highlights: [...row.querySelectorAll('.suggestion-highlight')].map((el) => el.textContent),
            labels: row.querySelector('.suggestion-title')?.textContent ?? '',
            realPath: row.querySelector('.suggestion-note')?.textContent ?? ''
          };

          return read;
        },
        input: { suggestionSelector: SUGGESTION_SELECTOR, targetName: charlie }
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

      return rendering;
    }

    const aliasRow = await readRow(`${alpha}/${delta}/${echo}`);
    const realNameRow = await readRow(`${alpha}/${bravo}/${charlie}`);
    const leafOnlyRow = await readRow(echo);

    expect(aliasRow.labels).toBe(`${alpha}/${delta}/${echo}`);

    // The second line drops the markdown extension, the way the built-in's own alias row does.
    expect(aliasRow.realPath).toBe(`${alpha}/${bravo}/${charlie}`);
    expect(aliasRow.highlights).toHaveLength(3);

    // The same flair the built-in puts on an alias hit.
    expect(aliasRow.hasAliasFlair).toBe(true);

    // Nothing about this match differs from the path, so a second line would only repeat it — and no
    // Alias was involved, so there is nothing to flair either.
    expect(realNameRow.hasSecondLine).toBe(false);
    expect(realNameRow.hasAliasFlair).toBe(false);

    // A leaf-only alias hit renders the alias ALONE, which is exactly what the built-in does with it.
    expect(leafOnlyRow.labels).toBe(echo);
    expect(leafOnlyRow.realPath).toBe(`${alpha}/${bravo}/${charlie}`);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
