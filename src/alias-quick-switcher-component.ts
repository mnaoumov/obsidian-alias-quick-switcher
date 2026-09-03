import type { App } from 'obsidian';
import type { CommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import type { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';

import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

import type { LabelIndexComponent } from './label-index-component.ts';
import type { PluginSettings } from './plugin-settings.ts';

import { AliasQuickSwitcherModal } from './alias-quick-switcher-modal.ts';

interface AliasQuickSwitcherComponentConstructorParams {
  readonly app: App;
  readonly commandRegistrar: CommandRegistrar;
  readonly labelIndexComponent: LabelIndexComponent;
  readonly pluginSettingsComponent: PluginSettingsComponentBase<PluginSettings>;
}

/**
 * Owns the plugin's entry point.
 *
 * There is exactly one, and it is deliberately a plain command rather than a takeover of Obsidian's own
 * quick switcher: the built-in and its hotkey are never patched, so the user decides which switcher
 * their muscle memory opens by assigning the hotkey themselves.
 */
export class AliasQuickSwitcherComponent extends ComponentEx {
  private readonly app: App;
  private readonly commandRegistrar: CommandRegistrar;
  private readonly labelIndexComponent: LabelIndexComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponentBase<PluginSettings>;

  public constructor(params: AliasQuickSwitcherComponentConstructorParams) {
    super();
    this.app = params.app;
    this.commandRegistrar = params.commandRegistrar;
    this.labelIndexComponent = params.labelIndexComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public override onload(): void {
    super.onload();

    this.commandRegistrar.addCommand({
      callback: this.openSwitcher.bind(this),
      id: 'open',
      name: 'Open quick switcher'
    });
  }

  private openSwitcher(): void {
    // Once per switcher session, never per keystroke: this is where the folder-note setup is re-read from
    // The installed `folder-notes` plugin, so reconfiguring it takes effect here with nothing copied into
    // This plugin's own settings.
    this.labelIndexComponent.refresh();

    new AliasQuickSwitcherModal({
      app: this.app,
      labelIndex: this.labelIndexComponent.labelIndex,
      settings: this.pluginSettingsComponent.settings
    }).open();
  }
}
