import type { PluginSettingsComponentBase } from '@mnaoumov/obsidian-lib/components/plugin-settings-component';
import type {
  App as AppOriginal,
  Plugin as PluginOriginal,
  TFile
} from 'obsidian';

import { publishPluginApi } from '@mnaoumov/obsidian-lib/plugin/plugin-api';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { Component } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { LinkText } from '../advanced-metadata-cache-api/api.d.ts';
import type {
  AdvancedMetadataCacheLinkTextsApi,
  AdvancedMetadataCacheTitlesApi
} from '../advanced-metadata-cache.ts';

import {
  ADVANCED_METADATA_CACHE_LINK_TEXTS_API_CONTRACT,
  ADVANCED_METADATA_CACHE_PLUGIN_ID,
  ADVANCED_METADATA_CACHE_TITLES_API_CONTRACT
} from '../advanced-metadata-cache.ts';
import { PluginSettings } from '../settings/plugin-settings.ts';
import { LabelIndexComponent } from './label-index-component.ts';

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

/**
 * What `Advanced Metadata Cache`'s Link texts module currently answers, by target path, and who listens to it.
 */
let linkTextsByPath: Map<string, string[]>;
let linkTextsListeners: ((targetPaths: null | readonly string[]) => void)[];
let providerComponent: Component;
let settings: PluginSettings;

/**
 * What `Advanced Metadata Cache`'s Titles module currently answers. A plain array the tests reassign, standing in
 * for that plugin's own settings.
 */
let titlePropertyNames: string[];

beforeEach(() => {
  appMock = App.createConfigured__({ files: VAULT_FILES });
  app = appMock.asOriginalType__();
  titlePropertyNames = [];
  settings = new PluginSettings();
  linkTextsByPath = new Map();
  linkTextsListeners = [];
  component = new LabelIndexComponent({
    app,
    pluginSettingsComponent: strictProxy<PluginSettingsComponentBase<PluginSettings>>({ settings })
  });
  component.load();
});

