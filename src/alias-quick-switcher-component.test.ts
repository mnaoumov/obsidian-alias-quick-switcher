import type { Command } from 'obsidian';
import type { CommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

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

describe('AliasQuickSwitcherComponent', () => {
  let app: App;
  let commands: Command[];
  let showNoticeMock: PluginNoticeComponent['showNotice'];

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    commands = [];
    showNoticeMock = vi.fn<PluginNoticeComponent['showNotice']>();
  });

  function createComponent(): AliasQuickSwitcherComponent {
    const component = new AliasQuickSwitcherComponent({
      app: app.asOriginalType__(),
      commandRegistrar: strictProxy<CommandRegistrar>({
        addCommand: (command: Command) => {
          commands.push(command);
        }
      }),
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: showNoticeMock })
    });
    component.load();
    return component;
  }

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

  it('should report how many notes are indexable when invoked', () => {
    // `createSync__` rather than `TFile.create__`: the latter builds a `TFile` without registering it
    // In the vault's index, so `getMarkdownFiles()` would still answer with an empty vault.
    app.vault.createSync__('Alpha/Bravo/Charlie.md', '');
    app.vault.createSync__('Zulu.md', '');
    createComponent();

    commands[0]?.callback?.();
    expect(showNoticeMock).toHaveBeenCalledWith('Alias quick switcher: 2 note(s) indexable');
  });

  it('should not report anything until the command is invoked', () => {
    createComponent();
    expect(showNoticeMock).not.toHaveBeenCalled();
  });
});
