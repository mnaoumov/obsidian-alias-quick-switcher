import type { PluginSettingsComponentBase } from '@mnaoumov/obsidian-lib/components/plugin-settings-component';
import type { PluginApiRef } from '@mnaoumov/obsidian-lib/plugin/plugin-api';
import type {
  App,
  TAbstractFile
} from 'obsidian';

import { registerAsyncEvent } from '@mnaoumov/obsidian-lib/components/async-events-component';
import { ComponentEx } from '@mnaoumov/obsidian-lib/components/component-ex';
import { isFolder } from '@mnaoumov/obsidian-lib/file-system';
import { resolveFolderNoteConfig } from '@mnaoumov/obsidian-lib/folder-note';
import { watchPluginApi } from '@mnaoumov/obsidian-lib/plugin/plugin-api';

import type {
  AdvancedMetadataCacheLinkTextsApi,
  AdvancedMetadataCacheTitlesApi
} from '../advanced-metadata-cache.ts';
import type { PluginSettings } from '../settings/plugin-settings.ts';
import type { LinkTextsReader } from './label-index.ts';

import {
  ADVANCED_METADATA_CACHE_API_VERSION_RANGE,
  ADVANCED_METADATA_CACHE_LINK_TEXTS_API_CONTRACT,
  ADVANCED_METADATA_CACHE_PLUGIN_ID,
  ADVANCED_METADATA_CACHE_TITLES_API_CONTRACT
} from '../advanced-metadata-cache.ts';
import { LabelIndex } from './label-index.ts';

interface LabelIndexComponentConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponentBase<PluginSettings>;
}

/**
 * Owns the {@link LabelIndex}'s lifecycle: it re-reads the title properties and re-resolves the folder-note setup
 * when the switcher opens, and keeps the index honest while it is loaded by dropping what the vault changed under
 * it.
 *
 * Split from the index itself the way `@mnaoumov/obsidian-lib` splits `CaseInsensitiveFileIndex` from its
 * component — the index answers questions, the component decides when its answers stopped being true.
 */
export class LabelIndexComponent extends ComponentEx {
  public readonly labelIndex: LabelIndex;

  private advancedMetadataCacheApiRef: null | PluginApiRef<AdvancedMetadataCacheTitlesApi> = null;
  private readonly app: App;
  private linkTextsApiRef: null | PluginApiRef<AdvancedMetadataCacheLinkTextsApi> = null;

  /**
   * The reader over the link-texts API currently published, built once per API rather than once per refresh, so
   * the index can tell by identity that nothing changed.
   */
  private linkTextsReader: LinkTextsReader | null = null;

  private readonly pluginSettingsComponent: PluginSettingsComponentBase<PluginSettings>;
  private unsubscribeFromLinkTexts: (() => void) | null = null;

  public constructor(params: LabelIndexComponentConstructorParams) {
    super();
    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.labelIndex = new LabelIndex({
      app: params.app,
      folderNoteConfig: resolveFolderNoteConfig({ app: params.app }),
      titlePropertyNames: []
    });
  }

  public override onload(): void {
    super.onload();

    this.advancedMetadataCacheApiRef = watchPluginApi<AdvancedMetadataCacheTitlesApi>({
      apiVersionRange: ADVANCED_METADATA_CACHE_API_VERSION_RANGE,
      app: this.app,
      component: this,
      contract: ADVANCED_METADATA_CACHE_TITLES_API_CONTRACT,
      pluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID
    });

    // A ref of its own, so a provider older than contract `1.9.0` leaves only this one `null` and the titles still work.
    const linkTextsApiRef = watchPluginApi<AdvancedMetadataCacheLinkTextsApi>({
      apiVersionRange: ADVANCED_METADATA_CACHE_API_VERSION_RANGE,
      app: this.app,
      component: this,
      contract: ADVANCED_METADATA_CACHE_LINK_TEXTS_API_CONTRACT,
      pluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID
    });
    this.linkTextsApiRef = linkTextsApiRef;
    this.subscribeToLinkTexts();
    registerAsyncEvent(
      this,
      linkTextsApiRef.on('change', () => {
        this.subscribeToLinkTexts();
      })
    );
    this.register(() => {
      this.unsubscribeFromLinkTexts?.();
      this.unsubscribeFromLinkTexts = null;
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
   * properties, the folder-note setup, and whether link texts are matched.
   *
   * The first two are read LIVE from the plugin that owns them, never copied into this plugin's settings. The title
   * properties belong to `Advanced Metadata Cache`'s `Titles` module, so a user types `title` in one place; and
   * `FolderNoteLocation.Auto` reads the installed `folder-notes` plugin's own settings. Either way, reconfiguring
   * the owner takes effect the next time the switcher opens, with nothing to go stale and no migration to seed.
   *
   * A missing API reads as no title properties. The dependency gate keeps this plugin from loading without one,
   * so that is only ever the moment the provider is unloading, and aliases alone are the honest answer there.
   */
  public refresh(): void {
    this.labelIndex.setTitlePropertyNames(this.advancedMetadataCacheApiRef?.value?.getTitlePropertyNames() ?? []);
    this.labelIndex.setFolderNoteConfig(resolveFolderNoteConfig({ app: this.app }));
    this.applyLinkTextsReader();
  }

  private applyLinkTextsReader(): void {
    this.labelIndex.setLinkTextsReader(this.pluginSettingsComponent.settings.shouldMatchLinkTexts ? this.linkTextsReader : null);
  }

  private invalidateAbstractFile(abstractFile: TAbstractFile): void {
    if (isFolder(abstractFile)) {
      this.labelIndex.invalidateSubtree(abstractFile.path);
      return;
    }

    this.labelIndex.invalidate(abstractFile.path);
  }

  /**
   * Follows the link-texts API across the provider's load, unload and re-enable: drops the subscription to the API
   * that went away, and subscribes to the one that came.
   *
   * The subscription is what keeps a memoized answer true. A file's link texts change when ANOTHER note is edited,
   * so the `changed` event of the edited note says nothing about the file whose answer moved; the provider names
   * that file, and `invalidate` also drops the folder it is the folder note of.
   */
  private subscribeToLinkTexts(): void {
    this.unsubscribeFromLinkTexts?.();
    this.unsubscribeFromLinkTexts = null;

    const api = this.linkTextsApiRef?.value ?? null;
    this.linkTextsReader = api ? (file): null | string[] => api.getLinkTexts(file)?.map((linkText) => linkText.text) ?? null : null;

    if (api) {
      this.unsubscribeFromLinkTexts = api.onLinkTextsChanged((targetPaths) => {
        if (!targetPaths) {
          this.labelIndex.clear();
          return;
        }

        for (const targetPath of targetPaths) {
          this.labelIndex.invalidate(targetPath);
        }
      });
    }

    this.applyLinkTextsReader();
  }
}
