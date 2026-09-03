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
 */

/**
 * The flow waits on several things in turn, each of which can legitimately take seconds on a cold
 * Obsidian, so it needs more than vitest's 30-second default.
 */
const PLUGIN_ID = 'alias-quick-switcher';

const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

interface OpenSwitcherResult {
  readonly openedPath: string;
  readonly wasSwitcherOpened: boolean;
}

describe('The `Open quick switcher` command', () => {
  it('opens the switcher, and opens the note that is picked in it', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, pluginId }): Promise<OpenSwitcherResult> {
        const WAIT_TIMEOUT_IN_MILLISECONDS = 30_000;
        const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
        const targetName = `Charlie-${stamp}`;
        const targetPath = `${targetName}.md`;

        await app.vault.create(targetPath, '# Charlie\n');
        await waitUntil({
          message: 'the new note is in the vault',
          predicate: () => app.vault.getFileByPath(targetPath) !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        // These suites share one Obsidian, and each ends by picking something rather than by walking away,
        // So a modal left open here means an earlier suite broke that contract.
        await waitUntil({
          message: 'no switcher left open by an earlier suite',
          predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        app.commands.executeCommandById(`${pluginId}:open`);
        await waitUntil({
          message: 'the switcher is open',
          predicate: () => document.querySelector('.alias-quick-switcher-modal') !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const wasSwitcherOpened = document.querySelector('.alias-quick-switcher-modal') !== null;

        const input = document.querySelector('.alias-quick-switcher-modal .prompt-input');
        if (!(input instanceof HTMLInputElement)) {
          throw new TypeError('The switcher has no input.');
        }

        // A dispatched event rather than trusted input (G107): the harness drives keys through Electron's
        // Input API, which does not exist on Android, and this behavior has to be proven on both.
        input.value = targetName;
        input.dispatchEvent(new Event('input', { bubbles: true }));

        await waitUntil({
          message: 'the note is offered',
          predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(targetName)),
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        // Addressed by TEXT rather than by position, so a row the vault happens to also match cannot be
        // Picked by mistake.
        const row = [...document.querySelectorAll('.suggestion-item')].find((el) => el.textContent.includes(targetName));
        if (!(row instanceof HTMLElement)) {
          throw new TypeError('The note was not offered.');
        }

        row.click();
        await waitUntil({
          message: 'the picked note is open',
          predicate: () => app.workspace.getActiveFile()?.path === targetPath,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        return { openedPath: app.workspace.getActiveFile()?.path ?? '', wasSwitcherOpened };
      },
      input: { pluginId: PLUGIN_ID }
    });

    expect(result.wasSwitcherOpened).toBe(true);
    expect(result.openedPath).toMatch(/^Charlie-/);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
