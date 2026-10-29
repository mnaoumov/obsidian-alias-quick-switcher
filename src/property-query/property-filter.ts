/**
 * @file
 *
 * Tests a note against the property terms {@link parsePropertyQuery} read, and collects the values a key
 * holds across the vault for completion.
 *
 * Matched the way core Search matches, measured against a real Obsidian 1.14, with ONE deliberate addition:
 *
 * - A list matches when ANY element does: `[langs:uk]` finds `langs: [en, uk]`.
 * - Numbers and booleans are matched as the text they are written as: `[num:4]` finds `num: 42`.
 * - Only TOP-LEVEL keys are searched. Core Search finds nothing inside a nested object — not
 *   `[address.city:Lviv]`, not `[address:Lviv]`, not `[city:Lviv]` — so neither does this.
 * - The addition: a value that is a LINK also matches by the names of the note it points to — its basename,
 *   aliases and title properties — so `[location:Київ]` finds `location: "[[Kyiv City]]"` when `Kyiv City`
 *   carries the alias `Київ`. Core Search matches the raw link text only, which is kept too.
 */

import type {
  FrontMatterCache,
  TFile
} from 'obsidian';

import type {
  PropertyQuery,
  PropertyTerm,
  TextPattern,
  ValueExpression
} from './property-query-parser.ts';

import {
  TextPatternKind,
  ValueConditionKind
} from './property-query-parser.ts';

/**
 * Parameters for {@link checkPropertyQuery}.
 */
export interface CheckPropertyQueryParams {
  readonly context: PropertyFilterContext;
  readonly file: TFile;
  readonly query: PropertyQuery;
}

/**
 * Parameters for {@link collectPropertyValues}.
 */
export interface CollectPropertyValuesParams {
  readonly context: PropertyFilterContext;
  readonly files: readonly TFile[];
  readonly keyPattern: TextPattern;
}

/**
 * What evaluating a term needs to know about the vault, kept this narrow so the evaluator can be tested with
 * no `App` at all.
 */
export interface PropertyFilterContext {
  /**
   * The note's frontmatter, or `undefined` when it has none.
   */
  readonly getFrontmatter: (file: TFile) => FrontMatterCache | undefined;

  /**
   * The names the note a frontmatter link points to answers to, for every link the note holds under `key`.
   */
  readonly getLinkTargetNames: (file: TFile, key: string) => readonly string[];
}

/**
 * One distinct value a key holds somewhere in the vault, and how many notes hold it.
 */
export interface PropertyValueCount {
  readonly count: number;
  readonly value: string;
}

interface CheckTermParams {
  readonly context: PropertyFilterContext;
  readonly file: TFile;
  readonly frontmatter: FrontMatterCache | undefined;
  readonly term: PropertyTerm;
}

/**
 * Whether a note satisfies every group of a query.
 *
 * @param params - What to test.
 * @param params.context - How frontmatter and link targets are read.
 * @param params.file - The note.
 * @param params.query - The parsed query.
 * @returns `true` when every group has a term the note satisfies.
 */
export function checkPropertyQuery(params: CheckPropertyQueryParams): boolean {
  const frontmatter = params.context.getFrontmatter(params.file);

  return params.query.groups.every((group) =>
    group.some((term) =>
      checkTerm({
        context: params.context,
        file: params.file,
        frontmatter,
        term
      })
    )
  );
}

/**
 * Collects the distinct values the keys matching `keyPattern` hold across `files`, most common first, for
 * value completion.
 *
 * @param params - What to collect.
 * @param params.context - How frontmatter is read.
 * @param params.files - The notes to read.
 * @param params.keyPattern - Which keys count.
 * @returns The values, most common first, then alphabetically.
 */
