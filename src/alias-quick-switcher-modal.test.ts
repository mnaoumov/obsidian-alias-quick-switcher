import type {
  App as AppOriginal,
  WorkspaceLeaf
} from 'obsidian';
import type { App } from 'obsidian-test-mocks/obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { resolveFolderNoteConfig } from 'obsidian-dev-utils/obsidian/folder-note';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

// Stubbed to skip the plugin-context initialization, but it still ADDS the classes: the row styling is
// Addressed by them, so a no-op mock would make every assertion about the rendered row vacuous.
vi.mock('obsidian-dev-utils/obsidian/plugin/plugin-context', () => ({
  addPluginCssClasses: (el: HTMLElement, cssClasses?: string | string[]): void => {
    el.addClass(...(typeof cssClasses === 'string' ? [cssClasses] : cssClasses ?? []));
  }
}));

// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import type {
  Suggestion,
  SwitcherSettings
} from './alias-quick-switcher-modal.ts';

// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import { AliasQuickSwitcherModal } from './alias-quick-switcher-modal.ts';
// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import { LabelIndex } from './label-index.ts';
// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import { PluginSettings } from './plugin-settings.ts';
// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import { RankingMode } from './ranking.ts';
// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import { SegmentMatchMode } from './segment-matcher.ts';

/**
 * The fixture from the CDP measurement, plus a non-markdown file and a second folder with no folder note.
 */
const VAULT_FILES: Record<string, string> = {
  'Alpha/Bravo/Bravo.md': '---\naliases:\n  - Delta\n---\n',
  'Alpha/Bravo/Charlie.md': '---\naliases:\n  - Echo\n---\n',
  'Alpha/Bravo/Sketch.canvas': '{}',
  'Alpha/Hotel/India.md': 'plain',
  'Archive/Old Note.md': 'archived',
  'Diagram.canvas': '{}'
};

interface RecentFileTrackerLike {
  lastOpenFiles: string[];
}

interface RecentFileTrackerMock {
  workspace: WorkspaceWithRecentFiles;
}

interface WorkspaceWithRecentFiles {
  recentFileTracker: RecentFileTrackerLike;
}

let app: AppOriginal;
let appMock: App;
let openFileMock: ReturnType<typeof vi.fn>;
let settings: PluginSettings;

beforeEach(async () => {
  vi.restoreAllMocks();
  const { App: AppMock } = await import('obsidian-test-mocks/obsidian');
  appMock = AppMock.createConfigured__({ files: VAULT_FILES });
  app = appMock.asOriginalType__();
  castTo<RecentFileTrackerMock>(app).workspace.recentFileTracker = { lastOpenFiles: [] };
  openFileMock = vi.fn().mockResolvedValue(undefined);
  app.workspace.getLeaf = vi.fn().mockReturnValue(castTo<WorkspaceLeaf>({ openFile: openFileMock }));
  settings = new PluginSettings();
});

describe('the nine query forms measured against the built-in switcher', () => {
  /*
   * The first four are what Obsidian's own switcher already finds, and they must keep working. The last
   * three are what it returns nothing for — the entire reason this plugin exists.
   */
  it.each([
    'Alpha/Bravo/Charlie',
    'Alpha Bravo Charlie',
    'Bravo Charlie',
    'Echo',
    'Alpha/Bravo/Echo',
    'Alpha/Delta/Charlie',
    'Alpha/Delta/Echo',
    'Delta/Echo'
  ])('should find Charlie for %s', (query) => {
    expect(openTargetsFor(query)).toContain('Alpha/Bravo/Charlie.md');
  });

  it('should find the folder note for a bare folder alias', () => {
    expect(openTargetsFor('Delta')).toContain('Alpha/Bravo/Bravo.md');
  });

  it('should find nothing for a query that names nothing in the vault', () => {
    expect(openTargetsFor('Zulu')).toStrictEqual([]);
  });
});

describe('folders as results', () => {
  it('should offer a folder that has a folder note, and open that note', () => {
    const suggestion = suggestionsFor('Delta')[0];
    expect(suggestion?.path).toBe('Alpha/Bravo');
    expect(suggestion?.candidate.isFolder).toBe(true);
    expect(suggestion?.candidate.openTarget.path).toBe('Alpha/Bravo/Bravo.md');
  });

  it('should never offer a folder that has no folder note', () => {
    expect(suggestionsFor('Hotel').map((suggestion) => suggestion.path)).not.toContain('Alpha/Hotel');
  });

  it('should offer no folders at all once they are turned off', () => {
    settings.shouldIncludeFolders = false;
    expect(suggestionsFor('Delta').every((suggestion) => !suggestion.candidate.isFolder)).toBe(true);
  });

  it('should still reach the folder note by its own path when folders are on', () => {
    expect(openTargetsFor('Alpha/Bravo/Bravo')).toContain('Alpha/Bravo/Bravo.md');
  });

  it('should offer the folder note once, not twice, when both ways of reaching it match', () => {
    expect(openTargetsFor('Delta').filter((path) => path === 'Alpha/Bravo/Bravo.md')).toHaveLength(1);
  });
});

