/**
 * @file
 *
 * Matches a path-shaped query against one candidate path, position by position, where every position may
 * be satisfied by a real name **or** by an alias.
 *
 * This is the layer that resolves `Alpha/Delta/Echo` to `Alpha/Bravo/Charlie.md`. It is deliberately
 * headless — strings in, a match record out, no `App` and no DOM — because every correctness question
 * about the matching lives here and is answerable by a unit test.
 */

import {
  assertNever,
  ensureNonNullable
} from 'obsidian-dev-utils/type-guards';

/**
 * How well a query segment matched one label. Higher is better, and the values are summed into
 * {@link PathMatch.qualityScore}.
 */
/* eslint-disable no-magic-numbers -- The numbers ARE the meaning here: qualities are summed and tiers are subtracted, so their order is arithmetic rather than a label on an arbitrary constant. */
export enum LabelMatchQuality {
  /**
   * The segment's characters appear inside the label in order, but not contiguously. Only reachable under
   * {@link SegmentMatchMode.Fuzzy}.
   */
  Subsequence = 0,

  /**
   * The segment appears somewhere inside the label, contiguously.
   */
  Substring = 1,

  /**
   * The label starts with the segment.
   */
  Prefix = 2,

  /**
   * The label and the segment are the same string.
   */
  Exact = 3
}

/**
 * The ranking tiers, best first. The order is the whole reason the plugin never reshuffles what the
 * built-in switcher already finds: anything matched purely by real names outranks anything that needed an
 * alias.
 */
export enum MatchTier {
  /**
   * The leaf and every matched ancestor were satisfied by their real names.
   */
  RealNamesOnly = 0,

  /**
   * The leaf matched by its real name, and some ancestor was satisfied by an alias.
   */
  AncestorAlias = 1,

  /**
   * The leaf matched by an alias.
   */
  LeafAlias = 2,

  /**
   * The leaf matched nothing — only ancestors did.
   */
  AncestorOnly = 3
}

/**
 * How one query segment is tested against one label.
 */
export enum SegmentMatchMode {
  /**
   * The segment's characters appear inside the label in order, the way Obsidian's own fuzzy search works.
   * Finds more, at the cost of matching things the user did not mean.
   */
  Fuzzy = 'Fuzzy',

  /**
   * The segment appears inside the label as a contiguous run, the rule `obsidian-link-picker` uses. The
   * default, because it is predictable and cheap enough to run against a whole vault per keystroke.
   */
  Substring = 'Substring'
}

/**
 * Whether, and how, the leaf position matched. Kept out of {@link MatchTier} because the tier also depends
 * on the ancestors, which are not known until the whole path has been walked.
 */
enum LeafKind {
  Unmatched = 0,
  Alias = 1,
  RealName = 2
}
/* eslint-enable no-magic-numbers -- The numbers ARE the meaning here. */

/**
 * One name a path position answers to.
 */
export interface Label {
  /**
   * Whether this label is an alias rather than the real name of the file or folder at the position.
   */
  readonly isAlias: boolean;

  /**
   * The label itself, as the user would type it.
   */
  readonly text: string;
}

/**
 * Parameters for {@link matchPath}.
 */
export interface MatchPathParams {
  /**
   * How one query segment is tested against one label.
   */
  readonly mode: SegmentMatchMode;

  /**
   * The candidate's positions, outermost first, with the leaf last.
   */
  readonly positions: readonly PathPosition[];

  /**
   * The tokenized query, as {@link tokenizeQuery} returns it.
   */
  readonly tokens: readonly QueryToken[];
}

/**
 * A contiguous run of characters inside a label that the query matched.
 */
export interface MatchRange {
  /**
   * How many characters the run covers.
   */
  readonly length: number;

  /**
   * Where the run starts inside the label.
   */
  readonly startIndex: number;
}

/**
 * How a whole query matched a whole path.
 */
export interface PathMatch {
  /**
   * The index of the outermost position that matched. Lower is better: a hit near the start of the path
   * is closer to what the user typed than the same hit further in.
   */
  readonly firstMatchedPositionIndex: number;

  /**
   * How many positions were skipped BETWEEN matched ones. Leading and trailing skips are not gaps — they
   * are what makes a partial path like `Delta/Echo` a legitimate match.
   */
  readonly gapCount: number;

