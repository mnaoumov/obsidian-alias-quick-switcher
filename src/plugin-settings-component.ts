import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import type { PluginEventSource } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';
import { pathsValidator } from 'obsidian-dev-utils/obsidian/path-settings';

import { PluginSettings } from './plugin-settings.ts';

interface PluginSettingsComponentConstructorParams {
  readonly dataHandler: DataHandler;
  readonly pluginEventSource: PluginEventSource;
}

export class PluginSettingsComponent extends PluginSettingsComponentBase<PluginSettings> {
  public constructor(params: PluginSettingsComponentConstructorParams) {
    super({
      ...params,
      pluginSettingsClass: PluginSettings
    });
  }

  protected override registerValidators(): void {
    super.registerValidators();
    this.registerValidator('recentFilesBoostCount', (value): MaybeReturn<string> => {
      if (value < 0) {
        return 'The recency tiebreak cannot be negative';
      }
    });
    // An entry that is not a valid pattern does not throw when assigned — the whole list silently falls back to its
    // Default pattern — so this validator is the only thing that tells the user their pattern is broken.
    this.registerValidator('excludedPathPatterns', pathsValidator);
  }
}