describe('which files are offered', () => {
  it('should leave out files that are not markdown by default', () => {
    expect(openTargetsFor('Diagram')).toStrictEqual([]);
  });

  it('should offer them once they are turned on', () => {
    settings.shouldIncludeNonMarkdownFiles = true;
    expect(openTargetsFor('Diagram')).toStrictEqual(['Diagram.canvas']);
  });

  it('should leave out a path the user excluded', () => {
    settings.excludedPathPatterns = ['Archive'];
    expect(openTargetsFor('Old Note')).toStrictEqual([]);
  });

  it('should leave out a path matched by an excluding regular expression', () => {
    settings.excludedPathPatterns = [String.raw`/^Alpha\/Hotel\//`];
    expect(openTargetsFor('India')).toStrictEqual([]);
  });
});

describe('the empty query', () => {
  it('should list recently-opened files', () => {
    castTo<RecentFileTrackerMock>(app).workspace.recentFileTracker.lastOpenFiles = ['Alpha/Bravo/Charlie.md', 'Archive/Old Note.md'];
    expect(openTargetsFor('')).toStrictEqual(['Alpha/Bravo/Charlie.md', 'Archive/Old Note.md']);
  });

  it('should skip a recent path that is no longer offered at all', () => {
    settings.excludedPathPatterns = ['Archive'];
    castTo<RecentFileTrackerMock>(app).workspace.recentFileTracker.lastOpenFiles = ['Archive/Old Note.md', 'Alpha/Bravo/Charlie.md'];
    expect(openTargetsFor('')).toStrictEqual(['Alpha/Bravo/Charlie.md']);
  });

  it('should list nothing when nothing has been opened', () => {
    expect(openTargetsFor('')).toStrictEqual([]);
  });

  it('should offer a path that appears twice in the recent list only once', () => {
    castTo<RecentFileTrackerMock>(app).workspace.recentFileTracker.lastOpenFiles = [
      'Alpha/Bravo/Charlie.md',
      'Archive/Old Note.md',
      'Alpha/Bravo/Charlie.md'
    ];
    expect(openTargetsFor('')).toStrictEqual(['Alpha/Bravo/Charlie.md', 'Archive/Old Note.md']);
  });
});

describe('renderSuggestion', () => {
  it('should render the path AS MATCHED, with the real path beneath it', () => {
    const el = renderFirst('Alpha/Delta/Echo');
    expect(el.querySelector('.suggestion-title')?.textContent).toBe('Alpha/Delta/Echo');
    expect(el.querySelector('.suggestion-note')?.textContent).toBe('Alpha/Bravo/Charlie');
  });

  /*
   * The second line drops the markdown extension because the built-in drops it — its own alias row reads
   * `Alpha/Bravo/Charlie`, measured off a real Obsidian. It also makes the line the row DRAWS and the line
   * the row DECIDES BY (`plainPath`) the same string, which they were not before.
   */
  it('should keep the extension of a file that is not a note', () => {
    settings.shouldIncludeNonMarkdownFiles = true;
    const el = renderFirst('Delta/Sketch');
    expect(el.querySelector('.suggestion-note')?.textContent).toBe('Alpha/Bravo/Sketch.canvas');
  });

  /*
   * The marker the built-in already puts on an alias hit — `lucide-forward`, labelled `Alias` — so the
   * two switchers signal the same thing the same way.
   */
  it('should flair a row an alias reached', () => {
    const el = renderFirst('Alpha/Delta/Echo');
    expect(el.querySelector(':scope .suggestion-aux .suggestion-flair')?.getAttribute('aria-label')).toBe('Alias');
  });

  it('should not flair a row matched by real names alone', () => {
    const el = renderFirst('Alpha/Bravo/Charlie');
    expect(el.querySelector('.suggestion-flair')).toBeNull();
  });

  it('should highlight only the characters the query covered', () => {
    const el = renderFirst('Alpha/Delta/Ech');
    expect([...el.querySelectorAll('.suggestion-highlight')].map((highlight) => highlight.textContent))
      .toStrictEqual(['Alpha', 'Delta', 'Ech']);
  });

  /*
   * A leaf-only alias hit is the one match the BUILT-IN also makes, and it renders the alias alone —
   * `Echo` over `Alpha/Bravo/Charlie`, measured off a real Obsidian. Rendering the whole path here would
   * put `Alpha/Bravo/Echo` over `Alpha/Bravo/Charlie`: two strings one word apart, which is where the
   * second line earns its space least. The as-matched path is kept for an ANCESTOR alias, above.
   */
  it('should render a leaf-only alias hit as the alias alone', () => {
    const el = renderFirst('Echo');
    expect(el.querySelector('.suggestion-title')?.textContent).toBe('Echo');
    expect(el.querySelector('.suggestion-note')?.textContent).toBe('Alpha/Bravo/Charlie');
  });

  /*
   * An ancestor reached by its REAL name is still rendered, because the user typed it and the row has to
   * show that it matched. Only a hit that reached nothing but the leaf collapses.
   */
  it('should keep an ancestor the query reached by its real name', () => {
    const el = renderFirst('Bravo/Echo');
    expect(el.querySelector('.suggestion-title')?.textContent).toBe('Alpha/Bravo/Echo');
  });

  /*
   * The rendering never carries the extension the path does, so comparing the two would put a redundant
   * second line under EVERY row — including the ones where nothing about the match differs from the path.
   */
  it('should omit the second line when nothing was matched by an alias', () => {
    const el = renderFirst('Alpha/Bravo/Charlie');
    expect(el.querySelector('.suggestion-title')?.textContent).toBe('Alpha/Bravo/Charlie');
    expect(el.querySelector('.suggestion-note')).toBeNull();
  });

  it('should mark a folder row as one', () => {
    const el = renderFirst('Delta');
    expect(el.hasClass('alias-quick-switcher-modal__folder')).toBe(true);
    expect(el.querySelector('.alias-quick-switcher-modal__icon')).not.toBeNull();
  });

  it('should render a recent row without any match rendering', () => {
    castTo<RecentFileTrackerMock>(app).workspace.recentFileTracker.lastOpenFiles = ['Alpha/Bravo/Charlie.md'];
    const el = renderFirst('');
    expect(el.querySelector('.suggestion-title')?.textContent).toBe('Alpha/Bravo/Charlie');
    expect(el.querySelector('.suggestion-flair')).toBeNull();
  });
});

