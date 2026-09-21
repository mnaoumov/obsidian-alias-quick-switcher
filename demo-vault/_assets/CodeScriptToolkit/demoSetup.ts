import type { App } from 'obsidian';

import { Notice } from 'obsidian';

const PLUGIN_ID = 'alias-quick-switcher';

const SWITCHER_COMMAND_ID = 'open';
const SWITCHER_INPUT_SELECTOR = '.alias-quick-switcher-modal .prompt-input';

/**
 * Opens the switcher with a query already in its search field, so a note can hand the reader the result
 * of a query rather than the instruction to type one.
 *
 * The switcher is opened by the plugin's own command, which builds the modal synchronously — so its input
 * is in the document by the time {@link runCommand} returns, and no waiting is needed.
 *
 * A missing input THROWS rather than showing a notice, unlike the rest of this file. The demo-vault button
 * suite clicks every button in the vault against a real Obsidian and only an exception reaches it, so a
 * notice here would leave this button the one whose promise nothing checks. The reader loses nothing: the
 * switcher is open either way, and the message says what to type into it.
 *
 * Manual equivalent: run the command and type the query.
 */
export function openSwitcherWithQuery(app: App, query: string): void {
  runCommand(app, SWITCHER_COMMAND_ID);

  const input = document.querySelector(SWITCHER_INPUT_SELECTOR);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`The switcher has no search field to type into — type ${query} into it yourself.`);
  }

  // A notification that the value changed, not a pretend keystroke: `SuggestModal` rebuilds its list from
  // `input`, and nothing on that path gates on `isTrusted`.
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

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
