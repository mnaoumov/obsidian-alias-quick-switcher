import type { App } from 'obsidian';
import type { CommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

interface AliasQuickSwitcherComponentConstructorParams {
  readonly app: App;
  readonly commandRegistrar: CommandRegistrar;
  readonly pluginNoticeComponent: PluginNoticeComponent;
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
  private readonly pluginNoticeComponent: PluginNoticeComponent;

  public constructor(params: AliasQuickSwitcherComponentConstructorParams) {
    super();
    this.app = params.app;
    this.commandRegistrar = params.commandRegistrar;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
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
    const markdownFileCount = this.app.vault.getMarkdownFiles().length;
    this.pluginNoticeComponent.showNotice(`Alias quick switcher: ${String(markdownFileCount)} note(s) indexable`);
  }
}