  /**
   * One entry per position, in path order. `null` means the position matched nothing.
   */
  readonly positions: readonly (null | PositionMatch)[];

  /**
   * The summed {@link LabelMatchQuality} of every matched position.
   */
  readonly qualityScore: number;

  /**
   * Which ranking tier the match falls in.
   */
  readonly tier: MatchTier;
}

/**
 * One position in a candidate path — a folder for an ancestor, the file itself for the leaf.
 */
export interface PathPosition {
  /**
   * Every name this position answers to: its real name first, then its aliases.
   */
  readonly labels: readonly Label[];
}

/**
 * How one position was satisfied.
 */
export interface PositionMatch {
  /**
   * Whether {@link label} is an alias rather than the position's real name.
   */
  readonly isAlias: boolean;

  /**
   * The label that satisfied the position — what the row renders in place of the real name.
   */
  readonly label: string;

  /**
   * How well the query matched {@link label}.
   */
  readonly quality: LabelMatchQuality;

  /**
   * The runs inside {@link label} that the query covered, for highlighting.
   */
  readonly ranges: readonly MatchRange[];
}

/**
 * One unit of the query, as {@link tokenizeQuery} produces them.
 */
export interface QueryToken {
  /**
   * Whether a `/` — rather than whitespace — separated this token from the one before it. A hard boundary
   * forbids joining this token to the previous one at the same position; whitespace permits it, which is
   * what lets `Alpha Bravo Charlie` and `Alpha/Bravo/Charlie` both match.
   */
  readonly isAfterHardBoundary: boolean;

  /**
   * The token's text, already lower-cased.
   */
  readonly text: string;
}

/**
 * How many members {@link LeafKind} has, used to pack it into a state key.
 */
const LEAF_KIND_COUNT = 3;

/**
 * How many values a boolean packs into, used to fold one into a state key.
 */
const BOOLEAN_RADIX = 2;

/**
 * A single label match, before it is attributed to a position.
 */
interface LabelMatch {
  readonly quality: LabelMatchQuality;
  readonly ranges: readonly MatchRange[];
}

/**
 * Constructor parameters for {@link PathMatcher}. Declared out in full rather than derived from
 * {@link MatchPathParams}, so each member carries its own documentation.
 */
interface PathMatcherConstructorParams {
  /**
   * How one query segment is tested against one label.
   */
  readonly mode: SegmentMatchMode;

  /**
   * The candidate's positions, outermost first, with the leaf last. Never empty.
   */
  readonly positions: readonly PathPosition[];

  /**
   * The tokenized query. Never empty.
   */
  readonly tokens: readonly QueryToken[];
}

/**
 * A state key together with the value stored at it.
 */
interface StateEntry extends StateKeyParams {
  readonly value: StateValue;
}

/**
 * Identifies one cell of the DP table.
 */
interface StateKeyParams {
  readonly leafKind: LeafKind;
  readonly pendingSkipCount: number;
  readonly positionIndex: number;
  readonly tokenIndex: number;
  readonly wasAncestorAliasUsed: boolean;
}

/**
 * The best-known way of reaching one DP state.
 */
interface StateValue {
  readonly firstMatchedPositionIndex: number;
  readonly gapCount: number;
  readonly positionMatches: readonly (null | PositionMatch)[];
  readonly qualityScore: number;
}

/**
 * Walks the (query token x path position) table.
 *
 * A plain `(tokenIndex, positionIndex)` table cannot honour the ranking keys, because two of them are not
 * decided at the cell where the choice is made: whether a skipped position counts as a GAP depends on
 * whether anything is consumed after it, and the tier depends on the leaf and the ancestors together. The
 * state therefore carries `pendingSkipCount` — skips since the last consumption, which turn into gaps the
 * moment the next consumption happens — plus the two facts the tier is computed from. With those in the
 * state, every remaining key is additive or prefix-monotone, so keeping only the best prefix per state is
 * safe: it stays best under any suffix the state can still reach.
 */
class PathMatcher {
  private readonly leafIndex: number;
  private readonly mode: SegmentMatchMode;
  private readonly positionCount: number;
  private readonly positions: readonly PathPosition[];
  private readonly states = new Map<number, StateValue>();
  private readonly tokenCount: number;
  private readonly tokens: readonly QueryToken[];

