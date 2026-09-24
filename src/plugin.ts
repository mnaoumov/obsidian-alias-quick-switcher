import type { PluginDependency } from 'obsidian-dev-utils/obsidian/components/plugin-gate-component';

import { OpenDemoVaultCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/open-demo-vault-command-handler';
import { PluginCommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import { SettingsMigrationComponent } from 'obsidian-dev-utils/obsidian/components/settings-migration-component';
import { PluginDataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import { PluginBase } from 'obsidian-dev-utils/obsidian/plugin/plugin';
import { PluginEventSourceImpl } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';

import type { MigratableSettings } from './advanced-metadata-cache.ts';

import {
  ADVANCED_METADATA_CACHE_API_VERSION_RANGE,
  ADVANCED_METADATA_CACHE_MIGRATION_API_CONTRACT,
  ADVANCED_METADATA_CACHE_PLUGIN_ID,
  ADVANCED_METADATA_CACHE_PLUGIN_NAME
} from './advanced-metadata-cache.ts';
import { AliasQuickSwitcherComponent } from './alias-quick-switcher-component.ts';
import { LabelIndexComponent } from './label-index-component.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';

export class Plugin extends PluginBase {
  /**
   * Declares Advanced Metadata Cache as a dependency this plugin cannot run without.
   *
   * Not for the title property, which alone would never justify a second install: this plugin's whole
   * performance story is a lookup index, and that plugin exists to keep the vault's metadata lookups indexed. It
   * also owns the title properties now, so a user types `title` in one place. Declared, this plugin does nothing
   * while it is missing, says why, and installs it in one click.
   *
   * @returns The dependency.
   */
  protected override getPluginDependencies(): PluginDependency[] {
    return [
      {
        apiVersionRange: ADVANCED_METADATA_CACHE_API_VERSION_RANGE,
        pluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID,
        pluginName: ADVANCED_METADATA_CACHE_PLUGIN_NAME,
        reason: `${ADVANCED_METADATA_CACHE_PLUGIN_NAME} owns the title properties this switcher matches alongside aliases.`
      }
    ];
  }

  protected override async onloadImpl(): Promise<void> {
    const pluginSettingsComponent = this.addChild(
      new PluginSettingsComponent({
        dataHandler: new PluginDataHandler(this),
        pluginEventSource: new PluginEventSourceImpl(this)
      })
    );
    this.pluginSettingsComponent = pluginSettingsComponent;
    this.addChild(
      new PluginSettingsTabComponent({
        plugin: this,
        pluginSettingsTab: new PluginSettingsTab({
          plugin: this,
          pluginSettingsComponent
        })
      })
    );

    this.addChild(
      new SettingsMigrationComponent<MigratableSettings>({
        apiVersionRange: ADVANCED_METADATA_CACHE_API_VERSION_RANGE,
        app: this.app,
        // Names only what migrating needs. The provider's first contract does not publish it, so against that
        // provider this component stays silent and the value waits, rather than the plugin refusing to run.
        contract: ADVANCED_METADATA_CACHE_MIGRATION_API_CONTRACT,
        getProposedSettings: (): MigratableSettings | null => {
          const proposedTitlePropertyName = pluginSettingsComponent.settings.proposedTitlePropertyName;
          return proposedTitlePropertyName ? { titlePropertyNames: [proposedTitlePropertyName] } : null;
        },
        pluginSettingsComponent,
        providerPluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID,
        retireProposedSettings: async (): Promise<void> => {
          await pluginSettingsComponent.editAndSave((settings) => {
            settings.proposedTitlePropertyName = null;
          });
        },
        sourcePluginId: this.manifest.id
      })
    );

    const labelIndexComponent = this.addChild(
      new LabelIndexComponent({
        app: this.app
      })
    );

    this.addChild(
      new AliasQuickSwitcherComponent({
        app: this.app,
        commandRegistrar: new PluginCommandRegistrar(this),
        labelIndexComponent,
        pluginSettingsComponent
      })
    );

    await this.commandHandlerComponent.registerCommandHandlers(() => [
      new OpenDemoVaultCommandHandler({
        app: this.app,
        pluginId: this.manifest.id,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginVersion: this.manifest.version
      })
    ]);
  }
}
