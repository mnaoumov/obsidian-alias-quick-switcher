/**
 * @file
 *
 * Orders candidates that have already been matched. Kept apart from `segment-matcher.ts`, which decides
 * how ONE query lies over ONE path; this decides which of two such results the user sees first.
 *
 * The order is a setting rather than a constant because the two sensible answers disagree about something
 * real, not cosmetic: whether an alias is a second-class name. See {@link RankingMode}.
 */

import {
  assertNever,
  ensureNonNullable
} from 'obsidian-dev-utils/type-guards';

import type {
  PathMatch,
  PositionMatch
} from './segment-matcher.ts';

import {
  LabelMatchQuality,
  MatchTier
} from './segment-matcher.ts';

/**
 * Which order matching results are shown in.
 *
 * The two differ on one question, and it is a real one: does needing an alias make a result worse? Under
 * {@link RankingMode.Tiered} it does, and that is what guarantees this switcher never reshuffles the
 * results Obsidian's own already gives. Under {@link RankingMode.LinkPicker} an alias is just another
 * name, and how WELL the query matched decides everything — which surfaces alias hits sooner, at the cost
 * of that guarantee.
 */
export enum RankingMode {
  /**
   * `obsidian-link-picker`'s order: strength of the match first, aliases and real names equal.
   */
  LinkPicker = 'LinkPicker',

  /**
   * Real names before aliases, then contiguity, then position. The default.
   */
  Tiered = 'Tiered'
}

/**
 * Parameters for {@link createCandidateComparator}.
 */
export interface CreateCandidateComparatorParams {
  /**
   * Recently-opened paths mapped to their position in the recent list. A path that is absent has not been
   * opened recently and sorts after every path that has.
   */
  readonly lastOpenFileIndexMap: ReadonlyMap<string, number>;

  /**
   * Which order to apply.
   */
  readonly mode: RankingMode;
}

/**
 * One matched candidate, ready to be ordered against the others.
 */
export interface RankedCandidate {
  /**
   * How the query lay over {@link path}.
   */
  readonly match: PathMatch;

  /**
   * The candidate's vault-relative path, used for the last tiebreaks and for recency.
   */
  readonly path: string;
}

/**
 * Sorts after every real index, so a path nobody has opened recently ranks below every path that has. Not
 * `Infinity`: the values are subtracted, and `Infinity - Infinity` is `NaN`, which would make the
 * comparator inconsistent rather than merely last.
 */
const NEVER_OPENED_INDEX = Number.MAX_SAFE_INTEGER;

/**
 * Builds the comparator the switcher sorts its results with.
 *
 * @param params - The order to apply, and the recency the tiebreaks read.
 * @returns A comparator over matched candidates, best first.
 */
export function createCandidateComparator(params: CreateCandidateComparatorParams): (a: RankedCandidate, b: RankedCandidate) => number {
  return (a: RankedCandidate, b: RankedCandidate): number => {
    switch (params.mode) {
      case RankingMode.LinkPicker: {
        return compareByMatchStrength(a, b) || compareByTier(a, b) || compareByFileProperties(a, b, params.lastOpenFileIndexMap);
      }
      case RankingMode.Tiered: {
        return compareByTier(a, b) || compareByMatchStrength(a, b) || compareByFileProperties(a, b, params.lastOpenFileIndexMap);
      }
      default: {
        return assertNever(params.mode);
      }
    }
  };
}

/**
 * Whether every position the query actually matched came out at least this good.
 *
 * @param match - The match.
 * @param quality - The bar to clear.
 * @returns `true` when no matched position fell below the bar.
 */
function checkEveryMatchedPosition(match: PathMatch, quality: LabelMatchQuality): boolean {
  return match.positions.every((position) => !position || position.quality >= quality);
}

/**
 * Whether the leaf position came out at least this good. A match that never reached the leaf answers
 * `false`, which is what puts it behind every match that did.
 *
 * @param match - The match.
 * @param quality - The bar to clear.
 * @returns `true` when the leaf cleared the bar.
 */
function checkLeaf(match: PathMatch, quality: LabelMatchQuality): boolean {
  return (readLeafMatch(match)?.quality ?? -1) >= quality;
}

function compareByFileProperties(a: RankedCandidate, b: RankedCandidate, lastOpenFileIndexMap: ReadonlyMap<string, number>): number {
  return (lastOpenFileIndexMap.get(a.path) ?? NEVER_OPENED_INDEX) - (lastOpenFileIndexMap.get(b.path) ?? NEVER_OPENED_INDEX)
    // Shallower first, so a note near the top of the vault outranks a deeper one the query fits equally well.
    || countSlashes(a.path) - countSlashes(b.path)
    || a.path.length - b.path.length
    || a.path.localeCompare(b.path);
}

/**
 * How well the query matched, ignoring entirely whether it matched a real name or an alias.
 */
function compareByMatchStrength(a: RankedCandidate, b: RankedCandidate): number {
  return rankFirst(a, b, (candidate) => checkEveryMatchedPosition(candidate.match, LabelMatchQuality.Exact))
    || rankFirst(a, b, (candidate) => checkLeaf(candidate.match, LabelMatchQuality.Exact))
    || rankFirst(a, b, (candidate) => checkEveryMatchedPosition(candidate.match, LabelMatchQuality.Prefix))
    || rankFirst(a, b, (candidate) => checkLeaf(candidate.match, LabelMatchQuality.Prefix))
    // Contiguous over scattered, then the earliest hit, then the summed per-position quality.
    || a.match.gapCount - b.match.gapCount
    || a.match.firstMatchedPositionIndex - b.match.firstMatchedPositionIndex
    || b.match.qualityScore - a.match.qualityScore;
}

function compareByTier(a: RankedCandidate, b: RankedCandidate): number {
  return a.match.tier - b.match.tier;
}

function countSlashes(path: string): number {
  return (path.match(/\//g) ?? []).length;
}

/**
 * Orders the candidate satisfying `checkCandidate` ahead of the one that does not.
 */
function rankFirst(a: RankedCandidate, b: RankedCandidate, checkCandidate: (candidate: RankedCandidate) => boolean): number {
  return Number(checkCandidate(b)) - Number(checkCandidate(a));
}

function readLeafMatch(match: PathMatch): null | PositionMatch {
  if (match.tier === MatchTier.AncestorOnly) {
    return null;
  }

  // Any other tier is defined by HOW the leaf matched, so it has one. Asserting says so without leaving a
  // Fallback branch nothing can take.
  return ensureNonNullable(match.positions.at(-1), 'A match outside the ancestor-only tier has a leaf');
}
