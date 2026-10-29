/**
 * @file
 *
 * Reads core Search's property terms out of a switcher query: `[property]`, `[property:value]`,
 * `[property:null]`, with double quotes, `OR`, parentheses and `/regex/` inside the brackets, and `OR` between
 * two terms.
 *
 * The syntax is core Search's own, not a new one, so a user who already searches by property types the same
 * thing here. What each piece MEANS was measured against a real Obsidian 1.14 rather than read off its help
 * page, because the page leaves most of it unsaid:
 *
 * - An unquoted key or value is a case-insensitive SUBSTRING: `[iso:uk]` finds `isoCode: UKR`.
 * - A quoted key is the whole key; a quoted value is a whole-word phrase: `[isoCode:"uk"]` finds `uk` and not
 *   `UKR`, and `[city:"Migu"]` finds nothing in `San Miguel de Allende`.
 * - Several unquoted words in one value must ALL appear, in any order: `[city:Allende San]` matches.
 * - Inside a quoted value `\"` is a literal quote.
 * - An unclosed term still counts: `[isoCode:uk` finds what `[isoCode:uk]` does — which is what lets a value be
 *   completed while it is still being typed.
 */

/**
 * How one piece of text in a term is tested.
 */
export enum TextPatternKind {
  /**
   * A quoted value: the whole-word phrase must appear. As a KEY, the whole key must equal it.
   */
  Phrase = 'Phrase',

  /**
   * A `/regex/`, tested as written, case-insensitively unless it says otherwise.
   */
  Regex = 'Regex',

  /**
   * Bare text: a case-insensitive substring.
   */
  Word = 'Word'
}

/**
 * What a term asks of the property's value.
 */
export enum ValueConditionKind {
  /**
   * `[property]` — the property is there, whatever it holds.
   */
  Exists = 'Exists',

  /**
   * `[property:value]` — some element of the value satisfies the expression.
   */
  Expression = 'Expression',

  /**
   * `[property:null]` — the property is there and holds nothing.
   */
  Null = 'Null'
}

/**
 * The `[property:value]` form.
 */
export interface ExpressionValueCondition {
  readonly expression: ValueExpression;
  readonly kind: ValueConditionKind.Expression;
}

/**
 * The `[property]` and `[property:null]` forms.
 */
export interface NonExpressionValueCondition {
  readonly kind: ValueConditionKind.Exists | ValueConditionKind.Null;
}

/**
 * A term the user is still typing the value of, which is what value completion offers values for.
 */
export interface OpenValueTerm {
  /**
   * The key exactly as typed, trimmed, quotes included, so a completion keeps the user's own spelling.
   */
  readonly keySource: string;

  /**
   * The value typed so far, with a leading quote dropped.
   */
  readonly partialValue: string;

  /**
   * Where the term's `[` sits in the query, so a completion can replace the term and nothing before it.
   */
  readonly startIndex: number;
}

/**
 * A parsed query.
 */
export interface PropertyQuery {
  /**
   * The property terms: every group must hold, and a group holds when any of its terms does. Empty when the
   * query carries none.
   */
  readonly groups: readonly (readonly PropertyTerm[])[];

  /**
   * The last term, when it is still open after its colon.
   */
  readonly openValueTerm: null | OpenValueTerm;

  /**
   * Everything that is not a property term, for the ordinary path matching.
   */
  readonly pathQuery: string;
}

/**
 * One `[...]` term.
 */
export interface PropertyTerm {
  readonly key: TextPattern;
  readonly value: ValueCondition;
}

/**
 * A `/regex/`.
 */
export interface RegexTextPattern {
  readonly kind: TextPatternKind.Regex;
  readonly regex: RegExp;
}

/**
 * Bare or quoted text.
 */
export interface StringTextPattern {
  readonly kind: TextPatternKind.Phrase | TextPatternKind.Word;
  readonly text: string;
}

/**
 * A piece of text and how it is tested.
 */
