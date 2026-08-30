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
