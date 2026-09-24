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

/**
 * The settings this plugin no longer has, as they were last written to `data.json`.
 */
class LegacySettings {
  /**
   * The single extra label property, retired when Advanced Metadata Cache's `Titles` module took the setting over.
   */
  public extraLabelPropertyName = '';
}

export class PluginSettingsComponent extends PluginSettingsComponentBase<PluginSettings> {
  public constructor(params: PluginSettingsComponentConstructorParams) {
    super({
      ...params,
      pluginSettingsClass: PluginSettings
    });
  }

  protected override registerLegacySettingsConverters(): void {
    super.registerLegacySettingsConverters();
    // The retired value is parked rather than dropped: it is the user's own configuration, and dropping it would
    // leave them to discover that a title they relied on stopped matching, and to re-type it in the other plugin.
    this.registerLegacySettingsConverter(LegacySettings, (legacySettings) => {
      if (legacySettings.extraLabelPropertyName) {
        legacySettings.proposedTitlePropertyName = legacySettings.extraLabelPropertyName;
      }
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
    // default pattern — so this validator is the only thing that tells the user their pattern is broken.
    this.registerValidator('excludedPathPatterns', pathsValidator);
  }
}
