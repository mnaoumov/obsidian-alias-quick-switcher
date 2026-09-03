import type { App } from 'obsidian';

import { Notice } from 'obsidian';

const PLUGIN_ID = 'alias-quick-switcher';

/**
 * Runs one of the plugin's commands, so a command a note names is a command that note can run.
 *
 * Manual equivalent: the Command Palette entry of the same name.
 */
export function runCommand(app: App, commandId: string): void {
  const fullCommandId = `${PLUGIN_ID}:${commandId}`;
  if (!app.commands.commands[fullCommandId]) {
    new Notice(`Command ${fullCommandId} is not registered — is the plugin enabled?`);
    return;
  }

  app.commands.executeCommandById(fullCommandId);
}

/**
 * Sets one of the plugin's settings and saves it, so a note can demonstrate what a setting changes
 * without sending the reader to the settings tab and back.
 *
 * Manual equivalent: Settings -> Community plugins -> Alias Quick Switcher, and the matching control.
 */
export async function setSetting(app: App, propertyName: string, value: unknown): Promise<void> {
  const plugin = app.plugins.getPlugin(PLUGIN_ID);
  if (!plugin) {
    new Notice(`Plugin ${PLUGIN_ID} is not enabled`);
    return;
  }

  const settingsComponent = (plugin as unknown as SettingsComponentHolder).pluginSettingsComponent;
  await settingsComponent.editAndSave((settings: Record<string, unknown>) => {
    settings[propertyName] = value;
  });
  new Notice(`${propertyName} is now ${String(value)}`);
}

interface SettingsComponentHolder {
  pluginSettingsComponent: {
    editAndSave(settingsEditor: (settings: Record<string, unknown>) => void): Promise<void>;
  };
}
