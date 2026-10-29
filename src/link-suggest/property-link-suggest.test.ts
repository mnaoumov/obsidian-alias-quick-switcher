import type {
  App as AppOriginal,
  Editor,
  EditorPosition,
  EditorSuggestContext,
  TFile
} from 'obsidian';
import type { Mock } from 'vitest';

import { resolveFolderNoteConfig } from '@mnaoumov/obsidian-lib/folder-note';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  PropertyLinkRow,
  PropertyLinkValueRow
} from './property-link-suggest.ts';

import { LabelIndex } from '../label-index/label-index.ts';
import { PropertyLinkSuggest } from './property-link-suggest.ts';

const VAULT_FILES: Record<string, string> = {
  'Daily.md': 'text',
  'Places/Kyiv City.md': '---\naliases:\n  - Київ\n---\n',
  'Reference/Airport/Boryspil.md': '---\niataCode: KBP\nlocation: "[[Kyiv City]]"\n---\n',
  'Reference/Language/English.md': '---\nisoCode: en\n---\n',
  'Reference/Language/Ukrainian.md': '---\nisoCode: uk\n---\n',
  'Reference/Language/Ukrainian Sign.md': '---\nisoCode: ukl\n---\n',
  'Sketch.canvas': '{}'
};

interface SelectResult {
  readonly editor: LineEditor;
  readonly suggest: PropertyLinkSuggest;
}

/**
 * A one-line editor over a string, which is all the suggester reads and writes.
 */
class LineEditor {
  public cursor: EditorPosition = { ch: 0, line: 0 };

  public constructor(public text: string) {}

  public getLine(): string {
    return this.text;
  }

  public replaceRange(replacement: string, from: EditorPosition, to: EditorPosition): void {
    this.text = this.text.slice(0, from.ch) + replacement + this.text.slice(to.ch);
  }

  public setCursor(position: EditorPosition): void {
    this.cursor = position;
  }
}

let app: AppOriginal;
let onSessionStart: Mock<() => void>;

beforeEach(async () => {
  const { App: AppMock } = await import('obsidian-test-mocks/obsidian');
  app = AppMock.createConfigured__({ files: VAULT_FILES }).asOriginalType__();
  onSessionStart = vi.fn<() => void>();
});

describe('onTrigger', () => {
  it('should answer a link text that opens with a property term', () => {
    const info = trigger('See [[[isoCode:uk');
    expect(info).toStrictEqual({ end: { ch: 17, line: 0 }, query: '[isoCode:uk', start: { ch: 6, line: 0 } });
  });

  it('should leave an ordinary link text to the built-in suggester', () => {
    expect(trigger('See [[Ukrainian')).toBeNull();
  });

  it('should leave a closed link alone', () => {
    expect(trigger('See [[[isoCode:uk]]] and')).toBeNull();
  });

  it('should leave a bracket that is not a property term alone', () => {
    expect(trigger('See [[[')).not.toBeNull();
    expect(trigger('See [[x [a:b]')).toBeNull();
  });

  it('should re-read the label setup once per session, not once per keystroke', () => {
    const suggest = createSuggest();
    const editor = new LineEditor('[[[isoCode:u');
    suggest.onTrigger({ ch: editor.text.length, line: 0 }, castTo<Editor>(editor));
    suggest.context = castTo<EditorSuggestContext>({});
    suggest.onTrigger({ ch: editor.text.length, line: 0 }, castTo<Editor>(editor));
    expect(onSessionStart).toHaveBeenCalledOnce();
  });
});

describe('getSuggestions', () => {
  it('should offer the notes the term finds, by path', () => {
    expect(notePathsFor('[isoCode:uk]')).toStrictEqual(['Reference/Language/Ukrainian Sign.md', 'Reference/Language/Ukrainian.md']);
  });

  it('should narrow them by the text beside the term', () => {
    expect(notePathsFor('[isoCode:uk] sign')).toStrictEqual(['Reference/Language/Ukrainian Sign.md']);
  });

  it('should match a link value by the alias of the note it points to', () => {
    expect(notePathsFor('[location:Київ]')).toStrictEqual(['Reference/Airport/Boryspil.md']);
  });

  it('should offer values first while the value is typed', () => {
    const rows = createSuggest().getSuggestions(contextFor('[isoCode:u'));
    expect(rows.slice(0, 2)).toStrictEqual([
      { completion: '[isoCode:"uk"]', count: 1, keySource: 'isoCode', value: 'uk' },
      { completion: '[isoCode:"ukl"]', count: 1, keySource: 'isoCode', value: 'ukl' }
    ]);
    expect(rows.slice(2).map((row) => 'file' in row && row.file.path)).toStrictEqual([
      'Reference/Language/Ukrainian Sign.md',
      'Reference/Language/Ukrainian.md'
    ]);
  });

  it('should collect a key\'s values once per session, and afresh after closing', () => {
    const suggest = createSuggest();
    const getFileCacheSpy = vi.spyOn(app.metadataCache, 'getFileCache');
    suggest.getSuggestions(contextFor('[isoCode:u'));
    const callsForFirstKeystroke = getFileCacheSpy.mock.calls.length;
    suggest.getSuggestions(contextFor('[isoCode:uk'));
    const callsForSecondKeystroke = getFileCacheSpy.mock.calls.length - callsForFirstKeystroke;
    expect(callsForSecondKeystroke).toBeLessThan(callsForFirstKeystroke);

    suggest.close();
    getFileCacheSpy.mockClear();
    suggest.getSuggestions(contextFor('[isoCode:uk'));
    expect(getFileCacheSpy.mock.calls.length).toBe(callsForFirstKeystroke);
  });
});