  public constructor(params: PathMatcherConstructorParams) {
    this.mode = params.mode;
    this.positions = params.positions;
    this.tokens = params.tokens;
    this.positionCount = params.positions.length;
    this.tokenCount = params.tokens.length;
    this.leafIndex = this.positionCount - 1;
  }

  public match(): null | PathMatch {
    this.setState({
      leafKind: LeafKind.Unmatched,
      pendingSkipCount: 0,
      positionIndex: 0,
      tokenIndex: 0,
      value: {
        firstMatchedPositionIndex: this.positionCount,
        gapCount: 0,
        positionMatches: Array.from({ length: this.positionCount }, () => null),
        qualityScore: 0
      },
      wasAncestorAliasUsed: false
    });

    // Both transitions increase `positionIndex`, and consuming also increases `tokenIndex`, so walking the
    // Table in this order visits every state only after everything that can reach it has been settled.
    for (let positionIndex = 0; positionIndex < this.positionCount; positionIndex++) {
      for (let tokenIndex = 0; tokenIndex <= this.tokenCount; tokenIndex++) {
        this.expand(tokenIndex, positionIndex);
      }
    }

    return this.collectBestMatch();
  }

  private buildStateKey(params: StateKeyParams): number {
    const positionRadix = this.positionCount + 1;
    let key = params.tokenIndex;
    key = key * positionRadix + params.positionIndex;
    key = key * positionRadix + params.pendingSkipCount;
    key = key * BOOLEAN_RADIX + (params.wasAncestorAliasUsed ? 1 : 0);
    return key * LEAF_KIND_COUNT + params.leafKind;
  }

  private collectBestMatch(): null | PathMatch {
    let best: null | PathMatch = null;

    // Best tier first, so the comparison below is exercised in both directions rather than only ever
    // Improving. Which order the states are visited in must not change the answer — the comparison is what
    // Decides, not the enumeration.
    for (const leafKind of [LeafKind.RealName, LeafKind.Alias, LeafKind.Unmatched]) {
      for (const wasAncestorAliasUsed of [false, true]) {
        for (let pendingSkipCount = 0; pendingSkipCount <= this.positionCount; pendingSkipCount++) {
          const value = this.states.get(this.buildStateKey({
            leafKind,
            pendingSkipCount,
            positionIndex: this.positionCount,
            tokenIndex: this.tokenCount,
            wasAncestorAliasUsed
          }));

          if (!value) {
            continue;
          }

          const candidate: PathMatch = {
            firstMatchedPositionIndex: value.firstMatchedPositionIndex,
            gapCount: value.gapCount,
            positions: value.positionMatches,
            qualityScore: value.qualityScore,
            tier: resolveTier(leafKind, wasAncestorAliasUsed)
          };

          if (!best || compareWithinCandidate(candidate, best) < 0) {
            best = candidate;
          }
        }
      }
    }

    return best;
  }

  /**
   * Emits every transition out of one cell, for each way that cell can currently be reached.
   */
  private expand(tokenIndex: number, positionIndex: number): void {
    for (const leafKind of [LeafKind.Unmatched, LeafKind.Alias, LeafKind.RealName]) {
      for (const wasAncestorAliasUsed of [false, true]) {
        for (let pendingSkipCount = 0; pendingSkipCount <= positionIndex; pendingSkipCount++) {
          const value = this.states.get(this.buildStateKey({
            leafKind,
            pendingSkipCount,
            positionIndex,
            tokenIndex,
            wasAncestorAliasUsed
          }));

          if (!value) {
            continue;
          }

          this.expandSkip({
            leafKind,
            pendingSkipCount,
            positionIndex,
            tokenIndex,
            value,
            wasAncestorAliasUsed
          });
          this.expandConsume({
            leafKind,
            pendingSkipCount,
            positionIndex,
            tokenIndex,
            value,
            wasAncestorAliasUsed
          });
        }
      }
    }
  }

