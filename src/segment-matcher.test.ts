import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  PathMatch,
  PathPosition
} from './segment-matcher.ts';

import {
  LabelMatchQuality,
  matchPath,
  MatchTier,
  SegmentMatchMode,
  tokenizeQuery
} from './segment-matcher.ts';

/**
 * The fixture the whole plugin was designed against, measured in a real Obsidian before any code existed:
 * `Alpha/Bravo/Charlie.md`, where the folder `Bravo` carries the alias `Delta` on its folder note and the
 * note `Charlie` carries the alias `Echo`.
 */
const FIXTURE_POSITIONS: readonly PathPosition[] = [
  buildPosition('Alpha'),
  buildPosition('Bravo', 'Delta'),
  buildPosition('Charlie', 'Echo')
];

describe('tokenizeQuery', () => {
  it('should mark a slash as a hard boundary and whitespace as a soft one', () => {
    expect(tokenizeQuery('Alpha/Bravo Charlie')).toStrictEqual([
      { isAfterHardBoundary: true, text: 'alpha' },
      { isAfterHardBoundary: true, text: 'bravo' },
      { isAfterHardBoundary: false, text: 'charlie' }
    ]);
  });

  it('should drop empty runs while keeping the hardest boundary they carried', () => {
    expect(tokenizeQuery('  Alpha // Bravo  ')).toStrictEqual([
      { isAfterHardBoundary: true, text: 'alpha' },
      { isAfterHardBoundary: true, text: 'bravo' }
    ]);
  });

  it('should return nothing for a blank query', () => {
    expect(tokenizeQuery(' '.repeat(3))).toStrictEqual([]);
  });
});