describe('renderSuggestion', () => {
  it('should render a note by its name over its path', () => {
    const el = createDiv();
    createSuggest().renderSuggestion({ file: ukrainian() }, el);
    expect(el.querySelector('.suggestion-title')?.textContent).toBe('Ukrainian');
    expect(el.querySelector('.suggestion-note')?.textContent).toBe('Reference/Language/Ukrainian.md');
  });

  it.each([
    [1, '1 note'],
    [3, '3 notes']
  ])('should render a value with its note count (%i)', (count, expected) => {
    const el = createDiv();
    createSuggest().renderSuggestion(valueRow({ count }), el);
    expect(el.querySelector('.suggestion-title')?.textContent).toBe('[isoCode:uk]');
    expect(el.querySelector('.suggestion-note')?.textContent).toBe(expected);
    expect(el.querySelector('.suggestion-flair')?.getAttribute('aria-label')).toBe('isoCode');
  });
});

describe('selectSuggestion', () => {
  it('should insert an ordinary link to the note, swallowing the paired brackets', () => {
    expect(select('See [[[isoCode:"uk"]', ']] after', { file: ukrainian() })).toBe('See [[Ukrainian]] after');
  });

  it('should swallow only as many brackets as the query left open', () => {
    expect(select('[[[isoCode:uk', ']]]]', { file: ukrainian() })).toBe('[[Ukrainian]]]');
  });

  it('should swallow no bracket that is not there', () => {
    expect(select('[[[isoCode:uk', ' tail', { file: ukrainian() })).toBe('[[Ukrainian]] tail');
  });

  it('should write a value into the term and keep the suggester going', () => {
    const { editor, suggest } = selectWith('[[[isoCode:u', ']]]', valueRow({ completion: '[isoCode:"uk"]' }));
    expect(editor.text).toBe('[[[isoCode:"uk"]]]');
    expect(editor.cursor).toStrictEqual({ ch: 16, line: 0 });
    expect(suggest.context).not.toBeNull();
  });

  it('should do nothing with no session', () => {
    const suggest = createSuggest();
    expect(() => {
      suggest.selectSuggestion({ file: ukrainian() });
    }).not.toThrow();
  });
});

function contextFor(query: string): EditorSuggestContext {
  return castTo<EditorSuggestContext>({ query });
}

function createSuggest(): PropertyLinkSuggest {
  return new PropertyLinkSuggest({
    app,
    labelIndex: new LabelIndex({ app, folderNoteConfig: resolveFolderNoteConfig({ app }), titlePropertyNames: [] }),
    onSessionStart
  });
}

function notePathsFor(query: string): string[] {
  return createSuggest().getSuggestions(contextFor(query)).flatMap((row) => 'file' in row ? [row.file.path] : []);
}

function select(before: string, after: string, row: PropertyLinkRow): string {
  return selectWith(before, after, row).editor.text;
}

function selectWith(before: string, after: string, row: PropertyLinkRow): SelectResult {
  const suggest = createSuggest();
  const editor = new LineEditor(before + after);
  const info = ensureNonNullable(suggest.onTrigger({ ch: before.length, line: 0 }, castTo<Editor>(editor)));
  suggest.context = { ...info, editor: castTo<Editor>(editor), file: ensureNonNullable(app.vault.getFileByPath('Daily.md')) };
  suggest.selectSuggestion(row);
  return { editor, suggest };
}

function trigger(text: string): ReturnType<PropertyLinkSuggest['onTrigger']> {
  return createSuggest().onTrigger({ ch: text.length, line: 0 }, castTo<Editor>(new LineEditor(text)));
}

function ukrainian(): TFile {
  return ensureNonNullable(app.vault.getFileByPath('Reference/Language/Ukrainian.md'));
}

function valueRow(overrides: Partial<PropertyLinkValueRow>): PropertyLinkValueRow {
  return { completion: '[isoCode:"uk"]', count: 1, keySource: 'isoCode', value: 'uk', ...overrides };
}
