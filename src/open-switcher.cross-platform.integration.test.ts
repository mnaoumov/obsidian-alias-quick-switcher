import {
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
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
 * as much as on a desktop, so the file name puts it in both projects.
 *
 * **The waiting happens in NODE, and each closure below is milliseconds of DOM reading.** A single
 * `evalInObsidian` closure is capped at ~30s by the transport, so a closure that waits is a closure that
 * dies on any machine where the thing waited for is slower than that — a cold phone, exactly. This file
 * used to split the flow across calls for that reason and then declare a 60s ceiling inside each of them,
 * which the cap could never honour. `pollInObsidian` is what makes the 60s real: it re-runs a short `poll`
 * closure from Node until the Node-side `until` accepts. The stamp is computed out here and passed in, so
 * every call re-derives the same paths without carrying state across the boundary.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const MODAL_SELECTOR = '.alias-quick-switcher-modal';
const SUGGESTION_SELECTOR = '.suggestion-item';

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

describe('The `Open quick switcher` command', () => {
  it('opens the switcher, and opens the note that is picked in it', async () => {
    const stamp = `${Date.now().toString()}-${Math.floor(Math.random() * 1000).toString()}`;
    const targetName = `Charlie-${stamp}`;
    const targetPath = `${targetName}.md`;

    await pollInObsidian({
      input: { targetPath },
      poll({ app, targetPath: path }): boolean {
        return app.vault.getFileByPath(path) !== null;
      },
      async start({ app, targetPath: path }): Promise<void> {
        await app.vault.create(path, '# Charlie\n');
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the new note never appeared in the vault',
      until: (isPresent: boolean): boolean => isPresent
    });

    // These suites share one Obsidian, and each ends by picking something rather than by walking away,
    // so a modal left open here means an earlier suite broke that contract.
    await pollInObsidian({
      input: { modalSelector: MODAL_SELECTOR },
      poll({ modalSelector }): boolean {
        return document.querySelector(modalSelector) === null;
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'a switcher was left open by an earlier suite',
      until: (isClosed: boolean): boolean => isClosed
    });

    const wasSwitcherOpened = await pollInObsidian({
      input: { modalSelector: MODAL_SELECTOR, pluginId: PLUGIN_ID },
      poll({ modalSelector }): boolean {
        return document.querySelector(modalSelector) !== null;
      },
      start({ app, pluginId }): void {
        app.commands.executeCommandById(`${pluginId}:open`);
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the switcher never opened',
      until: (isOpen: boolean): boolean => isOpen
    });

    await evalInObsidian({
      callback({ modalSelector, targetName: name }): void {
        const input = document.querySelector(`${modalSelector} .prompt-input`);
        if (!(input instanceof HTMLInputElement)) {
          throw new TypeError('The switcher has no input.');
        }

        // A dispatched event rather than trusted input: the harness drives keys through Electron's
        // input API, which does not exist on Android, and this behavior has to be proven on both.
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
      input: { modalSelector: MODAL_SELECTOR, targetName }
    });

    await pollInObsidian({
      input: { suggestionSelector: SUGGESTION_SELECTOR, targetName },
      poll({ suggestionSelector, targetName: name }): boolean {
        return [...document.querySelectorAll(suggestionSelector)].some((el) => el.textContent.includes(name));
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the note was never offered',
      until: (isOffered: boolean): boolean => isOffered
    });

    await evalInObsidian({
      callback({ suggestionSelector, targetName: name }): void {
        // Addressed by TEXT rather than by position, so a row the vault happens to also match cannot be
        // picked by mistake.
        const row = [...document.querySelectorAll(suggestionSelector)].find((el) => el.textContent.includes(name));
        if (!(row instanceof HTMLElement)) {
          throw new TypeError('The note was not offered.');
        }

        row.click();
      },
      input: { suggestionSelector: SUGGESTION_SELECTOR, targetName }
    });

    // `until` runs in Node, so it compares against the path this test already holds rather than passing it in.
    const openedPath = await pollInObsidian({
      poll({ app }): string {
        return app.workspace.getActiveFile()?.path ?? '';
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the picked note never became the active file',
      until: (path: string): boolean => path === targetPath
    });

    expect(wasSwitcherOpened).toBe(true);
    expect(openedPath).toBe(targetPath);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