export type TextPattern = RegexTextPattern | StringTextPattern;

/**
 * A value expression: `OR` binds looser than the implicit AND between neighbors, as in core Search.
 */
export type ValueExpression = CompoundValueExpression | PatternValueExpression;

/**
 * Several expressions that must all, or any one, hold.
 */
interface CompoundValueExpression {
  readonly kind: 'and' | 'or';
  readonly operands: readonly ValueExpression[];
}

/**
 * One pattern to test.
 */
interface PatternValueExpression {
  readonly kind: 'pattern';
  readonly pattern: TextPattern;
}

interface PatternValueToken {
  readonly kind: 'pattern';
  readonly pattern: TextPattern;
}

interface QuotedText {
  /**
   * The index just past the closing quote.
   */
  readonly endIndex: number;

  readonly text: string;
}

interface ScannedTerm {
  readonly endIndex: number;
  readonly openValueTerm: null | OpenValueTerm;
  readonly term: PropertyTerm;
}

interface SymbolValueToken {
  readonly kind: 'close' | 'open' | 'or';
}

type ValueCondition = ExpressionValueCondition | NonExpressionValueCondition;

type ValueToken = PatternValueToken | SymbolValueToken;

/**
 * How many characters an escape (`\"`, `\\`, `\/`) spans.
 */
const ESCAPE_LENGTH = 2;

const OR_KEYWORD = 'OR';
const NULL_KEYWORD = 'null';

/**
 * A recursive-descent reader over the value tokens: `or := and (OR and)*`, `and := atom+`,
 * `atom := ( or ) | pattern`. Lenient the way core Search is while the user types: a stray `OR`, an unclosed
 * parenthesis or a stray `)` is skipped rather than reported.
 */
class ValueExpressionParser {
  private index = 0;

  public constructor(private readonly tokens: readonly ValueToken[]) {}

  public parse(): ValueExpression {
    return this.parseOr(0);
  }

  private parseAnd(depth: number): ValueExpression[] {
    const operands: ValueExpression[] = [];

    for (let token = this.tokens[this.index]; token && token.kind !== 'or' && token.kind !== 'close'; token = this.tokens[this.index]) {
      this.index++;

      if (token.kind === 'pattern') {
        operands.push({ kind: 'pattern', pattern: token.pattern });
        continue;
      }

      operands.push(this.parseOr(depth + 1));

      if (this.tokens[this.index]?.kind === 'close') {
        this.index++;
      }
    }

    return operands;
  }

  private parseOr(depth: number): ValueExpression {
    const alternatives: ValueExpression[][] = [this.parseAnd(depth)];

    for (let token = this.tokens[this.index]; token; token = this.tokens[this.index]) {
      // A `)` closes the group the caller opened; one with nothing open is skipped, so the rest is still read.
      if (token.kind === 'close' && depth > 0) {
        break;
      }

      this.index++;
      alternatives.push(this.parseAnd(depth));
    }

    // An empty alternative is what a stray `OR` leaves behind; it would otherwise match everything.
    const operands = alternatives.filter((alternative) => alternative.length > 0).map((alternative) => toConjunction(alternative));
    return operands.length === 1 && operands[0] ? operands[0] : { kind: 'or', operands };
  }
}

/**
 * Splits a query into its property terms and the path query around them.
 *
 * A `[` opens a term only at the start of a word, so a name that merely contains a bracket is still path text.
 *
 * @param query - The query as typed.
 * @returns The parsed query.
 */
