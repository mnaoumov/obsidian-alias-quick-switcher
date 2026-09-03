import type {
  App as AppOriginal,
  TFile,
  TFolder
} from 'obsidian';
import type { FolderNoteConfig } from 'obsidian-dev-utils/obsidian/folder-note';

import { FolderNoteLocation } from 'obsidian-dev-utils/obsidian/folder-note';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { Label } from './segment-matcher.ts';

import { LabelIndex } from './label-index.ts';

const VAULT_FILES: Record<string, string> = {
  'Alpha/Bravo/Bravo.md': '---\naliases:\n  - Delta\n---\n',
  'Alpha/Bravo/Charlie.md': '---\naliases:\n  - Echo\ntitle: Foxtrot\n---\n',
  'Alpha/Bravo/Golf.md': 'no frontmatter at all',
  'Alpha/Hotel/India.md': 'a folder with no folder note',
  'Self Aliased.md': '---\naliases:\n  - Self Aliased\n  - SELF ALIASED\n  - Juliett\n---\n'
};

let app: AppOriginal;
let appMock: App;
let labelIndex: LabelIndex;
let resolveNameCallCount: number;

beforeEach(() => {
  appMock = App.createConfigured__({ files: VAULT_FILES });
  app = appMock.asOriginalType__();
  resolveNameCallCount = 0;
  labelIndex = new LabelIndex({ app, extraLabelPropertyName: '', folderNoteConfig: buildCountingConfig() });
});

