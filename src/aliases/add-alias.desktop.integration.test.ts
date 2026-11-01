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
 * The `Add alias...` command end to end against a real Obsidian: the selection of the editor showing the note
 * seeds the prompt, and what is confirmed lands in the note's `aliases`.
 *
 * Desktop only: the command's own logic is unit-tested, and what this suite adds is the real prompt modal and
 * the real frontmatter write, neither of which differs on a phone.
 */

const PLUGIN_ID = 'alias-quick-switcher';

const PROMPT_SELECTOR = '.prompt-modal';

const SELECTED_TEXT = 'Kilo';

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

describe('The `Add alias...` command', () => {
  it('seeds the prompt with the selection, and adds the confirmed alias to the note', async () => {
    const stamp = `${Date.now().toString()}-${Math.floor(Math.random() * 1000).toString()}`;
    const targetPath = `Lima-${stamp}.md`;
    const alias = `Mike ${stamp}`;

    await evalInObsidian({
      async callback({ app, selectedText, targetPath: path }): Promise<void> {
        const file = await app.vault.create(path, `---\naliases:\n  - November\n---\nBefore ${selectedText} after\n`);
        const leaf = app.workspace.getLeaf(true);
        await leaf.openFile(file, { state: { mode: 'source' } });
      },
      input: { selectedText: SELECTED_TEXT, targetPath }
    });

    const seededValue = await pollInObsidian({
      input: { pluginId: PLUGIN_ID, promptSelector: PROMPT_SELECTOR, selectedText: SELECTED_TEXT, targetPath },
      poll({ promptSelector }): null | string {
        const input = document.querySelector(`${promptSelector} input`);
        return input instanceof HTMLInputElement ? input.value : null;
      },
      start({ app, pluginId, selectedText, targetPath: path }): void {
        const editor = app.workspace.activeEditor?.editor;
        if (app.workspace.activeEditor?.file?.path !== path || !editor) {
          throw new Error('The note is not open in an editor.');
        }

        const line = editor.getLine(editor.lastLine() - 1);
        const ch = line.indexOf(selectedText);
        editor.setSelection({ ch, line: editor.lastLine() - 1 }, { ch: ch + selectedText.length, line: editor.lastLine() - 1 });
        app.commands.executeCommandById(`${pluginId}:add-alias`);
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the prompt never opened',
      until: (value: null | string): boolean => value !== null
    });

    await evalInObsidian({
      async callback({ alias: value, lib: { clickElement }, promptSelector }): Promise<void> {
        const input = document.querySelector(`${promptSelector} input`);
        const okButton = document.querySelector(`${promptSelector} .ok-button`);
        if (!(input instanceof HTMLInputElement) || !(okButton instanceof HTMLElement)) {
          throw new TypeError('The prompt has no input or no OK button.');
        }

        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await clickElement({ element: okButton });
      },
      input: { alias, promptSelector: PROMPT_SELECTOR }
    });

    const aliases = await pollInObsidian({
      input: { targetPath },
      poll({ app, targetPath: path }): unknown {
        const file = app.vault.getFileByPath(path);
        return file ? app.metadataCache.getFileCache(file)?.frontmatter?.['aliases'] : null;
      },
      timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
      timeoutMessage: 'the alias never reached the note',
      until: (value: unknown): boolean => Array.isArray(value) && value.includes(alias)
    });

    const isPromptClosed = await evalInObsidian({
      callback({ promptSelector }): boolean {
        return document.querySelector(promptSelector) === null;
      },
      input: { promptSelector: PROMPT_SELECTOR }
    });

    expect(seededValue).toBe(SELECTED_TEXT);
    expect(aliases).toEqual(['November', alias]);
    expect(isPromptClosed).toBe(true);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