describe('LabelIndexComponent', () => {
  it('should build an index that answers from the vault', () => {
    expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo']);
    expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'Delta']);
  });

  it('should forget a file whose metadata changed', () => {
    expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo']);
    writeAliases('Alpha/Bravo/Charlie.md', ['Foxtrot']);
    app.metadataCache.trigger('changed', fixtureFile(), '', {});
    expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Foxtrot']);
  });

  it('should forget a folder whose folder note has just been created', () => {
    // A folder with no folder note answers with its own name alone. The note appearing is exactly the
    // event that makes that answer wrong, and nothing about the FOLDER changed for it to notice.
    expect(labelTextsOfFolder('Alpha/Hotel')).toStrictEqual(['Hotel']);

    const folderNote = appMock.vault.createSync__('Alpha/Hotel/Hotel.md', '---\naliases:\n  - Golf\n---\n');
    app.vault.trigger('create', castTo<TFile>(folderNote.asOriginalType__()));

    expect(labelTextsOfFolder('Alpha/Hotel')).toStrictEqual(['Hotel', 'Golf']);
  });

  it('should forget the whole subtree of a folder that was renamed', () => {
    expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo']);
    writeAliases('Alpha/Bravo/Charlie.md', ['Hotel']);
    app.vault.trigger('rename', fixtureFolder(), 'Alpha/Renamed');
    expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Hotel']);
  });

  it('should forget a deleted folder rather than keep answering for it', () => {
    expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'Delta']);
    writeAliases('Alpha/Bravo/Bravo.md', ['India']);
    app.vault.trigger('delete', fixtureFolder());
    expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'India']);
  });

  it('should stop listening once unloaded', () => {
    expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo']);
    component.unload();
    writeAliases('Alpha/Bravo/Charlie.md', ['Juliett']);
    app.metadataCache.trigger('changed', fixtureFile(), '', {});
    expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo']);
  });

  describe('refresh', () => {
    it('should read no title properties while the plugin that owns them has published nothing', () => {
      appMock.metadataCache.cache__.set('Alpha/Bravo/Charlie.md', { frontmatter: { title: 'Kilo' } });

      component.refresh();

      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie']);
    });

    it('should adopt the title properties the other plugin has since been configured with', () => {
      publishAdvancedMetadataCacheApi();
      appMock.metadataCache.cache__.set('Alpha/Bravo/Charlie.md', { frontmatter: { title: 'Kilo' } });
      component.refresh();
      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie']);

      // Read LIVE on every open rather than copied at load: a user reconfiguring the other plugin is seen by the
      // next switcher, with nothing of it stored in this plugin.
      titlePropertyNames = ['title'];
      component.refresh();

      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Kilo']);
    });

    it('should fall back to aliases alone once the other plugin withdraws its API', () => {
      publishAdvancedMetadataCacheApi();
      titlePropertyNames = ['title'];
      appMock.metadataCache.cache__.set('Alpha/Bravo/Charlie.md', { frontmatter: { title: 'Kilo' } });
      component.refresh();
      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Kilo']);

      providerComponent.unload();
      component.refresh();

      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie']);
    });

    it('should re-resolve the folder-note setup, so reconfiguring the other plugin needs no migration', () => {
      expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'Delta']);
      writeAliases('Alpha/Bravo/Bravo.md', ['Lima']);

      component.refresh();

      expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'Lima']);
    });
  });

  describe('link texts', () => {
    it('should name a file by the texts links to it are written with, after its aliases, without repeats', () => {
      // `Echo` is already an alias, and the provider does not subtract aliases, so the index drops the repeat.
      linkTextsByPath.set('Alpha/Bravo/Charlie.md', ['Mike', 'Echo']);
      publishLinkTextsApi();
      component.refresh();

      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo', 'Mike']);
      expect(component.labelIndex.getFileLabels(ensureNonNullable(fixtureFile())).map((label) => label.source.kind)).toStrictEqual(['RealName', 'Alias', 'LinkText']);
    });

    it('should name a folder by the link texts of its folder note', () => {
      linkTextsByPath.set('Alpha/Bravo/Bravo.md', ['November']);
      publishLinkTextsApi();
      component.refresh();

      expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'Delta', 'November']);
    });

    it('should read none while the setting is off, and pick them up on the next refresh once it is on', () => {
      linkTextsByPath.set('Alpha/Bravo/Charlie.md', ['Mike']);
      settings.shouldMatchLinkTexts = false;
      publishLinkTextsApi();
      component.refresh();
      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo']);

      settings.shouldMatchLinkTexts = true;
      component.refresh();

      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo', 'Mike']);
    });

    it('should read none while the provider\'s module is off', () => {
      publishLinkTextsApi({ isModuleOff: true });
      component.refresh();

      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo']);
    });

    it('should forget exactly the files the provider says changed, folders included', () => {
      publishLinkTextsApi();
      component.refresh();
      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo']);
      expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'Delta']);

      // A link texts change comes from editing ANOTHER note, so no event about these files ever fires.
      linkTextsByPath.set('Alpha/Bravo/Charlie.md', ['Oscar']);
      linkTextsByPath.set('Alpha/Bravo/Bravo.md', ['Papa']);
      notifyLinkTextsChanged(['Alpha/Bravo/Bravo.md']);

      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo']);
      expect(labelTextsOfFolder('Alpha/Bravo')).toStrictEqual(['Bravo', 'Delta', 'Papa']);

      notifyLinkTextsChanged(null);

      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo', 'Oscar']);
    });

    it('should follow the provider across an unload and a reload, keeping one subscription', () => {
      linkTextsByPath.set('Alpha/Bravo/Charlie.md', ['Mike']);
      publishLinkTextsApi();
      component.refresh();
      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo', 'Mike']);

      providerComponent.unload();
      expect(linkTextsListeners).toHaveLength(0);
      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo']);

      publishLinkTextsApi();
      expect(linkTextsListeners).toHaveLength(1);
      expect(fixtureFileLabelTexts()).toStrictEqual(['Charlie', 'Echo', 'Mike']);
    });

    it('should end its subscription once unloaded', () => {
      publishLinkTextsApi();
      expect(linkTextsListeners).toHaveLength(1);

      component.unload();

      expect(linkTextsListeners).toHaveLength(0);
    });
  });
});