describe('matchPath', () => {
  describe('the nine query forms measured against the built-in switcher', () => {
    /*
     * The first three and `Echo` are what Obsidian's own switcher already finds. They must keep matching,
     * and — crucially — keep ranking in the tier that leaves the built-in's ordering alone. The last three
     * are what the built-in returns nothing for, and are the whole reason this plugin exists.
     */
    it.each([
      ['Alpha/Bravo/Charlie', MatchTier.RealNamesOnly],
      ['Alpha Bravo Charlie', MatchTier.RealNamesOnly],
      ['Bravo Charlie', MatchTier.RealNamesOnly],
      ['Echo', MatchTier.LeafAlias],
      ['Delta', MatchTier.AncestorOnly],
      ['Alpha/Bravo/Echo', MatchTier.LeafAlias],
      ['Alpha/Delta/Charlie', MatchTier.AncestorAlias],
      ['Alpha/Delta/Echo', MatchTier.LeafAlias]
    ])('should match %s in tier %i', (query, tier) => {
      expect(matchFixture(query)?.tier).toBe(tier);
    });
  });

  it('should report which label satisfied each position', () => {
    const match = matchFixture('Alpha/Delta/Echo');
    expect(match?.positions.map((position) => position?.label ?? null)).toStrictEqual(['Alpha', 'Delta', 'Echo']);
    expect(match?.positions.map((position) => position?.isAlias ?? null)).toStrictEqual([false, true, true]);
  });

  it('should match a partial path by skipping leading positions without counting a gap', () => {
    const match = matchFixture('Delta/Echo');
    expect(match?.tier).toBe(MatchTier.LeafAlias);
    expect(match?.gapCount).toBe(0);
    expect(match?.firstMatchedPositionIndex).toBe(1);
  });

  it('should count a skipped position between two matched ones as a gap', () => {
    const match = matchFixture('Alpha/Charlie');
    expect(match?.gapCount).toBe(1);
  });

  it('should not count trailing skipped positions as gaps', () => {
    const match = matchFixture('Alpha');
    expect(match?.gapCount).toBe(0);
    expect(match?.tier).toBe(MatchTier.AncestorOnly);
  });

  it('should ignore case on both sides', () => {
    expect(matchFixture('alpha/DELTA/eChO')?.tier).toBe(MatchTier.LeafAlias);
  });

  it('should let one position absorb several whitespace-joined tokens', () => {
    const positions = [buildPosition('Alpha Bravo'), buildPosition('Charlie')];
    const match = matchPath({ mode: SegmentMatchMode.Substring, positions, tokens: tokenizeQuery('Alpha Bravo/Charlie') });
    expect(match?.positions.map((position) => position?.label ?? null)).toStrictEqual(['Alpha Bravo', 'Charlie']);
  });

  it('should refuse to absorb tokens across a slash into one position', () => {
    const positions = [buildPosition('Alpha Bravo'), buildPosition('Charlie')];
    expect(matchPath({ mode: SegmentMatchMode.Substring, positions, tokens: tokenizeQuery('Alpha/Bravo/Charlie') })).toBeNull();
  });

  it('should require every query token to be consumed', () => {
    expect(matchFixture('Alpha/Bravo/Charlie/Zulu')).toBeNull();
    expect(matchFixture('Zulu')).toBeNull();
  });

  it('should score an exact label above a prefix above a substring', () => {
    const positions = [buildPosition('Charlie')];

    function qualityOf(query: string): LabelMatchQuality | undefined {
      return matchPath({ mode: SegmentMatchMode.Substring, positions, tokens: tokenizeQuery(query) })?.positions[0]?.quality;
    }

    expect(qualityOf('Charlie')).toBe(LabelMatchQuality.Exact);
    expect(qualityOf('Char')).toBe(LabelMatchQuality.Prefix);
    expect(qualityOf('arli')).toBe(LabelMatchQuality.Substring);
  });

  it('should prefer the real name over an alias that matches equally well', () => {
    const positions = [buildPosition('Charlie', 'Charlie note')];
    const match = matchPath({ mode: SegmentMatchMode.Substring, positions, tokens: tokenizeQuery('Charlie') });
    expect(match?.tier).toBe(MatchTier.RealNamesOnly);
    expect(match?.positions[0]?.label).toBe('Charlie');
  });

  it('should report the ranges that were matched, so a row can highlight them', () => {
    const positions = [buildPosition('Charlie')];
    const match = matchPath({ mode: SegmentMatchMode.Substring, positions, tokens: tokenizeQuery('arli') });
    expect(match?.positions[0]?.ranges).toStrictEqual([{ length: 4, startIndex: 2 }]);
  });

  it('should return nothing for an empty query or an empty path', () => {
    expect(matchFixture('')).toBeNull();
    expect(matchPath({ mode: SegmentMatchMode.Substring, positions: [], tokens: tokenizeQuery('Alpha') })).toBeNull();
  });

  describe('segment match mode', () => {
    it('should reject a non-contiguous segment under Substring', () => {
      expect(matchFixture('Brv')).toBeNull();
    });

    it('should accept a non-contiguous segment under Fuzzy', () => {
      const match = matchFixture('Brv', SegmentMatchMode.Fuzzy);
      expect(match?.positions[1]?.quality).toBe(LabelMatchQuality.Subsequence);
    });

    it('should merge adjacent characters of a subsequence into one range', () => {
      const positions = [buildPosition('Charlie')];
      const match = matchPath({ mode: SegmentMatchMode.Fuzzy, positions, tokens: tokenizeQuery('chle') });
      expect(match?.positions[0]?.ranges).toStrictEqual([{ length: 2, startIndex: 0 }, { length: 1, startIndex: 4 }, { length: 1, startIndex: 6 }]);
    });

    it('should still prefer a contiguous match under Fuzzy', () => {
      expect(matchFixture('Bravo', SegmentMatchMode.Fuzzy)?.positions[1]?.quality).toBe(LabelMatchQuality.Exact);
    });

    it('should reject a subsequence whose characters are out of order under Fuzzy', () => {
      expect(matchFixture('ovarb', SegmentMatchMode.Fuzzy)).toBeNull();
    });

    it('should throw on a mode that is not one of its members', () => {
      // Only reachable from settings that were hand-edited in `data.json`, which is exactly why the switch
      // Ends in `assertNever` rather than silently treating the unknown mode as one of the real ones.
      expect(() => matchFixture('Zulu', castTo<SegmentMatchMode>('Nonsense'))).toThrow();
    });
  });

  describe('tier boundaries', () => {
    it('should rank a leaf alias below an ancestor alias with a real-name leaf', () => {
      expect(MatchTier.RealNamesOnly).toBeLessThan(MatchTier.AncestorAlias);
      expect(MatchTier.AncestorAlias).toBeLessThan(MatchTier.LeafAlias);
      expect(MatchTier.LeafAlias).toBeLessThan(MatchTier.AncestorOnly);
    });

    it('should stay in the real-names tier when an alias was available but unused', () => {
      expect(matchFixture('Bravo/Charlie')?.tier).toBe(MatchTier.RealNamesOnly);
    });

    it('should choose the real-name leaf over the alias leaf when both would match', () => {
      const positions = [buildPosition('Alpha'), buildPosition('Charlie', 'Charlie')];
      const match = matchPath({ mode: SegmentMatchMode.Substring, positions, tokens: tokenizeQuery('Alpha/Charlie') });
      expect(match?.tier).toBe(MatchTier.RealNamesOnly);
    });

    it('should fall back to the alias leaf when the real name cannot match', () => {
      expect(matchFixture('Alpha/Bravo/Echo')?.positions[2]?.label).toBe('Echo');
    });
  });

  describe('choosing between two ways of laying the same query over the same path', () => {
    it('should prefer the contiguous laying over the scattered one', () => {
      // `Bravo` fits position 1 as a real name and position 2 as an alias, so the query can be laid down
      // Contiguously (1,2) or scattered (0 skipped, 1, then 2 skipped). The contiguous one must win.
      const positions = [buildPosition('Bravo'), buildPosition('Bravo'), buildPosition('Bravo')];
      const match = matchPath({ mode: SegmentMatchMode.Substring, positions, tokens: tokenizeQuery('Bravo/Bravo') });
      expect(match?.gapCount).toBe(0);
    });

    it('should prefer the earliest laying when the tier and the gaps tie', () => {
      const positions = [buildPosition('Bravo'), buildPosition('Bravo'), buildPosition('Charlie')];
      const match = matchPath({ mode: SegmentMatchMode.Substring, positions, tokens: tokenizeQuery('Bravo') });
      expect(match?.firstMatchedPositionIndex).toBe(0);
    });

    it('should pick the better-quality label when two of them satisfy the same position', () => {
      // Both are aliases, so both ways of laying it end in the same tier and differ only in how well they matched.
      const positions = [buildPosition('Zulu', 'Charlie', 'Charlie the second')];
      const match = matchPath({ mode: SegmentMatchMode.Substring, positions, tokens: tokenizeQuery('Charlie') });
      expect(match?.positions[0]?.label).toBe('Charlie');
      expect(match?.qualityScore).toBe(LabelMatchQuality.Exact);
    });

    it('should take an ancestor alias over the real name when the leaf is an alias hit either way', () => {
      /*
       * Both ways of laying it land in the leaf-alias tier — the tier does not care whether an ANCESTOR used an
       * alias once the LEAF did — with the same gaps and the same first position. Only the summed quality
       * separates them, and the alias `Bravo` matches exactly where the real name `Bravox` only prefixes.
       */
      const positions = [buildPosition('Bravox', 'Bravo'), buildPosition('Zulu', 'Charlie')];
      const match = matchPath({ mode: SegmentMatchMode.Substring, positions, tokens: tokenizeQuery('Bravo/Charlie') });
      expect(match?.tier).toBe(MatchTier.LeafAlias);
      expect(match?.positions[0]?.label).toBe('Bravo');
      expect(match?.qualityScore).toBe(LabelMatchQuality.Exact + LabelMatchQuality.Exact);
    });

    it('should prefer the earliest of two ancestor-only ways of laying it', () => {
      // Neither laying reaches the leaf, so both are ancestor-only with no gaps: only the position differs.
      const positions = [buildPosition('Alpha'), buildPosition('Alpha'), buildPosition('Charlie')];
      const match = matchPath({ mode: SegmentMatchMode.Substring, positions, tokens: tokenizeQuery('Alpha') });
      expect(match?.tier).toBe(MatchTier.AncestorOnly);
      expect(match?.firstMatchedPositionIndex).toBe(0);
    });

    it('should reach the leaf rather than match earlier, because the tier outranks the position', () => {
      // Laying `Bravo/Bravo` over positions 0 and 1 starts earlier, but leaves the leaf unmatched — an
      // Ancestor-only match. Reaching the leaf is worth more than starting early, so (1, 2) wins.
      const positions = [buildPosition('Bravo'), buildPosition('Bravo'), buildPosition('Bravo')];
      const match = matchPath({ mode: SegmentMatchMode.Substring, positions, tokens: tokenizeQuery('Bravo/Bravo') });
      expect(match?.tier).toBe(MatchTier.RealNamesOnly);
      expect(match?.firstMatchedPositionIndex).toBe(1);
    });
  });
});

function buildPosition(name: string, ...aliases: string[]): PathPosition {
  return {
    labels: [
      { isAlias: false, text: name },
      ...aliases.map((alias) => ({ isAlias: true, text: alias }))
    ]
  };
}

function matchFixture(query: string, mode: SegmentMatchMode = SegmentMatchMode.Substring): null | PathMatch {
  return matchPath({ mode, positions: FIXTURE_POSITIONS, tokens: tokenizeQuery(query) });
}
