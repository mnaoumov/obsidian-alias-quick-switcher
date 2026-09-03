import type {
  App as AppOriginal,
  Command
} from 'obsidian';
import type { CommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import type { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { AliasQuickSwitcherComponent } from './alias-quick-switcher-component.ts';
import { AliasQuickSwitcherModal } from './alias-quick-switcher-modal.ts';
import { LabelIndexComponent } from './label-index-component.ts';
import { PluginSettings } from './plugin-settings.ts';

/**
 * What the strict `App` mock still has no member for; `resolveFolderNoteConfig` reads it to find the
 * installed `folder-notes` plugin.
 */
interface PluginRegistryLike {
  getPlugin: ReturnType<typeof vi.fn>;
}

interface PluginsMock {
  plugins: PluginRegistryLike;
}

let app: AppOriginal;
let commands: Command[];
let labelIndexComponent: LabelIndexComponent;

beforeEach(() => {
  vi.restoreAllMocks();
  const appMock = App.createConfigured__({ files: { 'Alpha/Bravo/Charlie.md': '---\naliases:\n  - Echo\n---\n' } });
  castTo<PluginsMock>(appMock).plugins = { getPlugin: vi.fn().mockReturnValue(null) };
  app = appMock.asOriginalType__();
  commands = [];
  labelIndexComponent = new LabelIndexComponent({
    app,
    pluginSettingsComponent: strictProxy<PluginSettingsComponentBase<PluginSettings>>({ settings: new PluginSettings() })
  });
  labelIndexComponent.load();
});

describe('AliasQuickSwitcherComponent', () => {
  /*
   * The command is the plugin's ONLY entry point, on purpose: the built-in switcher and its hotkey are
   * never patched, so a second registration here would be a takeover by the back door.
   */
  it('should register exactly one command and patch nothing', () => {
    createComponent();
    expect(commands).toHaveLength(1);
    expect(commands[0]?.id).toBe('open');
    expect(commands[0]?.name).toBe('Open quick switcher');
  });

  it('should open the switcher when the command is invoked', () => {
    const openMock = vi.spyOn(AliasQuickSwitcherModal.prototype, 'open').mockReturnValue();
    createComponent();

    commands[0]?.callback?.();

    expect(openMock).toHaveBeenCalledOnce();
  });

  it('should not open anything until the command is invoked', () => {
    const openMock = vi.spyOn(AliasQuickSwitcherModal.prototype, 'open').mockReturnValue();
    createComponent();
    expect(openMock).not.toHaveBeenCalled();
  });

  /*
   * Opening is the one moment the folder-note setup is re-read, so reconfiguring the `folder-notes` plugin
   * takes effect without anything being copied into this plugin's settings.
   */
  it('should refresh the label index before the switcher reads it', () => {
    const refreshMock = vi.spyOn(labelIndexComponent, 'refresh');
    vi.spyOn(AliasQuickSwitcherModal.prototype, 'open').mockReturnValue();
    createComponent();

    commands[0]?.callback?.();

    expect(refreshMock).toHaveBeenCalledOnce();
  });
});

function createComponent(): AliasQuickSwitcherComponent {
  const component = new AliasQuickSwitcherComponent({
    app,
    commandRegistrar: strictProxy<CommandRegistrar>({
      addCommand: (command: Command) => {
        commands.push(command);
      }
    }),
    labelIndexComponent,
    pluginSettingsComponent: strictProxy<PluginSettingsComponentBase<PluginSettings>>({ settings: new PluginSettings() })
  });
  component.load();
  return component;
}
