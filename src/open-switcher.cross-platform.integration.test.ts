import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * The plugin's entry point, end to end against a real Obsidian: the command opens the switcher, and what
 * is picked in it is what ends up open.
 *
 * Cross-platform: the manifest declares `isDesktopOnly: false`, and opening a note has to hold on a phone
 * as much as on a desktop, so the file name puts it in both projects (G47).
 *
 * **The flow is split across several `evalInObsidian` calls on purpose.** Each call is ONE
 * `execute/sync` over the Appium transport, and WebDriver caps a single script at 30 seconds — which a
 * cold phone blows through while a whole create-wait-open-type-pick flow is still in its first half. The
 * stamp is therefore computed out here and passed in, so every call can re-derive the same paths without
 * carrying state across the boundary.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

describe('The `Open quick switcher` command', () => {
  it('opens the switcher, and opens the note that is picked in it', async () => {
    const stamp = `${Date.now().toString()}-${Math.floor(Math.random() * 1000).toString()}`;
    const targetName = `Charlie-${stamp}`;
    const targetPath = `${targetName}.md`;

    await evalInObsidian({
      async callback({ app, lib: { waitUntil }, targetPath: path, waitTimeoutInMilliseconds }): Promise<void> {
        await app.vault.create(path, '# Charlie\n');
        await waitUntil({
          message: 'the new note is in the vault',
          predicate: () => app.vault.getFileByPath(path) !== null,
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });
      },
      input: { targetPath, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS }
    });

    const wasSwitcherOpened = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, pluginId, waitTimeoutInMilliseconds }): Promise<boolean> {
        // These suites share one Obsidian, and each ends by picking something rather than by walking away,
        // So a modal left open here means an earlier suite broke that contract.
        await waitUntil({
          message: 'no switcher left open by an earlier suite',
          predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });

        app.commands.executeCommandById(`${pluginId}:open`);
        await waitUntil({
          message: 'the switcher is open',
          predicate: () => document.querySelector('.alias-quick-switcher-modal') !== null,
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });

        return document.querySelector('.alias-quick-switcher-modal') !== null;
      },
      input: { pluginId: PLUGIN_ID, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS }
    });

    const openedPath = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, targetName: name, targetPath: path, waitTimeoutInMilliseconds }): Promise<string> {
        const input = document.querySelector('.alias-quick-switcher-modal .prompt-input');
        if (!(input instanceof HTMLInputElement)) {
          throw new TypeError('The switcher has no input.');
        }

        // A dispatched event rather than trusted input (G107): the harness drives keys through Electron's
        // Input API, which does not exist on Android, and this behavior has to be proven on both.
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));

        await waitUntil({
          message: 'the note is offered',
          predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(name)),
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });

        // Addressed by TEXT rather than by position, so a row the vault happens to also match cannot be
        // Picked by mistake.
        const row = [...document.querySelectorAll('.suggestion-item')].find((el) => el.textContent.includes(name));
        if (!(row instanceof HTMLElement)) {
          throw new TypeError('The note was not offered.');
        }

        row.click();
        await waitUntil({
          message: 'the picked note is open',
          predicate: () => app.workspace.getActiveFile()?.path === path,
          timeoutInMilliseconds: waitTimeoutInMilliseconds
        });

        return app.workspace.getActiveFile()?.path ?? '';
      },
      input: { targetName, targetPath, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS }
    });

    expect(wasSwitcherOpened).toBe(true);
    expect(openedPath).toBe(targetPath);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
