import type {
  App,
  TAbstractFile
} from 'obsidian';
import type { PluginApiRef } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';

import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';
import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';
import { resolveFolderNoteConfig } from 'obsidian-dev-utils/obsidian/folder-note';
import { watchPluginApi } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';

import type { AdvancedMetadataCacheApi } from './advanced-metadata-cache.ts';

import {
  ADVANCED_METADATA_CACHE_API_VERSION_RANGE,
  ADVANCED_METADATA_CACHE_PLUGIN_ID,
  ADVANCED_METADATA_CACHE_TITLES_API_CONTRACT
} from './advanced-metadata-cache.ts';
import { LabelIndex } from './label-index.ts';

interface LabelIndexComponentConstructorParams {
  readonly app: App;
}

/**
 * Owns the {@link LabelIndex}'s lifecycle: it re-reads the title properties and re-resolves the folder-note setup
 * when the switcher opens, and keeps the index honest while it is loaded by dropping what the vault changed under
 * it.
 *
 * Split from the index itself the way `obsidian-dev-utils` splits `CaseInsensitiveFileIndex` from its
 * component — the index answers questions, the component decides when its answers stopped being true.
 */
export class LabelIndexComponent extends ComponentEx {
  public readonly labelIndex: LabelIndex;

  private advancedMetadataCacheApiRef: null | PluginApiRef<AdvancedMetadataCacheApi> = null;
  private readonly app: App;

  public constructor(params: LabelIndexComponentConstructorParams) {
    super();
    this.app = params.app;
    this.labelIndex = new LabelIndex({
      app: params.app,
      folderNoteConfig: resolveFolderNoteConfig({ app: params.app }),
      titlePropertyNames: []
    });
  }

  public override onload(): void {
    super.onload();

    this.advancedMetadataCacheApiRef = watchPluginApi<AdvancedMetadataCacheApi>({
      apiVersionRange: ADVANCED_METADATA_CACHE_API_VERSION_RANGE,
      app: this.app,
      component: this,
      contract: ADVANCED_METADATA_CACHE_TITLES_API_CONTRACT,
      pluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID
    });

    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      this.labelIndex.invalidate(file.path);
    }));
    this.registerEvent(this.app.vault.on('create', (abstractFile) => {
      this.invalidateAbstractFile(abstractFile);
    }));
    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      this.invalidateAbstractFile(abstractFile);
    }));
    this.registerEvent(this.app.vault.on('rename', (abstractFile, oldPath) => {
      // The old path may name a folder whose whole subtree moved, so the old side is always dropped as a
      // subtree; for a file the prefix scan simply finds nothing.
      this.labelIndex.invalidateSubtree(oldPath);
      this.invalidateAbstractFile(abstractFile);
    }));
  }

  /**
   * Re-reads everything that is settled once per switcher session rather than once per keystroke: the title
   * properties, and the folder-note setup.
   *
   * Both are read LIVE from the plugin that owns them, never copied into this plugin's settings. The title
   * properties belong to Advanced Metadata Cache's `Titles` module, so a user types `title` in one place; and
   * `FolderNoteLocation.Auto` reads the installed `folder-notes` plugin's own settings. Either way, reconfiguring
   * the owner takes effect the next time the switcher opens, with nothing to go stale and no migration to seed.
   *
   * A missing API reads as no title properties. The dependency gate keeps this plugin from loading without one,
   * so that is only ever the moment the provider is unloading, and aliases alone are the honest answer there.
   */
  public refresh(): void {
    this.labelIndex.setTitlePropertyNames(this.advancedMetadataCacheApiRef?.value?.getTitlePropertyNames() ?? []);
    this.labelIndex.setFolderNoteConfig(resolveFolderNoteConfig({ app: this.app }));
  }

  private invalidateAbstractFile(abstractFile: TAbstractFile): void {
    if (isFolder(abstractFile)) {
      this.labelIndex.invalidateSubtree(abstractFile.path);
      return;
    }

    this.labelIndex.invalidate(abstractFile.path);
  }
}
