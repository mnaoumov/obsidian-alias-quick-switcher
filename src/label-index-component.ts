import type {
  App,
  TAbstractFile
} from 'obsidian';
import type { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';

import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';
import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';
import { resolveFolderNoteConfig } from 'obsidian-dev-utils/obsidian/folder-note';

import type { PluginSettings } from './plugin-settings.ts';

import { LabelIndex } from './label-index.ts';

interface LabelIndexComponentConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponentBase<PluginSettings>;
}

/**
 * Owns the {@link LabelIndex}'s lifecycle: it re-resolves the folder-note setup when the switcher opens,
 * and keeps the index honest while it is loaded by dropping what the vault changed under it.
 *
 * Split from the index itself the way `obsidian-dev-utils` splits `CaseInsensitiveFileIndex` from its
 * component — the index answers questions, the component decides when its answers stopped being true.
 */
export class LabelIndexComponent extends ComponentEx {
  public readonly labelIndex: LabelIndex;

  private readonly app: App;
  private readonly pluginSettingsComponent: PluginSettingsComponentBase<PluginSettings>;

  public constructor(params: LabelIndexComponentConstructorParams) {
    super();
    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.labelIndex = new LabelIndex({
      app: params.app,
      extraLabelPropertyName: params.pluginSettingsComponent.settings.extraLabelPropertyName,
      folderNoteConfig: resolveFolderNoteConfig({ app: params.app })
    });
  }

  public override onload(): void {
    super.onload();

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
      // Subtree; for a file the prefix scan simply finds nothing.
      this.labelIndex.invalidateSubtree(oldPath);
      this.invalidateAbstractFile(abstractFile);
    }));
  }

  /**
   * Re-reads everything that is settled once per switcher session rather than once per keystroke: the
   * extra-label property, and the folder-note setup.
   *
   * The setup is re-resolved HERE rather than cached at load, because `FolderNoteLocation.Auto` reads the
   * installed `folder-notes` plugin's live settings — so reconfiguring that plugin takes effect the next
   * time the switcher opens, with nothing copied into this plugin's own settings and no migration to seed.
   */
  public refresh(): void {
    this.labelIndex.setExtraLabelPropertyName(this.pluginSettingsComponent.settings.extraLabelPropertyName);
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
