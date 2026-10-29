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
 * Property terms end to end, against a real Obsidian: the switcher answers a query the way core Search answers the
 * same query over the same notes, and the `[[` suggester turns a term into an ordinary link.
 *
 * The parity half asks core Search ITSELF on every run rather than comparing against a table written down once,
 * so an Obsidian release that changes how Search reads a property term fails here instead of drifting silently.
 *
 * DESKTOP rather than cross-platform: the parsing is this plugin's own code and identical on both, while each
 * query costs a Search round trip that the Android leg's per-eval budget (see `AGENTS.md`) cannot spare.
 */

const PLUGIN_ID = 'alias-quick-switcher';
const MODAL_SELECTOR = '.alias-quick-switcher-modal';
const VALUE_COMPLETION_CLASS = 'alias-quick-switcher-modal__value-completion';

const TEST_TIMEOUT_IN_MILLISECONDS = 600_000;
const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;
const STAMP_RANGE = 1000;

/**
 * How long core Search is given to settle on a query. It debounces typing and then walks the vault, and the result
 * list is read only once it has stopped changing for this long.
 */
const SEARCH_SETTLE_IN_MILLISECONDS = 1500;

/**
 * One note per shape the measurement covered.
 */
const FIXTURE_FILES: Record<string, string> = {
  'A.md': '---\nisoCode: uk\n---\n',
  'B.md': '---\nisoCode: UKR\n---\n',
  'C.md': '---\nbirth place: Kyiv\n---\n',
  'D.md': '---\ncity: San Miguel de Allende\n---\n',
  'E.md': '---\nlangs:\n  - en\n  - uk\n---\n',
  'F.md': '---\nlocation: "[[Kyiv City]]"\n---\n',
  'G.md': '---\naddress:\n  city: Lviv\n---\n',
  'H.md': '---\nempty:\n---\n',
  'I.md': '---\nquote: say "hi" now\n---\n',
  'J.md': '---\nstatus: Draft\n---\n',
  'K.md': '---\nstatus: Published\n---\n',
  'Kyiv City.md': '---\naliases:\n  - Київ\n---\n',
  'L.md': '---\nkey]x: val\n---\n',
  'M.md': '---\nnum: 42\nflag: true\n---\n',
  'N.md': '---\nisoCode: u k\n---\n'
};

const PARITY_QUERIES = [
  '[isoCode:uk]',
  '[isoCode:"uk"]',
  '[isocode:UK]',
  '[isoCode]',
  '[iso:uk]',
  '["iso":uk]',
  '[isoCode:"u k"]',
  '["birth place":Kyiv]',
  '[birth place:Kyiv]',
  '[city:"San Miguel de Allende"]',
  '[city:Allende San]',
  '[city:"Migu"]',
  '[langs:uk]',
  '[langs:"e"]',
  '[location:Kyiv]',
  '[address:Lviv]',
  '[empty:null]',
  String.raw`[quote:"say \"hi\" now"]`,
  '[status:Draft OR Published]',
  '[status:Draft] OR [isoCode:uk]',
  '[isoCode:uk] [status:Draft]',
  '["key]x":val]',
  '[num:4]',
  '[flag:true]',
  '[isoCode:/^uk$/]',
  '[/iso/:uk]'
];

interface SearchParams {
  readonly folder: string;
  readonly query: string;
}