export function collectPropertyValues(params: CollectPropertyValuesParams): PropertyValueCount[] {
  // Keyed case-insensitively, keeping the first spelling met, so `uk` and `UK` are offered once.
  const counts = new Map<string, PropertyValueCount>();

  for (const file of params.files) {
    const frontmatter = params.context.getFrontmatter(file);
    const seenInFile = new Set<string>();

    for (const [key, rawValue] of Object.entries(frontmatter ?? {})) {
      if (!checkPattern(params.keyPattern, key, true)) {
        continue;
      }

      for (const text of flattenValue(rawValue)) {
        const normalized = text.toLowerCase();

        if (seenInFile.has(normalized)) {
          continue;
        }

        seenInFile.add(normalized);
        const existing = counts.get(normalized);
        counts.set(normalized, { count: (existing?.count ?? 0) + 1, value: existing?.value ?? text });
      }
    }
  }

  return [...counts.values()].sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

/**
 * A quoted value as a whole-word phrase: not preceded or followed by a letter, digit or underscore, which is
 * what makes `"uk"` miss `UKR` and `"4"` miss `42`, as in core Search.
 */
const phraseRegexes = new WeakMap<TextPattern, RegExp>();

function checkExpression(expression: ValueExpression, text: string): boolean {
  switch (expression.kind) {
    case 'and': {
      return expression.operands.every((operand) => checkExpression(operand, text));
    }
    case 'or': {
      return expression.operands.some((operand) => checkExpression(operand, text));
    }
    default: {
      return checkPattern(expression.pattern, text, false);
    }
  }
}

/**
 * Tests one piece of text against one pattern.
 *
 * @param pattern - The pattern.
 * @param text - The key or the value text.
 * @param isKey - A quoted KEY is the whole key, while a quoted VALUE is a whole-word phrase inside it.
 * @returns Whether it matches.
 */
function checkPattern(pattern: TextPattern, text: string, isKey: boolean): boolean {
  if (pattern.kind === TextPatternKind.Regex) {
    // `lastIndex` is never carried between tests, because the flags may include `g`.
    pattern.regex.lastIndex = 0;
    return pattern.regex.test(text);
  }

  const lowerText = text.toLowerCase();
  const lowerPattern = pattern.text.toLowerCase();

  if (pattern.kind === TextPatternKind.Word) {
    return lowerText.includes(lowerPattern);
  }

  if (isKey) {
    return lowerText === lowerPattern;
  }

  let phraseRegex = phraseRegexes.get(pattern);

  // Built once per parsed pattern rather than once per note: the query is re-parsed per keystroke, but tested
  // against every note in the vault in between.
  if (!phraseRegex) {
    phraseRegex = new RegExp(String.raw`(?<![\p{L}\p{N}_])${escapeRegex(lowerPattern)}(?![\p{L}\p{N}_])`, 'u');
    phraseRegexes.set(pattern, phraseRegex);
  }

  return phraseRegex.test(lowerText);
}

function checkTerm(params: CheckTermParams): boolean {
  const { term } = params;

  for (const [key, rawValue] of Object.entries(params.frontmatter ?? {})) {
    if (!checkPattern(term.key, key, true)) {
      continue;
    }

    const { value } = term;

    if (value.kind !== ValueConditionKind.Expression) {
      // `[key]` holds for any value; `[key:null]` only for an empty one, and another matching key may still hold it.
      if (value.kind === ValueConditionKind.Exists || rawValue === null) {
        return true;
      }

      continue;
    }

    const { expression } = value;

    // Each list element is tested on its own, so `[langs:en uk]` asks for ONE element holding both, the way a
    // two-word value asks one scalar to hold both. A link's target names are elements of their own.
    const texts = [...flattenValue(rawValue), ...params.context.getLinkTargetNames(params.file, key)];

    if (texts.some((text) => checkExpression(expression, text))) {
      return true;
    }
  }

  return false;
}

function escapeRegex(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`);
}

/**
 * Turns a frontmatter value into the texts a term is tested against, one per list element.
 *
 * @param rawValue - The value as the metadata cache holds it.
 * @returns The texts; none for `null` and for a nested object, which core Search does not search either.
 */
function flattenValue(rawValue: unknown): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue.flatMap((element: unknown) => flattenValue(element));
  }

  return typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean' ? [String(rawValue)] : [];
}