  /**
   * Lays one or more whitespace-joined tokens over the position, once per label that accepts them.
   */
  private expandConsume(params: StateEntry): void {
    const position = this.positions[params.positionIndex];

    if (!position || params.tokenIndex >= this.tokenCount) {
      return;
    }

    const isLeaf = params.positionIndex === this.leafIndex;
    let segment = '';

    for (let lastTokenIndex = params.tokenIndex; lastTokenIndex < this.tokenCount; lastTokenIndex++) {
      // Strict index access types the read as possibly absent, but the loop bound rules that out.
      // Asserting says so without leaving a branch nothing can take.
      const token = ensureNonNullable(this.tokens[lastTokenIndex], 'The loop is bounded by the token count');

      // A slash before a token means it belongs to the NEXT position, so the run of joinable tokens ends here.
      if (lastTokenIndex > params.tokenIndex && token.isAfterHardBoundary) {
        break;
      }

      segment = segment ? `${segment} ${token.text}` : token.text;

      for (const label of position.labels) {
        const labelMatch = matchLabel(this.mode, segment, label.text);

        if (!labelMatch) {
          continue;
        }

        const positionMatches = [...params.value.positionMatches];
        positionMatches[params.positionIndex] = {
          isAlias: label.isAlias,
          label: label.text,
          quality: labelMatch.quality,
          ranges: labelMatch.ranges
        };

        this.setState({
          leafKind: isLeaf ? (label.isAlias ? LeafKind.Alias : LeafKind.RealName) : params.leafKind,
          pendingSkipCount: 0,
          positionIndex: params.positionIndex + 1,
          tokenIndex: lastTokenIndex + 1,
          value: {
            firstMatchedPositionIndex: Math.min(params.value.firstMatchedPositionIndex, params.positionIndex),
            // The skips waited on until now are settled as gaps, because something is being consumed after them.
            gapCount: params.value.gapCount + (params.value.firstMatchedPositionIndex === this.positionCount ? 0 : params.pendingSkipCount),
            positionMatches,
            qualityScore: params.value.qualityScore + labelMatch.quality
          },
          wasAncestorAliasUsed: params.wasAncestorAliasUsed || (!isLeaf && label.isAlias)
        });
      }
    }
  }

  /**
   * Leaves the position unmatched, which is what makes a partial path a legitimate match.
   */
  private expandSkip(params: StateEntry): void {
    this.setState({
      leafKind: params.leafKind,
      pendingSkipCount: params.pendingSkipCount + 1,
      positionIndex: params.positionIndex + 1,
      tokenIndex: params.tokenIndex,
      value: params.value,
      wasAncestorAliasUsed: params.wasAncestorAliasUsed
    });
  }

  private setState(params: StateEntry): void {
    const key = this.buildStateKey(params);
    const existing = this.states.get(key);

    if (existing && compareStateValues(existing, params.value) <= 0) {
      return;
    }

    this.states.set(key, params.value);
  }
}

/**
 * Finds the best way one query can be laid over one path.
 *
 * @param params - The path's positions, the tokenized query, and the per-segment match rule.
 * @returns The best match, or `null` when the query cannot be laid over the path at all — including when
 *   the query is empty, which is a caller's cue to show recently-opened files rather than an unordered
 *   dump of the vault.
 */
export function matchPath(params: MatchPathParams): null | PathMatch {
  if (params.tokens.length === 0 || params.positions.length === 0) {
    return null;
  }

  return new PathMatcher(params).match();
}

/**
 * Splits a raw query into tokens, remembering which separator preceded each one.
 *
 * @param query - The raw query as typed.
 * @returns The tokens, lower-cased, in query order.
 */
export function tokenizeQuery(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  let text = '';
  let isAfterHardBoundary = true;

  function flush(isNextAfterHardBoundary: boolean): void {
    if (text) {
      tokens.push({ isAfterHardBoundary, text: text.toLowerCase() });
      isAfterHardBoundary = isNextAfterHardBoundary;
      text = '';
      return;
    }

    // An empty run still carries its boundary forward, so `Alpha//Bravo` and `Alpha/ /Bravo` stay hard.
    isAfterHardBoundary ||= isNextAfterHardBoundary;
  }

  for (const character of query) {
    if (character === '/') {
      flush(true);
      continue;
    }

    if (/\s/.test(character)) {
      flush(false);
      continue;
    }

    text += character;
  }

  flush(false);
  return tokens;
}

