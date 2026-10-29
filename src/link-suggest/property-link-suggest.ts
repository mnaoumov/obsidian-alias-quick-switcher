import type {
  App,
  Editor,
  EditorPosition,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile
} from 'obsidian';

import { MARKDOWN_FILE_EXTENSION } from '@mnaoumov/obsidian-lib/file-system';
import {
  EditorSuggest,
  setIcon
} from 'obsidian';

import type { LabelIndex } from '../label-index/label-index.ts';
import type {
  PropertyFilterContext,
  PropertyValueCount
} from '../property-query/property-filter.ts';

import { createPropertyFilterContext } from '../property-query/property-filter-context.ts';
import {
  checkPropertyQuery,
  collectPropertyValues
} from '../property-query/property-filter.ts';
import {
  parsePropertyQuery,
  quoteValue
} from '../property-query/property-query-parser.ts';

/**
 * A note the property terms find, which a pick links to.
 */
export interface PropertyLinkNoteRow {
  readonly file: TFile;
}

/**
 * A row of the `[[` suggester: a note to link, or a value that completes the term being typed.
 */
export type PropertyLinkRow = PropertyLinkNoteRow | PropertyLinkValueRow;

/**
 * A value of the property being typed, which a pick writes into the term.
 */
export interface PropertyLinkValueRow {
  /**
   * The text the query becomes.
   */
  readonly completion: string;

  readonly count: number;
  readonly keySource: string;
  readonly value: string;
}

interface PropertyLinkSuggestConstructorParams {
  readonly app: App;
  readonly labelIndex: LabelIndex;

  /**
   * Called when a property term starts a suggester session, before any row is computed.
   */
  readonly onSessionStart: () => void;
}

const NOTE_LIMIT = 50;
const VALUE_COMPLETION_LIMIT = 8;
const LINK_OPENING = '[[';

/**
 * The text between a `[[` and the cursor, when it opens with a property term: `[[[isoCode:uk`. The link is not
 * closed yet, so no `]]` lies between the two.
 */
