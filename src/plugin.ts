import type { PluginDependency } from '@mnaoumov/obsidian-lib/components/plugin-gate-component';

import { OpenBugReportCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-bug-report-command-handler';
import { OpenDemoVaultCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-demo-vault-command-handler';
import { PluginCommandRegistrar } from '@mnaoumov/obsidian-lib/command-registrar';
import { PluginSettingsTabComponent } from '@mnaoumov/obsidian-lib/components/plugin-settings-tab-component';
import { SettingsMigrationComponent } from '@mnaoumov/obsidian-lib/components/settings-migration-component';
import { PluginDataHandler } from '@mnaoumov/obsidian-lib/data-handler';
import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';
import { PluginEventSourceImpl } from '@mnaoumov/obsidian-lib/plugin/plugin-event-source';

import type { MigratableSettings } from './advanced-metadata-cache.ts';

import {
  ADVANCED_METADATA_CACHE_API_VERSION_RANGE,
  ADVANCED_METADATA_CACHE_MIGRATION_API_CONTRACT,
  ADVANCED_METADATA_CACHE_PLUGIN_ID,
  ADVANCED_METADATA_CACHE_PLUGIN_NAME
} from './advanced-metadata-cache.ts';
import { LabelIndexComponent } from './label-index/label-index-component.ts';
import { PropertyLinkSuggestComponent } from './link-suggest/property-link-suggest-component.ts';
import { PluginSettingsComponent } from './settings/plugin-settings-component.ts';
import { PluginSettingsTab } from './settings/plugin-settings-tab.ts';
import { AliasQuickSwitcherComponent } from './switcher/alias-quick-switcher-component.ts';

export class Plugin extends PluginBase {
  /**
   * Declares `Advanced Metadata Cache` as a dependency this plugin cannot run without.
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

    this.addChild(
      new PropertyLinkSuggestComponent({
        app: this.app,
        labelIndexComponent
      })
    );

    await this.commandHandlerComponent.registerCommandHandlers(() => [
      new OpenBugReportCommandHandler({
        app: this.app,
        gitHubRepo: 'mnaoumov/obsidian-alias-quick-switcher',
        pluginId: this.manifest.id
      }),
      new OpenDemoVaultCommandHandler({
        app: this.app,
        pluginId: this.manifest.id,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginVersion: this.manifest.version
      })
    ]);
  }
}