export function parsePropertyQuery(query: string): PropertyQuery {
  const groups: PropertyTerm[][] = [];
  const pathParts: string[] = [];
  let openValueTerm: null | OpenValueTerm = null;
  let isOrPending = false;
  let index = 0;

  while (index < query.length) {
    const character = query.charAt(index);

    if (/\s/.test(character)) {
      index++;
      continue;
    }

    if (character === '[') {
      const scanned = scanTerm(query, index);
      const lastGroup = groups.at(-1);

      if (isOrPending && lastGroup) {
        lastGroup.push(scanned.term);
      } else {
        groups.push([scanned.term]);
      }

      isOrPending = false;
      openValueTerm = scanned.openValueTerm;
      index = scanned.endIndex;
      continue;
    }

    let wordEnd = index;
    while (wordEnd < query.length && !/\s/.test(query.charAt(wordEnd))) {
      wordEnd++;
    }

    const word = query.slice(index, wordEnd);

    // `OR` joins two TERMS only. Anywhere else it is a word like any other, and the path query keeps it.
    if (word === OR_KEYWORD && groups.length > 0 && query.slice(wordEnd).trimStart().startsWith('[')) {
      isOrPending = true;
    } else {
      pathParts.push(word);
      openValueTerm = null;
    }

    index = wordEnd;
  }

  return { groups, openValueTerm, pathQuery: pathParts.join(' ') };
}

/**
 * Quotes a value for a completed term, so that what is inserted is the whole-word phrase rather than a
 * substring, and survives a space, a bracket or a quote inside it.
 *
 * @param value - The value.
 * @returns The quoted value.
 */
export function quoteValue(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`)}"`;
}

function buildRegexPattern(source: string, flags: string): null | TextPattern {
  try {
    return { kind: TextPatternKind.Regex, regex: new RegExp(source, flags.includes('i') ? flags : `${flags}i`) };
  } catch {
    return null;
  }
}

function parseKey(source: string): TextPattern {
  const trimmed = source.trim();

  if (trimmed.startsWith('"')) {
    return { kind: TextPatternKind.Phrase, text: readQuoted(trimmed, 0).text };
  }

  const lastSlashIndex = trimmed.lastIndexOf('/');
  const regexPattern = /^\/.+\/[a-z]*$/.test(trimmed) ? buildRegexPattern(trimmed.slice(1, lastSlashIndex), trimmed.slice(lastSlashIndex + 1)) : null;
  return regexPattern ?? { kind: TextPatternKind.Word, text: trimmed };
}

function parseValueCondition(source: string): ValueCondition {
  const trimmed = source.trim();

  if (!trimmed) {
    return { kind: ValueConditionKind.Exists };
  }

  if (trimmed.toLowerCase() === NULL_KEYWORD) {
    return { kind: ValueConditionKind.Null };
  }

  const tokens = tokenizeValue(trimmed);
  const parser = new ValueExpressionParser(tokens);
  return { expression: parser.parse(), kind: ValueConditionKind.Expression };
}

/**
 * Reads a double-quoted string starting at `startIndex`, honoring `\"` and `\\`. An unclosed one runs to the end.
 *
 * @param source - The text.
 * @param startIndex - The index of the opening quote.
 * @returns The unescaped text and the index just past the closing quote.
 */
function readQuoted(source: string, startIndex: number): QuotedText {
  let text = '';
  let index = startIndex + 1;

  while (index < source.length) {
    const character = source.charAt(index);

    if (character === '\\' && index + 1 < source.length) {
      text += source.charAt(index + 1);
      index += ESCAPE_LENGTH;
      continue;
    }

    if (character === '"') {
      return { endIndex: index + 1, text };
    }

    text += character;
    index++;
  }

  return { endIndex: index, text };
}

/**
 * Finds where a `/regex/` that starts at `startIndex` ends, flags included, or `-1` when it never closes.
 *
 * @param source - The text.
 * @param startIndex - The index of the opening slash.
 * @returns The index just past the regex.
 */
function readRegexEnd(source: string, startIndex: number): number {
  let index = startIndex + 1;

  while (index < source.length) {
    const character = source.charAt(index);

    if (character === '\\') {
      index += ESCAPE_LENGTH;
      continue;
    }

    if (character === '/' && index > startIndex + 1) {
      index++;
      while (/[a-z]/.test(source.charAt(index))) {
        index++;
      }

      return index;
    }

    index++;
  }

  return -1;
}

