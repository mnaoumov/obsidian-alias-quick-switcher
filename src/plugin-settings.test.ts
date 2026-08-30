import {
  describe,
  expect,
  it
} from 'vitest';

import { PluginSettings } from './plugin-settings.ts';

describe('PluginSettings', () => {
  /*
   * Folders being offered is the plugin's whole reason for consulting folder-note aliases, so its default
   * is asserted here rather than left to the settings tab.
   */
  it('should offer folders by default', () => {
    const settings = new PluginSettings();
    expect(settings.shouldIncludeFolders).toBe(true);
  });

  it('should match only markdown files by default', () => {
    const settings = new PluginSettings();
    expect(settings.shouldIncludeNonMarkdownFiles).toBe(false);
  });

  it('should consult only aliases until an extra label property is named', () => {
    const settings = new PluginSettings();
    expect(settings.extraLabelPropertyName).toBe('');
  });

  it('should default the recency tiebreak to a finite, usable size', () => {
    const settings = new PluginSettings();
    expect(settings.recentFilesBoostCount).toBeGreaterThan(0);
    expect(Number.isFinite(settings.recentFilesBoostCount)).toBe(true);
  });

  it('should start with no exclusions', () => {
    const settings = new PluginSettings();
    expect(settings.excludedPathPatterns).toEqual([]);
  });
});
