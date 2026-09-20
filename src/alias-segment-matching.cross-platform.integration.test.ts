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
 * The reason the plugin exists, end to end against a real Obsidian.
 *
 * Measured over CDP on Obsidian 1.13.7 before any code was written: the built-in switcher returns an EMPTY
 * list for `Alpha/Bravo/Echo`, `Alpha/Delta/Charlie` and `Alpha/Delta/Echo`, because it scores a candidate
 * as `max(fuzzy(query, path), fuzzy(query, alias))` and never combines the two. All three must find the
 * note here, and so must the forms the built-in already handles.
 *
 * Cross-platform: the manifest declares `isDesktopOnly: false`. One query per pass, and **the waiting
 * happens in NODE**: a call is one `execute/sync`, the transport caps a single script at ~30s, and a
 * closure that waits inside that budget is one that dies on a cold phone. Each closure below is
 * milliseconds of DOM reading; `pollInObsidian` re-runs it until the Node-side `until` accepts, which is
 * what makes the 60s budget real rather than a ceiling the cap could never honour.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const MODAL_SELECTOR = '.alias-quick-switcher-modal';
const SUGGESTION_SELECTOR = '.suggestion-item';

const TEST_TIMEOUT_IN_MILLISECONDS = 600_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

const STAMP_RANGE = 1000;

describe('Matching an alias in every path segment', () => {
  it('finds the note for every mixture of real names and aliases, including the ones the built-in cannot', async () => {
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
        // The folder note of the inner folder, under the default `Folder/Folder.md` convention, aliased so
        // the folder answers to a second name.
        await app.vault.create(`${alphaName}/${bravoName}/${bravoName}.md`, `---\naliases:\n  - ${deltaAlias}\n---\n`);
        await app.vault.create(`${alphaName}/${bravoName}/${charlieName}.md`, `---\naliases:\n  - ${echoAlias}\n---\n`);
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'both aliases never reached the metadata cache',
      until: (areCached: boolean): boolean => areCached
    });

    const queries = [
      `${alpha}/${bravo}/${charlie}`,
      `${alpha} ${bravo} ${charlie}`,
      `${bravo} ${charlie}`,
      echo,
      `${alpha}/${bravo}/${echo}`,
      `${alpha}/${delta}/${charlie}`,
      `${alpha}/${delta}/${echo}`,
      `${delta}/${echo}`
    ];

    const offeredCounts: number[] = [];

    for (const query of queries) {
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
        timeoutMessage: `the note was never offered for ${query}`,
        until: (isOffered: boolean): boolean => isOffered
      });

      offeredCounts.push(
        await evalInObsidian({
          callback({ suggestionSelector, targetName }): number {
            const count = [...document.querySelectorAll(suggestionSelector)].filter((el) => el.textContent.includes(targetName)).length;

            return count;
          },
          input: { suggestionSelector: SUGGESTION_SELECTOR, targetName: charlie }
        })
      );

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
    }

    // Every one of the eight forms finds the note exactly once — the four the built-in already handles,
    // and the four it returns an empty list for.
    expect(offeredCounts).toStrictEqual(queries.map(() => 1));
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