/**
 * Reads one `[...]` term starting at its `[`.
 *
 * @param query - The query.
 * @param startIndex - The index of the `[`.
 * @returns The term, where it ends, and — when it is still open after its colon — what value completion needs.
 */
function scanTerm(query: string, startIndex: number): ScannedTerm {
  let index = startIndex + 1;

  // The key: a quoted key may hold a `:` or a `]`, which is the reason quoting a key exists.
  const keyStart = index;
  while (index < query.length) {
    const character = query.charAt(index);

    if (character === '"') {
      index = readQuoted(query, index).endIndex;
      continue;
    }

    if (character === ':' || character === ']') {
      break;
    }

    index++;
  }

  const keySource = query.slice(keyStart, index).trim();
  const key = parseKey(keySource);

  if (index >= query.length || query.charAt(index) === ']') {
    return {
      endIndex: Math.min(index + 1, query.length),
      openValueTerm: null,
      term: { key, value: { kind: ValueConditionKind.Exists } }
    };
  }

  // Past the colon: the value runs to the `]` that sits outside every quote, regex and parenthesis.
  index++;
  const valueStart = index;
  let depth = 0;
  let isAtTokenStart = true;

  while (index < query.length) {
    const character = query.charAt(index);

    if (character === '"') {
      index = readQuoted(query, index).endIndex;
      isAtTokenStart = false;
      continue;
    }

    if (character === '/' && isAtTokenStart) {
      const regexEnd = readRegexEnd(query, index);

      if (regexEnd !== -1) {
        index = regexEnd;
        isAtTokenStart = false;
        continue;
      }
    }

    if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
    } else if (character === ']' && depth === 0) {
      break;
    }

    isAtTokenStart = /[\s(]/.test(character);
    index++;
  }

  const valueSource = query.slice(valueStart, index);
  const term: PropertyTerm = { key, value: parseValueCondition(valueSource) };

  if (index >= query.length) {
    return {
      endIndex: index,
      openValueTerm: { keySource, partialValue: valueSource.trimStart().replace(/^"/, ''), startIndex },
      term
    };
  }

  return { endIndex: index + 1, openValueTerm: null, term };
}

function toConjunction(operands: readonly ValueExpression[]): ValueExpression {
  return operands.length === 1 && operands[0] ? operands[0] : { kind: 'and', operands };
}

function tokenizeValue(source: string): ValueToken[] {
  const tokens: ValueToken[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source.charAt(index);

    if (/\s/.test(character)) {
      index++;
      continue;
    }

    if (character === '(' || character === ')') {
      tokens.push({ kind: character === '(' ? 'open' : 'close' });
      index++;
      continue;
    }

    if (character === '"') {
      const quoted = readQuoted(source, index);
      tokens.push({ kind: 'pattern', pattern: { kind: TextPatternKind.Phrase, text: quoted.text } });
      index = quoted.endIndex;
      continue;
    }

    if (character === '/') {
      const regexEnd = readRegexEnd(source, index);

      if (regexEnd !== -1) {
        const literal = source.slice(index, regexEnd);
        const lastSlashIndex = literal.lastIndexOf('/');
        const pattern = buildRegexPattern(literal.slice(1, lastSlashIndex), literal.slice(lastSlashIndex + 1));

        if (pattern) {
          tokens.push({ kind: 'pattern', pattern });
          index = regexEnd;
          continue;
        }
      }
    }

    let wordEnd = index;
    while (wordEnd < source.length && !/[\s()"]/.test(source.charAt(wordEnd))) {
      wordEnd++;
    }

    // Every character left here is a word character, so a word always has at least one.
    const word = source.slice(index, wordEnd);
    tokens.push(word === OR_KEYWORD ? { kind: 'or' } : { kind: 'pattern', pattern: { kind: TextPatternKind.Word, text: word } });
    index += word.length;
  }

  return tokens;
}
