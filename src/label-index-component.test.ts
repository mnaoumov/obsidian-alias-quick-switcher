import type {
  App as AppOriginal,
  TFile
} from 'obsidian';
import type { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { LabelIndexComponent } from './label-index-component.ts';
import { PluginSettings } from './plugin-settings.ts';

const VAULT_FILES: Record<string, string> = {
  'Alpha/Bravo/Bravo.md': '---\naliases:\n  - Delta\n---\n',
  'Alpha/Bravo/Charlie.md': '---\naliases:\n  - Echo\n---\n',
  'Alpha/Hotel/India.md': 'a folder that starts out with no folder note'
};

/**
 * What the strict `App` mock still has no member for. `resolveFolderNoteConfig` reaches for `plugins` to
 * read the installed `folder-notes` plugin's live settings, and answering `null` is what makes it fall back
 * to the default `Folder/Folder.md` layout this fixture is written in.
 */
let app: AppOriginal;
let appMock: App;
let component: LabelIndexComponent;
let settings: PluginSettings;

beforeEach(() => {
  appMock = App.createConfigured__({ files: VAULT_FILES });
  app = appMock.asOriginalType__();
  settings = new PluginSettings();
  component = new LabelIndexComponent({
    app,
    pluginSettingsComponent: strictProxy<PluginSettingsComponentBase<PluginSettings>>({ settings })
  });
  component.load();
});

describe('LabelIndexComponent', () => {
  it('should build an index that answers from the vault', () => {
    expect(labelTextsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual(['Charlie', 'Echo']);
    expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'Delta']);
  });

  it('should forget a file whose metadata changed', () => {
    expect(labelTextsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual(['Charlie', 'Echo']);
    writeAliases('Alpha/Bravo/Charlie.md', ['Foxtrot']);
    app.metadataCache.trigger('changed', fileAt('Alpha/Bravo/Charlie.md'), '', {});
    expect(labelTextsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual(['Charlie', 'Foxtrot']);
  });

  it('should forget a folder whose folder note has just been created', () => {
    // A folder with no folder note answers with its own name alone. The note appearing is exactly the
    // Event that makes that answer wrong, and nothing about the FOLDER changed for it to notice.
    expect(labelTextsOfFolder('Alpha/Hotel')).toStrictEqual(['Hotel']);

    const folderNote = appMock.vault.createSync__('Alpha/Hotel/Hotel.md', '---\naliases:\n  - Golf\n---\n');
    app.vault.trigger('create', castTo<TFile>(folderNote.asOriginalType__()));

    expect(labelTextsOfFolder('Alpha/Hotel')).toStrictEqual(['Hotel', 'Golf']);
  });

  it('should forget the whole subtree of a folder that was renamed', () => {
    expect(labelTextsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual(['Charlie', 'Echo']);
    writeAliases('Alpha/Bravo/Charlie.md', ['Hotel']);
    app.vault.trigger('rename', folderAt('Alpha/Bravo'), 'Alpha/Renamed');
    expect(labelTextsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual(['Charlie', 'Hotel']);
  });

  it('should forget a deleted folder rather than keep answering for it', () => {
    expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'Delta']);
    writeAliases('Alpha/Bravo/Bravo.md', ['India']);
    app.vault.trigger('delete', folderAt('Alpha/Bravo'));
    expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'India']);
  });

  it('should stop listening once unloaded', () => {
    expect(labelTextsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual(['Charlie', 'Echo']);
    component.unload();
    writeAliases('Alpha/Bravo/Charlie.md', ['Juliett']);
    app.metadataCache.trigger('changed', fileAt('Alpha/Bravo/Charlie.md'), '', {});
    expect(labelTextsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual(['Charlie', 'Echo']);
  });

  describe('refresh', () => {
    it('should adopt an extra label property the user has since named', () => {
      appMock.metadataCache.cache__.set('Alpha/Bravo/Charlie.md', { frontmatter: { title: 'Kilo' } });
      expect(labelTextsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual(['Charlie']);

      settings.extraLabelPropertyName = 'title';
      component.refresh();

      expect(labelTextsOfFile('Alpha/Bravo/Charlie.md')).toStrictEqual(['Charlie', 'Kilo']);
    });

    it('should re-resolve the folder-note setup, so reconfiguring the other plugin needs no migration', () => {
      expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'Delta']);
      writeAliases('Alpha/Bravo/Bravo.md', ['Lima']);

      component.refresh();

      expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'Lima']);
    });
  });
});

function fileAt(path: string): ReturnType<AppOriginal['vault']['getFileByPath']> {
  return ensureNonNullable(app.vault.getFileByPath(path), `Missing fixture file ${path}`);
}

function folderAt(path: string): ReturnType<AppOriginal['vault']['getFolderByPath']> {
  return ensureNonNullable(app.vault.getFolderByPath(path), `Missing fixture folder ${path}`);
}

function labelTextsOfFile(path: string): string[] {
  return component.labelIndex.getFileLabels(ensureNonNullable(app.vault.getFileByPath(path), `Missing fixture file ${path}`)).map((label) => label.text);
}

function labelTextsOfFolder(path: string): string[] {
  return component.labelIndex.getFolderLabels(ensureNonNullable(app.vault.getFolderByPath(path), `Missing fixture folder ${path}`)).map((label) => label.text);
}

/**
 * Writes straight into the mock's cache map rather than through `setCache__`, which fires a `changed` event
 * carrying no file at all — an event shape the real `MetadataCache` never emits. Each test then triggers
 * the event it is actually about, with the arguments Obsidian really passes.
 */
function writeAliases(path: string, aliases: string[]): void {
  appMock.metadataCache.cache__.set(path, { frontmatter: { aliases } });
}
