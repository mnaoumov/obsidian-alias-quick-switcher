import type {
  FrontMatterCache,
  TFile
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PropertyFilterContext } from './property-filter.ts';

import {
  checkPropertyQuery,
  collectPropertyValues
} from './property-filter.ts';
import { parsePropertyQuery } from './property-query-parser.ts';

/**
 * The fixture of the measurement against a real Obsidian 1.14's core Search, one note per shape.
 */
const FRONTMATTER: Record<string, FrontMatterCache> = {
  'A.md': { isoCode: 'uk' },
  'B.md': { isoCode: 'UKR' },
  'C.md': { 'birth place': 'Kyiv' },
  'D.md': { city: 'San Miguel de Allende' },
  'E.md': { langs: ['en', 'uk'] },
  'F.md': { location: '[[Kyiv City]]' },
  'G.md': { address: { city: 'Lviv' } },
  'H.md': { empty: null },
  'I.md': { quote: 'say "hi" now' },
  'J.md': { status: 'Draft' },
  'K.md': { status: 'Published' },
  'L.md': { 'key]x': 'val' },
  'M.md': { flag: true, size: 42 },
  'N.md': { isoCode: 'u k' }
};

/**
 * `F.md` links to `Kyiv City`, whose names include the alias `Київ`.
 */
const LINK_TARGET_NAMES: Record<string, Record<string, string[]>> = {
  'F.md': { location: ['Kyiv City', 'Київ'] }
};

const context: PropertyFilterContext = {
  getFrontmatter: (file) => FRONTMATTER[file.path],
  getLinkTargetNames: (file, key) => LINK_TARGET_NAMES[file.path]?.[key] ?? []
};

const FILES = Object.keys(FRONTMATTER).map((path) => castTo<TFile>({ path }));

describe('checkPropertyQuery, matched against what core Search returned for the same query', () => {
  it.each([
    ['[isoCode:uk]', ['A.md', 'B.md']],
    ['[isoCode:"uk"]', ['A.md']],
    ['[isocode:UK]', ['A.md', 'B.md']],
    ['[isoCode]', ['A.md', 'B.md', 'N.md']],
    ['[iso:uk]', ['A.md', 'B.md']],
    ['["isoCode":uk]', ['A.md', 'B.md']],
    ['["iso":uk]', []],
    ['[isoCode:u k]', ['A.md', 'B.md', 'N.md']],
    ['[isoCode:"u k"]', ['N.md']],
    ['["birth place":Kyiv]', ['C.md']],
    ['[birth place:Kyiv]', ['C.md']],
    ['[city:"San Miguel de Allende"]', ['D.md']],
    ['[city:San Miguel]', ['D.md']],
    ['[city:Allende San]', ['D.md']],
    ['[city:"Miguel"]', ['D.md']],
    ['[city:"Migu"]', []],
    ['[city:"san miguel"]', ['D.md']],
    ['[langs:uk]', ['E.md']],
    ['[langs:"uk"]', ['E.md']],
    ['[langs:"e"]', []],
    ['[location:Kyiv]', ['F.md']],
    ['[location:"[[Kyiv City]]"]', ['F.md']],
    ['[address.city:Lviv]', []],
    ['[address:Lviv]', []],
    ['[city:Lviv]', []],
    ['[empty:null]', ['H.md']],
    ['[empty]', ['H.md']],
    [String.raw`[quote:"say \"hi\" now"]`, ['I.md']],
    ['[quote:"hi"]', ['I.md']],
    ['[status:Draft OR Published]', ['J.md', 'K.md']],
    ['[status:(Draft OR Published)]', ['J.md', 'K.md']],
    ['[status:Draft] OR [isoCode:uk]', ['A.md', 'B.md', 'J.md']],
    ['[isoCode:uk] [status:Draft]', []],
    ['["key]x":val]', ['L.md']],
    ['[size:42]', ['M.md']],
    ['[size:4]', ['M.md']],
    ['[size:"4"]', []],
    ['[flag:true]', ['M.md']],
    ['[isoCode:/^uk$/]', ['A.md']],
    ['[/iso/:uk]', ['A.md', 'B.md']],
    ['[isoCode:uk', ['A.md', 'B.md']]
  ])('%s', (query, expected) => {
    expect(matchingPaths(query)).toStrictEqual(expected);
  });

  it('should not carry a global regex\'s position from one note to the next', () => {
    expect(matchingPaths('[isoCode:/uk/g]')).toStrictEqual(['A.md', 'B.md']);
  });

  it('should not count an empty property as null when a non-empty one also matches the key', () => {
    expect(checkPropertyQuery({
      context: { getFrontmatter: () => ({ emptyA: 'x', emptyB: null }), getLinkTargetNames: () => [] },
      file: castTo<TFile>({ path: 'X.md' }),
      query: parsePropertyQuery('[empty:null]')
    })).toBe(true);
  });

  it('should match nothing in a note with no frontmatter', () => {
    expect(checkPropertyQuery({
      context: { getFrontmatter: () => undefined, getLinkTargetNames: () => [] },
      file: castTo<TFile>({ path: 'X.md' }),
      query: parsePropertyQuery('[isoCode]')
    })).toBe(false);
  });

  /*
   * The one deliberate difference from core Search, which matches the raw link text only and finds nothing
   * for `[location:Київ]`.
   */
  it('should match a link value by the names of the note it points to', () => {
    expect(matchingPaths('[location:Київ]')).toStrictEqual(['F.md']);
  });
});

describe('collectPropertyValues', () => {
  it('should collect the values of every matching key, most common first', () => {
    expect(collectPropertyValues({ context, files: FILES, keyPattern: parsePropertyQuery('[iso]').groups[0]?.[0]?.key ?? expect.unreachable() }))
      .toStrictEqual([
        { count: 1, value: 'u k' },
        { count: 1, value: 'uk' },
        { count: 1, value: 'UKR' }
      ]);
  });

  it('should count a value once per note, and spell it as first met', () => {
    const counted = collectPropertyValues({
      context: {
        getFrontmatter: (file) => ({ 'Q.md': { langs: ['uk', 'UK'] }, 'R.md': { langs: 'Uk' }, 'S.md': { langs: 'en' } })[file.path],
        getLinkTargetNames: () => []
      },
      files: ['Q.md', 'R.md', 'S.md'].map((path) => castTo<TFile>({ path })),
      keyPattern: parsePropertyQuery('[langs]').groups[0]?.[0]?.key ?? expect.unreachable()
    });
    expect(counted).toStrictEqual([{ count: 2, value: 'uk' }, { count: 1, value: 'en' }]);
  });

  it('should collect nothing from a note with no frontmatter', () => {
    expect(collectPropertyValues({
      context: { getFrontmatter: () => undefined, getLinkTargetNames: () => [] },
      files: [castTo<TFile>({ path: 'X.md' })],
      keyPattern: parsePropertyQuery('[langs]').groups[0]?.[0]?.key ?? expect.unreachable()
    })).toStrictEqual([]);
  });
});

function matchingPaths(query: string): string[] {
  const parsed = parsePropertyQuery(query);
  return FILES.filter((file) => checkPropertyQuery({ context, file, query: parsed })).map((file) => file.path);
}
