import type { App as AppOriginal } from 'obsidian';

import { resolveFolderNoteConfig } from '@mnaoumov/obsidian-lib/folder-note';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { LabelIndex } from '../label-index/label-index.ts';
import { createPropertyFilterContext } from './property-filter-context.ts';

const VAULT_FILES: Record<string, string> = {
  'Kyiv City.md': '---\naliases:\n  - Київ\n---\n',
  'Lviv.md': 'plain',
  'Trip.md': '---\nlocation: "[[Kyiv City]]"\nstops:\n  - "[[Lviv]]"\n  - "[[Nowhere]]"\nhome:\n  city: "[[Lviv]]"\nlocations: "[[Lviv]]"\n---\n'
};

let app: AppOriginal;

beforeEach(async () => {
  const { App: AppMock } = await import('obsidian-test-mocks/obsidian');
  app = AppMock.createConfigured__({ files: VAULT_FILES }).asOriginalType__();
});

describe('createPropertyFilterContext', () => {
  it('should read a note\'s frontmatter', () => {
    expect(createContext().getFrontmatter(trip())).toMatchObject({ location: '[[Kyiv City]]' });
  });

  it('should name a link\'s target by its basename and its aliases', () => {
    expect(createContext().getLinkTargetNames(trip(), 'location')).toStrictEqual(['Kyiv City', 'Київ']);
  });

  it('should name the targets of a list\'s links, skipping one that resolves to nothing', () => {
    expect(createContext().getLinkTargetNames(trip(), 'stops')).toStrictEqual(['Lviv']);
  });

  it('should not reach into a nested object, which core Search does not search', () => {
    expect(createContext().getLinkTargetNames(trip(), 'home')).toStrictEqual([]);
  });

  it('should not take a key that merely starts with the asked one', () => {
    expect(createContext().getLinkTargetNames(trip(), 'location')).not.toContain('Lviv');
  });

  it('should name nothing for a note the cache does not know', () => {
    const context = createContext();
    const lviv = ensureNonNullable(app.vault.getFileByPath('Lviv.md'));
    expect(context.getLinkTargetNames(lviv, 'location')).toStrictEqual([]);
  });
});

function createContext(): ReturnType<typeof createPropertyFilterContext> {
  return createPropertyFilterContext(app, new LabelIndex({ app, folderNoteConfig: resolveFolderNoteConfig({ app }), titlePropertyNames: [] }));
}

function trip(): object & ReturnType<AppOriginal['vault']['getFileByPath']> {
  return ensureNonNullable(app.vault.getFileByPath('Trip.md'));
}