const TRIGGER_REGEX = /\[\[(?<query>\[(?:(?!\]\]).)*)$/;

/**
 * Finds a note by property from the `[[` link suggester: `[[[isoCode:uk]` offers the notes whose `isoCode`
 * holds `uk`, and a pick inserts an ORDINARY link to the chosen note, never the term — plain Obsidian could
 * not resolve `[[isoCode:uk]]`, so a vault that stops running this plugin must not be left holding one.
 *
 * Built-in `[[` suggestions are untouched: this suggester only answers when the link text opens with `[`,
 * which no note name the built-in completes does, and declines everything else.
 */
export class PropertyLinkSuggest extends EditorSuggest<PropertyLinkRow> {
  private readonly onSessionStart: () => void;
  private readonly propertyFilterContext: PropertyFilterContext;
  private readonly propertyValuesByKey = new Map<string, readonly PropertyValueCount[]>();

  public constructor(params: PropertyLinkSuggestConstructorParams) {
    super(params.app);
    this.onSessionStart = params.onSessionStart;
    this.propertyFilterContext = createPropertyFilterContext(params.app, params.labelIndex);
    this.limit = NOTE_LIMIT;
  }

  public override close(): void {
    // The values are collected once per key per suggester session, so the next `[[` reads the vault afresh.
    this.propertyValuesByKey.clear();
    super.close();
  }

  public getSuggestions(context: EditorSuggestContext): PropertyLinkRow[] {
    const propertyQuery = parsePropertyQuery(context.query);
    const markdownFiles = this.app.vault.getFiles().filter((file) => file.extension === MARKDOWN_FILE_EXTENSION);
    const rows: PropertyLinkRow[] = [];
    const { openValueTerm } = propertyQuery;
    const keyPattern = propertyQuery.groups.at(-1)?.at(-1)?.key;

    if (openValueTerm && keyPattern) {
      let values = this.propertyValuesByKey.get(openValueTerm.keySource);

      if (!values) {
        values = collectPropertyValues({ context: this.propertyFilterContext, files: markdownFiles, keyPattern });
        this.propertyValuesByKey.set(openValueTerm.keySource, values);
      }

      const partialValue = openValueTerm.partialValue.toLowerCase();
      const prefix = context.query.slice(0, openValueTerm.startIndex);

      for (const { count, value } of values.filter((valueCount) => valueCount.value.toLowerCase().includes(partialValue)).slice(0, VALUE_COMPLETION_LIMIT)) {
        rows.push({ completion: `${prefix}[${openValueTerm.keySource}:${quoteValue(value)}]`, count, keySource: openValueTerm.keySource, value });
      }
    }

    const pathWords = propertyQuery.pathQuery.toLowerCase().split(/\s+/).filter(Boolean);

    for (const file of markdownFiles) {
      const lowerPath = file.path.toLowerCase();

      if (pathWords.every((word) => lowerPath.includes(word)) && checkPropertyQuery({ context: this.propertyFilterContext, file, query: propertyQuery })) {
        rows.push({ file });
      }
    }

    return rows.sort(compareRows);
  }

  public onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const match = TRIGGER_REGEX.exec(editor.getLine(cursor.line).slice(0, cursor.ch));
    const query = match?.groups?.['query'];

    if (query === undefined || parsePropertyQuery(query).groups.length === 0) {
      return null;
    }

    if (!this.context) {
      this.onSessionStart();
    }

    return {
      end: cursor,
      query,
      start: { ch: cursor.ch - query.length, line: cursor.line }
    };
  }

  public renderSuggestion(row: PropertyLinkRow, el: HTMLElement): void {
    el.addClass('mod-complex');
    const contentEl = el.createDiv({ cls: 'suggestion-content' });

    if ('file' in row) {
      contentEl.createDiv({ cls: 'suggestion-title', text: row.file.basename });
      contentEl.createDiv({ cls: 'suggestion-note', text: row.file.path });
      return;
    }

    contentEl.createDiv({ cls: 'suggestion-title', text: `[${row.keySource}:${row.value}]` });
    contentEl.createDiv({ cls: 'suggestion-note', text: row.count === 1 ? '1 note' : `${String(row.count)} notes` });
    setIcon(el.createDiv({ cls: 'suggestion-aux' }).createSpan({ attr: { 'aria-label': row.keySource }, cls: 'suggestion-flair' }), 'lucide-text');
  }

  public selectSuggestion(row: PropertyLinkRow): void {
    const { context } = this;

    if (!context) {
      return;
    }

    // The closing brackets the editor paired automatically sit right after the cursor: one `]` for every `[` the
    // query left open, then the link's own `]]`. Whatever a pick closes is swallowed with it; anything past those
    // brackets is kept.
    const openBracketCount = Math.max(0, context.query.split('[').length - context.query.split(']').length);
    const after = context.editor.getLine(context.end.line).slice(context.end.ch);
    const closingRunLength = after.length - after.replace(/^\]+/, '').length;

    if (!('file' in row)) {
      const end = { ch: context.end.ch + Math.min(closingRunLength, openBracketCount), line: context.end.line };
      context.editor.replaceRange(row.completion, context.start, end);
      context.editor.setCursor({ ch: context.start.ch + row.completion.length, line: context.start.line });
      return;
    }

    const swallowedLength = Math.min(closingRunLength, LINK_OPENING.length + openBracketCount);
    const link = this.app.fileManager.generateMarkdownLink(row.file, context.file.path);
    const start = { ch: context.start.ch - LINK_OPENING.length, line: context.start.line };
    context.editor.replaceRange(link, start, { ch: context.end.ch + swallowedLength, line: context.end.line });
    context.editor.setCursor({ ch: start.ch + link.length, line: start.line });
    this.close();
  }
}

/**
 * Value completions first, then notes by path.
 *
 * @param left - One row.
 * @param right - The other.
 * @returns The order.
 */
function compareRows(left: PropertyLinkRow, right: PropertyLinkRow): number {
  if ('file' in left && 'file' in right) {
    return left.file.path.localeCompare(right.file.path);
  }

  // Completions were pushed most common first, and a stable sort keeps them so.
  return Number('file' in left) - Number('file' in right);
}