/**
 * Orders two prefixes that reach the SAME state. Every key here is additive or prefix-monotone, which is
 * what makes discarding the loser safe.
 *
 * @param a - The first prefix.
 * @param b - The second prefix.
 * @returns A negative number when `a` is better.
 */
function compareStateValues(a: StateValue, b: StateValue): number {
  return a.gapCount - b.gapCount
    || a.firstMatchedPositionIndex - b.firstMatchedPositionIndex
    || b.qualityScore - a.qualityScore;
}

/**
 * Orders two COMPLETE matches of the same candidate, so the matcher returns the best of them. Ranking
 * across different candidates is a separate concern and lives in `ranking.ts`.
 *
 * @param a - The first match.
 * @param b - The second match.
 * @returns A negative number when `a` is better.
 */
function compareWithinCandidate(a: PathMatch, b: PathMatch): number {
  return a.tier - b.tier
    || a.gapCount - b.gapCount
    || a.firstMatchedPositionIndex - b.firstMatchedPositionIndex
    || b.qualityScore - a.qualityScore;
}

/**
 * Tests one query segment against one label.
 *
 * @param mode - The per-segment match rule.
 * @param segment - The segment, already lower-cased.
 * @param label - The label, in its original casing.
 * @returns How the segment matched, or `null` when it did not.
 */
function matchLabel(mode: SegmentMatchMode, segment: string, label: string): LabelMatch | null {
  const lowerCaseLabel = label.toLowerCase();

  if (lowerCaseLabel === segment) {
    return { quality: LabelMatchQuality.Exact, ranges: [{ length: label.length, startIndex: 0 }] };
  }

  const startIndex = lowerCaseLabel.indexOf(segment);

  if (startIndex === 0) {
    return { quality: LabelMatchQuality.Prefix, ranges: [{ length: segment.length, startIndex: 0 }] };
  }

  if (startIndex > 0) {
    return { quality: LabelMatchQuality.Substring, ranges: [{ length: segment.length, startIndex }] };
  }

  switch (mode) {
    case SegmentMatchMode.Fuzzy: {
      return matchSubsequence(segment, lowerCaseLabel);
    }
    case SegmentMatchMode.Substring: {
      return null;
    }
    default: {
      return assertNever(mode);
    }
  }
}

/**
 * Tests whether a segment's characters appear inside a label in order, collecting the runs they cover.
 *
 * @param segment - The segment, already lower-cased.
 * @param lowerCaseLabel - The label, already lower-cased.
 * @returns The subsequence match, or `null` when the characters do not all appear in order.
 */
function matchSubsequence(segment: string, lowerCaseLabel: string): LabelMatch | null {
  const ranges: MatchRange[] = [];
  let labelIndex = 0;

  for (const character of segment) {
    const foundIndex = lowerCaseLabel.indexOf(character, labelIndex);

    if (foundIndex === -1) {
      return null;
    }

    const lastRange = ranges.at(-1);

    if (lastRange && lastRange.startIndex + lastRange.length === foundIndex) {
      ranges[ranges.length - 1] = { length: lastRange.length + 1, startIndex: lastRange.startIndex };
    } else {
      ranges.push({ length: 1, startIndex: foundIndex });
    }

    labelIndex = foundIndex + 1;
  }

  return { quality: LabelMatchQuality.Subsequence, ranges };
}

/**
 * Turns the two facts the DP carries into the tier they describe.
 *
 * @param leafKind - How the leaf position matched.
 * @param wasAncestorAliasUsed - Whether any ancestor was satisfied by an alias.
 * @returns The tier.
 */
function resolveTier(leafKind: LeafKind, wasAncestorAliasUsed: boolean): MatchTier {
  // Deliberately not a switch ending in `assertNever`. `LeafKind` is private to this module and every value
  // Of it is produced a few lines above, so unlike a mode read out of `data.json` there is no way for a
  // Value outside the type to arrive here — an exhaustiveness guard would be a branch nothing can take.
  if (leafKind === LeafKind.Unmatched) {
    return MatchTier.AncestorOnly;
  }

  if (leafKind === LeafKind.Alias) {
    return MatchTier.LeafAlias;
  }

  return wasAncestorAliasUsed ? MatchTier.AncestorAlias : MatchTier.RealNamesOnly;
}