describe('choosing a suggestion', () => {
  it('should open the file the row points at', () => {
    const modal = createModal();
    const suggestion = modal.getSuggestions('Alpha/Delta/Echo')[0];
    modal.onChooseSuggestion(castTo<Suggestion>(suggestion), new MouseEvent('click'));
    expect(openFileMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'Alpha/Bravo/Charlie.md' }));
  });

  it('should open in the current pane by default', () => {
    const modal = createModal();
    const suggestion = modal.getSuggestions('Echo')[0];
    modal.onChooseSuggestion(castTo<Suggestion>(suggestion), new MouseEvent('click'));
    expect(app.workspace.getLeaf).toHaveBeenCalledWith(false);
  });

  it('should open in a new pane when the pick is modified', () => {
    const modal = createModal();
    const suggestion = modal.getSuggestions('Echo')[0];
    modal.onChooseSuggestion(castTo<Suggestion>(suggestion), new MouseEvent('click', { ctrlKey: true }));
    expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
  });
});

describe('the algorithm settings', () => {
  it('should reject a non-contiguous segment under substring matching', () => {
    expect(openTargetsFor('Chrl')).toStrictEqual([]);
  });

  it('should accept it under fuzzy matching', () => {
    settings.segmentMatchMode = SegmentMatchMode.Fuzzy;
    expect(openTargetsFor('Chrl')).toContain('Alpha/Bravo/Charlie.md');
  });

  it('should keep the real-name match first under tiered ranking', () => {
    expect(openTargetsFor('Bravo')[0]).toBe('Alpha/Bravo/Bravo.md');
  });

  it('should order by match strength alone under link picker ranking', () => {
    settings.rankingMode = RankingMode.LinkPicker;
    expect(openTargetsFor('Bravo')).toContain('Alpha/Bravo/Bravo.md');
  });
});

function createModal(): AliasQuickSwitcherModal {
  const modal = new AliasQuickSwitcherModal({
    app,
    labelIndex: new LabelIndex({
      app,
      extraLabelPropertyName: settings.extraLabelPropertyName,
      folderNoteConfig: resolveFolderNoteConfig({ app })
    }),
    settings: castTo<SwitcherSettings>(settings)
  });
  modal.onOpen();
  return modal;
}

function openTargetsFor(query: string): string[] {
  return suggestionsFor(query).map((suggestion) => suggestion.candidate.openTarget.path);
}

function renderFirst(query: string): HTMLElement {
  const modal = createModal();
  const suggestion = modal.getSuggestions(query)[0];
  const el = createDiv();
  modal.renderSuggestion(castTo<Suggestion>(suggestion), el);
  return el;
}

function suggestionsFor(query: string): Suggestion[] {
  return createModal().getSuggestions(query);
}