interface PublishLinkTextsApiOptions {
  readonly isModuleOff?: boolean;
}

function fixtureFile(): ReturnType<AppOriginal['vault']['getFileByPath']> {
  const path = 'Alpha/Bravo/Charlie.md';
  return ensureNonNullable(app.vault.getFileByPath(path), `Missing fixture file ${path}`);
}

function fixtureFileLabelTexts(): string[] {
  const path = 'Alpha/Bravo/Charlie.md';
  return component.labelIndex.getFileLabels(ensureNonNullable(app.vault.getFileByPath(path), `Missing fixture file ${path}`)).map((label) => label.text);
}

function fixtureFolder(): ReturnType<AppOriginal['vault']['getFolderByPath']> {
  const path = 'Alpha/Bravo';
  return ensureNonNullable(app.vault.getFolderByPath(path), `Missing fixture folder ${path}`);
}

function labelTextsOfFolder(path: string): string[] {
  return component.labelIndex.getFolderLabels(ensureNonNullable(app.vault.getFolderByPath(path), `Missing fixture folder ${path}`)).map((label) => label.text);
}

function notifyLinkTextsChanged(targetPaths: null | readonly string[]): void {
  for (const listener of linkTextsListeners) {
    listener(targetPaths);
  }
}

/**
 * Publishes a stand-in for `Advanced Metadata Cache`'s API, answering from {@link titlePropertyNames} at call time.
 */
function publishAdvancedMetadataCacheApi(): void {
  providerComponent = new Component();
  providerComponent.load();
  publishPluginApi<AdvancedMetadataCacheTitlesApi>({
    api: {
      getTitlePropertyNames: (): string[] => [...titlePropertyNames]
    },
    apiVersion: '1.0.0',
    component: providerComponent,
    contract: ADVANCED_METADATA_CACHE_TITLES_API_CONTRACT,
    plugin: castTo<PluginOriginal>({ manifest: { id: ADVANCED_METADATA_CACHE_PLUGIN_ID } })
  });
}

/**
 * Publishes a stand-in for `Advanced Metadata Cache`'s link-texts API, answering from {@link linkTextsByPath} at
 * call time. Its subscriptions end with the provider, the way a real plugin's listeners go when it unloads.
 */
function publishLinkTextsApi(options: PublishLinkTextsApiOptions = {}): void {
  providerComponent = new Component();
  providerComponent.load();
  providerComponent.register(() => {
    linkTextsListeners.length = 0;
  });
  publishPluginApi<AdvancedMetadataCacheLinkTextsApi>({
    api: {
      getLinkTexts: (pathOrFile): LinkText[] | null => {
        if (options.isModuleOff) {
          return null;
        }

        const path = typeof pathOrFile === 'string' ? pathOrFile : pathOrFile.path;
        return (linkTextsByPath.get(path) ?? []).map((text) => ({ count: 1, sourcePaths: ['Source.md'], text }));
      },
      onLinkTextsChanged: (callback): () => void => {
        linkTextsListeners.push(callback);
        return (): void => {
          const index = linkTextsListeners.indexOf(callback);
          if (index !== -1) {
            linkTextsListeners.splice(index, 1);
          }
        };
      }
    },
    apiVersion: '1.9.0',
    component: providerComponent,
    contract: ADVANCED_METADATA_CACHE_LINK_TEXTS_API_CONTRACT,
    plugin: castTo<PluginOriginal>({ manifest: { id: ADVANCED_METADATA_CACHE_PLUGIN_ID } })
  });
}

/**
 * Writes straight into the mock's cache map rather than through `setCache__`, which fires a `changed` event
 * carrying no file at all — an event shape the real `MetadataCache` never emits. Each test then triggers
 * the event it is actually about, with the arguments Obsidian really passes.
 */
function writeAliases(path: string, aliases: string[]): void {
  appMock.metadataCache.cache__.set(path, { frontmatter: { aliases } });
}
