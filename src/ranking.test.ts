import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { RankedCandidate } from './ranking.ts';
import type {
  PathMatch,
  PositionMatch
} from './segment-matcher.ts';

import {
  createCandidateComparator,
  RankingMode
} from './ranking.ts';
import {
  LabelMatchQuality,
  MatchTier
} from './segment-matcher.ts';

interface BuildCandidateOptions {
  readonly firstMatchedPositionIndex?: number;
  readonly gapCount?: number;
  readonly positions?: readonly (null | PositionMatch)[];
  readonly qualityScore?: number;
  readonly tier?: MatchTier;
}

describe('createCandidateComparator', () => {
  describe('Tiered', () => {
    it('should put a real-name match ahead of one that needed an alias, however well the alias matched', () => {
      const realName = buildCandidate('Real.md', { positions: [position(LabelMatchQuality.Substring)], tier: MatchTier.RealNamesOnly });
      const alias = buildCandidate('Alias.md', { positions: [position(LabelMatchQuality.Exact)], tier: MatchTier.LeafAlias });
      expect(sortPaths([alias, realName], RankingMode.Tiered)).toStrictEqual(['Real.md', 'Alias.md']);
    });

    it('should prefer a contiguous match to a scattered one inside the same tier', () => {
      const contiguous = buildCandidate('Contiguous.md', { gapCount: 0 });
      const scattered = buildCandidate('Scattered.md', { gapCount: 2 });
      expect(sortPaths([scattered, contiguous], RankingMode.Tiered)).toStrictEqual(['Contiguous.md', 'Scattered.md']);
    });

    it('should prefer the earlier match position when the gaps tie', () => {
      const early = buildCandidate('Early.md', { firstMatchedPositionIndex: 0 });
      const late = buildCandidate('Late.md', { firstMatchedPositionIndex: 3 });
      expect(sortPaths([late, early], RankingMode.Tiered)).toStrictEqual(['Early.md', 'Late.md']);
    });

    it('should prefer the higher summed quality when everything above it ties', () => {
      const better = buildCandidate('Better.md', { qualityScore: 6 });
      const worse = buildCandidate('Worse.md', { qualityScore: 2 });
      expect(sortPaths([worse, better], RankingMode.Tiered)).toStrictEqual(['Better.md', 'Worse.md']);
    });
  });

  describe('LinkPicker', () => {
    it('should put the stronger match first even when it needed an alias', () => {
      const realName = buildCandidate('Real.md', { positions: [position(LabelMatchQuality.Substring)], tier: MatchTier.RealNamesOnly });
      const alias = buildCandidate('Alias.md', { positions: [position(LabelMatchQuality.Exact)], tier: MatchTier.LeafAlias });
      expect(sortPaths([realName, alias], RankingMode.LinkPicker)).toStrictEqual(['Alias.md', 'Real.md']);
    });

    it('should still fall back to the tier once the match strength ties exactly', () => {
      const realName = buildCandidate('Real.md', { tier: MatchTier.RealNamesOnly });
      const alias = buildCandidate('Alias.md', { tier: MatchTier.LeafAlias });
      expect(sortPaths([alias, realName], RankingMode.LinkPicker)).toStrictEqual(['Real.md', 'Alias.md']);
    });

    it('should prefer an exact leaf over an exact ancestor with a weaker leaf', () => {
      const exactLeaf = buildCandidate('ExactLeaf.md', { positions: [position(LabelMatchQuality.Prefix), position(LabelMatchQuality.Exact)] });
      const exactAncestor = buildCandidate('ExactAncestor.md', { positions: [position(LabelMatchQuality.Exact), position(LabelMatchQuality.Prefix)] });
      expect(sortPaths([exactAncestor, exactLeaf], RankingMode.LinkPicker)).toStrictEqual(['ExactLeaf.md', 'ExactAncestor.md']);
    });

    it('should fall through to the file properties when the match is identical', () => {
      const first = buildCandidate('Alpha.md');
      const second = buildCandidate('Bravo.md');
      expect(sortPaths([second, first], RankingMode.LinkPicker)).toStrictEqual(['Alpha.md', 'Bravo.md']);
    });

    it('should rank a match that never reached the leaf behind one that did', () => {
      const reachedLeaf = buildCandidate('Leaf.md', { positions: [position(LabelMatchQuality.Prefix)], tier: MatchTier.RealNamesOnly });
      const ancestorOnly = buildCandidate('Ancestor.md', { positions: [position(LabelMatchQuality.Prefix), null], tier: MatchTier.AncestorOnly });
      expect(sortPaths([ancestorOnly, reachedLeaf], RankingMode.LinkPicker)).toStrictEqual(['Leaf.md', 'Ancestor.md']);
    });
  });

  describe('the tiebreaks both modes share', () => {
    it('should prefer a recently-opened file', () => {
      const recent = buildCandidate('Recent.md');
      const cold = buildCandidate('Cold.md');
      const comparator = createCandidateComparator({
        lastOpenFileIndexMap: new Map([['Recent.md', 0]]),
        mode: RankingMode.Tiered
      });
      expect([cold, recent].sort(comparator).map((candidate) => candidate.path)).toStrictEqual(['Recent.md', 'Cold.md']);
    });

    it('should prefer the shallower path, then the shorter one, then alphabetical order', () => {
      const shallow = buildCandidate('Bravo.md');
      const deep = buildCandidate('Alpha/Bravo.md');
      const longer = buildCandidate('Bravo Charlie.md');
      const alphabetical = buildCandidate('Alpha.md');
      expect(sortPaths([deep, longer, shallow, alphabetical], RankingMode.Tiered))
        .toStrictEqual(['Alpha.md', 'Bravo.md', 'Bravo Charlie.md', 'Alpha/Bravo.md']);
    });
  });

  it('should throw on a mode that is not one of its members', () => {
    const comparator = createCandidateComparator({ lastOpenFileIndexMap: new Map(), mode: castTo<RankingMode>('Nonsense') });
    expect(() => comparator(buildCandidate('A.md'), buildCandidate('B.md'))).toThrow();
  });
});

function buildCandidate(path: string, options: BuildCandidateOptions = {}): RankedCandidate {
  const match: PathMatch = {
    firstMatchedPositionIndex: options.firstMatchedPositionIndex ?? 0,
    gapCount: options.gapCount ?? 0,
    positions: options.positions ?? [position(LabelMatchQuality.Exact)],
    qualityScore: options.qualityScore ?? LabelMatchQuality.Exact,
    tier: options.tier ?? MatchTier.RealNamesOnly
  };
  return { match, path };
}

function position(quality: LabelMatchQuality): PositionMatch {
  return { isAlias: false, label: 'Label', quality, ranges: [{ length: 5, startIndex: 0 }] };
}

function sortPaths(candidates: RankedCandidate[], mode: RankingMode): string[] {
  const comparator = createCandidateComparator({ lastOpenFileIndexMap: new Map(), mode });
  return [...candidates].sort(comparator).map((candidate) => candidate.path);
}