describe('Property terms', () => {
  it('should find what core Search finds for the same query', async () => {
    const folder = await createFixture();

    for (const query of PARITY_QUERIES) {
      const coreResults = await searchWithCore({ folder, query });
      const switcherResults = await searchWithSwitcher({ folder, query });
      expect({ query, switcherResults }).toStrictEqual({ query, switcherResults: coreResults });
    }
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  /*
   * The one deliberate difference: core Search matches a link value by its raw text alone, and finds nothing here.
   */
  it('should match a link value by the alias of the note it points to, where core Search does not', async () => {
    const folder = await createFixture();
    expect(await searchWithCore({ folder, query: '[location:Київ]' })).toStrictEqual([]);
    expect(await searchWithSwitcher({ folder, query: '[location:Київ]' })).toStrictEqual(['F.md']);
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('should turn a property term typed after [[ into an ordinary link', async () => {
    const stamp = createStamp();
    const ukrainian = `Ukrainian-${stamp}`;
    const sourcePath = `Source-${stamp}.md`;

    await pollInObsidian({
      input: { sourcePath, stamp, ukrainian },
      poll({ app, sourcePath: source, ukrainian: ukrainianName }): boolean {
        const target = app.vault.getFileByPath(`${ukrainianName}.md`);
        return target !== null && Boolean(app.metadataCache.getFileCache(target)?.frontmatter)
          && app.workspace.activeEditor?.file?.path === source;
      },
      async start({ app, sourcePath: source, stamp: currentStamp, ukrainian: ukrainianName }): Promise<void> {
        // The value is unique to this run, so the term finds this note and no other a previous run left behind.
        await app.vault.create(`${ukrainianName}.md`, `---\nlangCode: uk${currentStamp}\n---\n`);
        const sourceFile = await app.vault.create(source, '');
        // Activated and focused explicitly: an earlier suite in the same Obsidian may have left another leaf active.
        const leaf = app.workspace.getLeaf(true);
        await leaf.openFile(sourceFile, { active: true });
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the linked note never reached the metadata cache, or the source note never opened',
      until: (isCached: boolean): boolean => isCached
    });

    await evalInObsidian({
      async callback({ app, lib: { typeIntoEditor }, stamp: currentStamp }): Promise<void> {
        const editor = app.workspace.activeEditor?.editor;
        if (!editor) {
          throw new Error('No editor is active.');
        }

        await typeIntoEditor({ editor, text: `See [[[langCode:uk${currentStamp}` });
      },
      input: { stamp }
    });

    // The first pick completes the VALUE, which keeps the suggester open on the notes the completed term finds;
    // the second picks the note.
    for (const expectedRow of [`[langCode:uk${stamp}]`, ukrainian]) {
      await pickEditorSuggestion(expectedRow);
    }

    const line = await pollInObsidian({
      poll({ app }): string {
        return app.workspace.activeEditor?.editor?.getLine(0) ?? '';
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the link was never inserted',
      until: (currentLine: string): boolean => currentLine.includes(ukrainian)
    });

    // An ORDINARY link, with every bracket the editor paired along the way swallowed: plain Obsidian resolves it.
    expect(line).toBe(`See [[${ukrainian}]]`);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

async function createFixture(): Promise<string> {
  const folder = `PropertyTerms-${createStamp()}`;

  await pollInObsidian({
    input: { files: FIXTURE_FILES, folder },
    poll({ app, files, folder: fixtureFolder }): boolean {
      return Object.keys(files).every((name) => {
        const file = app.vault.getFileByPath(`${fixtureFolder}/${name}`);
        return file !== null && app.metadataCache.getFileCache(file) !== null;
      });
    },
    async start({ app, files, folder: fixtureFolder }): Promise<void> {
      await app.vault.createFolder(fixtureFolder);
      for (const [name, content] of Object.entries(files)) {
        await app.vault.create(`${fixtureFolder}/${name}`, content);
      }
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the fixture never reached the metadata cache',
    until: (isCached: boolean): boolean => isCached
  });

  return folder;
}

function createStamp(): string {
  return `${Date.now().toString()}-${Math.floor(Math.random() * STAMP_RANGE).toString()}`;
}

async function pickEditorSuggestion(expectedRow: string): Promise<void> {
  await pollInObsidian({
    input: { expectedRow },
    poll({ expectedRow: rowText }): boolean {
      const selected = document.querySelector('.suggestion-container .suggestion-item.is-selected .suggestion-title');
      return selected?.textContent === rowText;
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: `the [[ suggester never offered ${expectedRow} first`,
    until: (isOffered: boolean): boolean => isOffered
  });

  await evalInObsidian({
    async callback({ lib: { pressKey } }): Promise<void> {
      await pressKey({ key: 'Enter' });
    }
  });
}

async function searchWithCore(params: SearchParams): Promise<string[]> {
  return await evalInObsidian({
    async callback({ app, folder, query, settleInMilliseconds }): Promise<string[]> {
      // Core Search has no public API, so its own plugin instance is asked, the way its "Search" command does.
      const globalSearch = app.internalPlugins.getPluginById('global-search');
      if (!globalSearch) {
        throw new Error('Core Search is not enabled.');
      }

      globalSearch.instance.openGlobalSearch(`path:"${folder}/" ${query}`);

      let previous = '';
      let stableSince = Date.now();
      for (;;) {
        await sleep(100);
        const view = app.workspace.getLeavesOfType('search')[0]?.view;
        // A view still deferred has no result list yet, which reads as no results until it loads.
        const resultFiles = view && 'dom' in view ? [...view.dom.resultDomLookup.keys()] : [];
        const paths = resultFiles.map((file) => file.path.slice(folder.length + 1)).sort();
        const current = JSON.stringify(paths);
        if (current !== previous) {
          previous = current;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= settleInMilliseconds) {
          return paths;
        }
      }
    },
    input: { ...params, settleInMilliseconds: SEARCH_SETTLE_IN_MILLISECONDS }
  });
}

async function searchWithSwitcher(params: SearchParams): Promise<string[]> {
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

  // The fixture folder is the path text beside the terms, so the switcher looks at the same notes core Search's
  // `path:` restricts it to.
  const paths = await evalInObsidian({
    async callback({ folder, modalSelector, query, valueCompletionClass }): Promise<string[]> {
      const input = document.querySelector(`${modalSelector} .prompt-input`);
      if (!(input instanceof HTMLInputElement)) {
        throw new TypeError('The switcher has no input.');
      }

      // A NOTIFICATION event, not a pretend keystroke — `AGENTS.md` says why the suites type this way.
      input.value = `${query} ${folder}/`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(300);

      return [...document.querySelectorAll(`${modalSelector} .suggestion-item`)]
        .filter((row) => !row.classList.contains(valueCompletionClass))
        .map((row) => {
          const path = row.querySelector('.suggestion-note')?.textContent ?? row.querySelector('.suggestion-title')?.textContent ?? '';
          return `${path.slice(folder.length + 1)}.md`;
        })
        .sort();
    },
    input: { ...params, modalSelector: MODAL_SELECTOR, valueCompletionClass: VALUE_COMPLETION_CLASS }
  });

  await pollInObsidian({
    input: { modalSelector: MODAL_SELECTOR },
    poll({ modalSelector }): boolean {
      return document.querySelector(modalSelector) === null;
    },
    async start({ lib: { pressKey } }): Promise<void> {
      await pressKey({ key: 'Escape' });
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the switcher never closed',
    until: (isClosed: boolean): boolean => isClosed
  });

  return paths;
}