describe('getFileLabels', () => {
  it('should name a file by its basename first, then its aliases', () => {
    expect(labelsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual([
      { isAlias: false, text: 'Charlie' },
      { isAlias: true, text: 'Echo' }
    ]);
  });

  it('should name a file with no frontmatter by its basename alone', () => {
    expect(labelsOfFile('Alpha/Bravo/Golf.md')).toStrictEqual([{ isAlias: false, text: 'Golf' }]);
  });

  it('should drop an alias that repeats the basename, in any casing', () => {
    expect(labelsOfFile('Self Aliased.md')).toStrictEqual([
      { isAlias: false, text: 'Self Aliased' },
      { isAlias: true, text: 'Juliett' }
    ]);
  });
});

describe('getFolderLabels', () => {
  it('should name a folder by its own name, then the aliases on its folder note', () => {
    expect(labelsOfFolder('Alpha/Bravo')).toStrictEqual([
      { isAlias: false, text: 'Bravo' },
      { isAlias: true, text: 'Delta' }
    ]);
  });

  it('should name a folder with no folder note by its own name alone', () => {
    expect(labelsOfFolder('Alpha/Hotel')).toStrictEqual([{ isAlias: false, text: 'Hotel' }]);
  });

  it('should not create a folder note for a folder that has none', () => {
    labelsOfFolder('Alpha/Hotel');
    expect(app.vault.getFileByPath('Alpha/Hotel/Hotel.md')).toBeNull();
  });
});

describe('the extra label property', () => {
  it('should be ignored while it is empty, even when the property is present', () => {
    expect(labelsOfFile('Alpha/Bravo/Charlie.md').map((label) => label.text)).not.toContain('Foxtrot');
  });

  it('should add the property value as a label once it is named', () => {
    labelIndex.setExtraLabelPropertyName('title');
    expect(labelsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual([
      { isAlias: false, text: 'Charlie' },
      { isAlias: true, text: 'Echo' },
      { isAlias: true, text: 'Foxtrot' }
    ]);
  });

  it('should accept a list of values as well as a single one', () => {
    app.vault.getFileByPath('Alpha/Bravo/Golf.md');
    labelIndex.setExtraLabelPropertyName('nicknames');
    appMock.metadataCache.cache__.set('Alpha/Bravo/Golf.md', { frontmatter: { nicknames: ['Kilo', 'Lima', 7, ''] } });
    expect(labelsOfFile('Alpha/Bravo/Golf.md')).toStrictEqual([
      { isAlias: false, text: 'Golf' },
      { isAlias: true, text: 'Kilo' },
      { isAlias: true, text: 'Lima' }
    ]);
  });

  it('should forget every memoized answer when it changes, and nothing when it does not', () => {
    labelsOfFolder('Alpha/Bravo');
    const callCountAfterFirstAnswer = resolveNameCallCount;

    labelIndex.setExtraLabelPropertyName('');
    labelsOfFolder('Alpha/Bravo');
    expect(resolveNameCallCount).toBe(callCountAfterFirstAnswer);

    labelIndex.setExtraLabelPropertyName('title');
    labelsOfFolder('Alpha/Bravo');
    expect(resolveNameCallCount).toBe(callCountAfterFirstAnswer + 1);
  });
});

/*
 * The measurement this whole class exists for: 18,763 folders in the vault the plugin was designed
 * against, so resolving folder notes per candidate per keystroke would be 18,763 resolutions on every
 * key press. `resolveName` is called exactly once per `resolveFolderNote`, so counting it counts the
 * resolutions — with no mocking of `obsidian-dev-utils`, whose real code is what runs here.
 */
describe('the per-keystroke invariant', () => {
  it('should resolve a folder note once per folder, no matter how often the folder is asked about', () => {
    for (let keystroke = 0; keystroke < 50; keystroke++) {
      labelsOfFolder('Alpha/Bravo');
      labelsOfFolder('Alpha/Hotel');
    }

    expect(resolveNameCallCount).toBe(2);
  });

  it('should resolve again only for the folder whose subtree changed', () => {
    labelsOfFolder('Alpha/Bravo');
    labelsOfFolder('Alpha/Hotel');
    labelIndex.invalidate('Alpha/Bravo/Bravo.md');
    labelsOfFolder('Alpha/Bravo');
    labelsOfFolder('Alpha/Hotel');

    expect(resolveNameCallCount).toBe(3);
  });
});

describe('invalidate', () => {
  it('should forget the file, so a changed alias is picked up', () => {
    expect(labelsOfFile('Alpha/Bravo/Golf.md')).toStrictEqual([{ isAlias: false, text: 'Golf' }]);
    appMock.metadataCache.cache__.set('Alpha/Bravo/Golf.md', { frontmatter: { aliases: ['Mike'] } });
    labelIndex.invalidate('Alpha/Bravo/Golf.md');
    expect(labelsOfFile('Alpha/Bravo/Golf.md')).toStrictEqual([
      { isAlias: false, text: 'Golf' },
      { isAlias: true, text: 'Mike' }
    ]);
  });

  it('should forget the folder the file sits in, since the file may be its folder note', () => {
    labelsOfFolder('Alpha/Bravo');
    labelIndex.invalidate('Alpha/Bravo/Bravo.md');
    labelsOfFolder('Alpha/Bravo');
    expect(resolveNameCallCount).toBe(2);
  });

  it('should forget the sibling folder a note may be the parent-folder-style note of', () => {
    labelsOfFolder('Alpha/Bravo');
    labelIndex.invalidate('Alpha/Bravo.md');
    labelsOfFolder('Alpha/Bravo');
    expect(resolveNameCallCount).toBe(2);
  });

  it('should forget a folder named without any extension', () => {
    labelsOfFolder('Alpha/Bravo');
    labelIndex.invalidate('Alpha/Bravo');
    labelsOfFolder('Alpha/Bravo');
    expect(resolveNameCallCount).toBe(2);
  });
});

describe('invalidateSubtree', () => {
  it('should forget every descendant, so a renamed folder cannot leave stale labels behind', () => {
    labelsOfFile('Alpha/Bravo/Charlie.md');
    labelsOfFolder('Alpha/Bravo');
    labelIndex.invalidateSubtree('Alpha');

    appMock.metadataCache.cache__.set('Alpha/Bravo/Charlie.md', { frontmatter: { aliases: ['November'] } });
    expect(labelsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual([
      { isAlias: false, text: 'Charlie' },
      { isAlias: true, text: 'November' }
    ]);

    labelsOfFolder('Alpha/Bravo');
    expect(resolveNameCallCount).toBe(2);
  });

  it('should leave a sibling whose path merely starts with the same characters alone', () => {
    labelsOfFolder('Alpha/Bravo');
    labelIndex.invalidateSubtree('Alph');
    labelsOfFolder('Alpha/Bravo');
    expect(resolveNameCallCount).toBe(1);
  });
});

describe('the folder-note setup', () => {
  it('should forget every folder answer when a freshly-resolved setup arrives', () => {
    labelsOfFolder('Alpha/Bravo');
    labelIndex.setFolderNoteConfig(buildCountingConfig());
    labelsOfFolder('Alpha/Bravo');
    expect(resolveNameCallCount).toBe(2);
  });

  it('should keep file answers, which the setup cannot change', () => {
    labelsOfFile('Alpha/Bravo/Charlie.md');
    labelIndex.setFolderNoteConfig(buildCountingConfig());
    expect(labelsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual([
      { isAlias: false, text: 'Charlie' },
      { isAlias: true, text: 'Echo' }
    ]);
  });

  it('should answer with no folder note when the setup says the vault has none', () => {
    labelIndex.setFolderNoteConfig({
      extensions: ['md'],
      isHidden: false,
      location: FolderNoteLocation.None,
      resolveName: (targetFolder: TFolder): string => targetFolder.name
    });
    expect(labelsOfFolder('Alpha/Bravo')).toStrictEqual([{ isAlias: false, text: 'Bravo' }]);
  });
});

describe('resolveFolderNote', () => {
  it('should find the folder note with the setup the index already holds', () => {
    expect(labelIndex.resolveFolderNote(folder('Alpha/Bravo'))?.path).toBe('Alpha/Bravo/Bravo.md');
  });

  it('should answer nothing for a folder that has none', () => {
    expect(labelIndex.resolveFolderNote(folder('Alpha/Hotel'))).toBeNull();
  });
});

describe('clear', () => {
  it('should forget both files and folders', () => {
    labelsOfFile('Alpha/Bravo/Charlie.md');
    labelsOfFolder('Alpha/Bravo');
    labelIndex.clear();
    labelsOfFolder('Alpha/Bravo');
    expect(resolveNameCallCount).toBe(2);
  });
});

function buildCountingConfig(): FolderNoteConfig {
  return {
    extensions: ['md'],
    isHidden: false,
    location: FolderNoteLocation.InsideFolder,
    resolveName: (targetFolder: TFolder): string => {
      resolveNameCallCount++;
      return targetFolder.name;
    }
  };
}

function file(path: string): TFile {
  return ensureNonNullable(app.vault.getFileByPath(path), `Missing fixture file ${path}`);
}

function folder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path), `Missing fixture folder ${path}`);
}

function labelsOfFile(path: string): readonly Label[] {
  return labelIndex.getFileLabels(file(path));
}

function labelsOfFolder(path: string): readonly Label[] {
  return labelIndex.getFolderLabels(folder(path));
}
