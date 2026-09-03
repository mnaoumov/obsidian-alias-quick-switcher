import type { SettingDefinitionItem } from 'obsidian';

import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import type { PluginSettings } from './plugin-settings.ts';

import { RankingMode } from './ranking.ts';
import { SegmentMatchMode } from './segment-matcher.ts';

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
        desc: createFragment((f) => {
          f.appendText('How one segment of your query is tested against one name.');
          f.createEl('br');
          appendCodeBlock(f, 'Substring');
          f.appendText(' - the typed text must appear inside the name as one unbroken run.');
          f.createEl('br');
          appendCodeBlock(f, 'Fuzzy');
          f.appendText(' - the typed characters must appear inside the name in order, the way Obsidian\'s own search works. Finds more, including things you did not mean.');
        }),
        name: 'Segment matching',
        render: (setting) => {
          setting.addDropdown((dropdown) => {
            dropdown.addOptions({
              /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
              [SegmentMatchMode.Substring]: 'Substring',
              [SegmentMatchMode.Fuzzy]: 'Fuzzy'
              /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
            });
            this.bind({ propertyName: 'segmentMatchMode', valueComponent: dropdown });
          });
        }
      }),
      this.settingEx({
        desc: createFragment((f) => {
          f.appendText('Which order results are shown in.');
          f.createEl('br');
          appendCodeBlock(f, 'Tiered');
          f.appendText(' - real names before aliases, so this switcher never reshuffles the results Obsidian\'s own already gives you.');
          f.createEl('br');
          appendCodeBlock(f, 'Link picker');
          f.appendText(' - how well the query matched decides everything and an alias is just another name, the order Link Picker uses. Surfaces alias hits sooner, and gives up the guarantee above.');
        }),
        name: 'Ranking',
        render: (setting) => {
          setting.addDropdown((dropdown) => {
            dropdown.addOptions({
              /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
              [RankingMode.Tiered]: 'Tiered',
              [RankingMode.LinkPicker]: 'Link picker'
              /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
            });
            this.bind({ propertyName: 'rankingMode', valueComponent: dropdown });
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
