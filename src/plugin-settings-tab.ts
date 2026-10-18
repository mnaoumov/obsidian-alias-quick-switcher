import type { SettingDefinitionItem } from 'obsidian';

import { appendCodeBlock } from '@mnaoumov/obsidian-lib/html-element';
import { PluginSettingsTabBase } from '@mnaoumov/obsidian-lib/plugin/plugin-settings-tab';
import { noop } from '@mnaoumov/typescript-lib/function';

import type { PluginSettings } from './plugin-settings.ts';

import { RankingMode } from './ranking.ts';
import { SegmentMatchMode } from './segment-matcher.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<PluginSettings> {
  protected override getSettingDefinitionItems(): SettingDefinitionItem[] {
    return [
      this.settingEx({
        desc: createFragment((f) => {
          f.appendText('Paths matching any of these are never offered as results. Every entry matches case-insensitively, in one of three forms:');
          f.createEl('br');
          f.appendText('a plain path, such as ');
          appendCodeBlock(f, 'Archive');
          f.appendText(', which matches that path and everything inside it;');
          f.createEl('br');
          f.appendText('a glob, such as ');
          appendCodeBlock(f, '*.pdf');
          f.appendText(' or ');
          appendCodeBlock(f, 'Archive/**/Draft*');
          f.appendText(' - ');
          appendCodeBlock(f, '*');
          f.appendText(' stays within a folder, ');
          appendCodeBlock(f, '**');
          f.appendText(' crosses folders, a glob with no ');
          appendCodeBlock(f, '/');
          f.appendText(' matches a name at any depth, and a trailing ');
          appendCodeBlock(f, '/');
          f.appendText(' matches folders only;');
          f.createEl('br');
          f.appendText('a regular expression, such as ');
          appendCodeBlock(f, String.raw`/^Daily\/\d{4}/`);
          f.appendText(', whose flags are honoured.');
          f.createEl('br');
          f.appendText('To use ');
          appendCodeBlock(f, '*');
          f.appendText(', ');
          appendCodeBlock(f, '?');
          f.appendText(' or ');
          appendCodeBlock(f, '[');
          f.appendText(' literally in a path, escape it with ');
          appendCodeBlock(f, '\\');
          f.appendText('.');
        }),
        name: 'Excluded paths',
        render: (setting) => {
          setting.addMultipleText((multipleText) => {
            this.bind({ propertyName: 'excludedPathPatterns', valueComponent: multipleText });
          });
        }
      }),
      this.settingEx({
        desc: createFragment((f) => {
          f.appendText('Notes and folder notes can also be reached by a title property, not only by an alias. Which properties count is set once, in the Titles module of ');
          appendCodeBlock(f, 'Advanced Metadata Cache');
          f.appendText(', so every plugin that reads titles agrees. A row reached through one is marked with the property\'s own icon rather than the alias one, and names the property in its tooltip.');
        }),
        name: 'Title properties',
        render: noop
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
          f.appendText(' - how well the query matched decides everything and an alias is just another name, the order ');
          appendCodeBlock(f, 'Link Picker');
          f.appendText(' uses. Surfaces alias hits sooner, and gives up the guarantee above.');
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
