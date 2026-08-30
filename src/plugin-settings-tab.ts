import type { SettingDefinitionItem } from 'obsidian';

import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import type { PluginSettings } from './plugin-settings.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<PluginSettings> {
  protected override getSettingDefinitionItems(): SettingDefinitionItem[] {
    return [
      this.settingEx({
        desc: 'Paths matching any of these are never offered as results.',
        name: 'Excluded paths',
        render: (setting) => {
          setting.addMultipleText((multipleText) => {
            this.bind({ propertyName: 'excludedPathPatterns', valueComponent: multipleText });
          });
        }
      }),
      this.settingEx({
        desc: 'An extra frontmatter property treated as a label alongside aliases, so a note or a folder note can be reached by a display title that is not an alias. Leave empty to consult only aliases.',
        name: 'Extra label property',
        render: (setting) => {
          setting.addText((text) => {
            this.bind({ propertyName: 'extraLabelPropertyName', valueComponent: text });
          });
        }
      }),
      this.settingEx({
        desc: 'How many recently-opened files rank above the rest when scores are otherwise tied. Zero turns the recency tiebreak off.',
        name: 'Recent files tiebreak',
        render: (setting) => {
          setting.addNumber((number) => {
            this.bind({ propertyName: 'recentFilesBoostCount', valueComponent: number });
          });
        }
      }),
      this.settingEx({
        desc: 'Offer folders as results too, opening the folder note when one is picked. A folder with no folder note is never offered.',
        name: 'Include folders',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({ propertyName: 'shouldIncludeFolders', valueComponent: toggle });
          });
        }
      }),
      this.settingEx({
        desc: 'Offer files that are not markdown notes, the way Obsidian\'s own switcher does when asked.',
        name: 'Include non-markdown files',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({ propertyName: 'shouldIncludeNonMarkdownFiles', valueComponent: toggle });
          });
        }
      })
    ];
  }
}
