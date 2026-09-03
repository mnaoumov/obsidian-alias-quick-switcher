/**
 * @file
 *
 * The built-in quick switcher and this one, on the SAME leaf-alias match, so the two renderings can be
 * compared rather than described.
 *
 * Obsidian's own switcher already resolves a leaf alias — `Echo` finds `Alpha/Bravo/Charlie.md` — and it
 * has a rendering for that hit. Whether this plugin's two-line row reads as an explanation is not a
 * question about the row on its own; it is a question about whether it says more than the built-in
 * already does, and whether it says it in the same visual language.
 *
 * Excluded from `npm run test:integration` by its file name — see the `capture-screenshots:desktop`
 * project in `scripts/vitest-config.ts`.
 */

import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import {
  captureObsidianScreenshot,
  evalInObsidian,
  labelScreenshot,
  readPngDimensions
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'alias-quick-switcher';

const BUILT_IN_COMMAND_ID = 'switcher:open';

const WIDTH_IN_PIXELS = 900;
const HEIGHT_IN_PIXELS = 520;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const IMAGES_DIRECTORY = join(process.cwd(), 'images', 'screenshots');

beforeAll(async () => {
  const vault = getTemporaryVault();

  vault.populate({
    'Alpha/Bravo/Bravo.md': '---\naliases:\n  - Delta\n---\n\n# Bravo\n',
    'Alpha/Bravo/Charlie.md': '---\naliases:\n  - Echo\n---\n\n# Charlie\n',
    'Alpha/Bravo/Foxtrot.md': '# Foxtrot\n',
    'Alpha/Golf/Hotel.md': '# Hotel\n',
    'Meetings/Charlie handover.md': '# Charlie handover\n'
  });
  await vault.syncToDevice();

  await evalInObsidian({
    async callback({ app, lib: { waitUntil }, waitTimeoutInMilliseconds }): Promise<void> {
      const SETTLE_DELAY_IN_MILLISECONDS = 1000;

      app.changeTheme('obsidian');
      app.workspace.leftSplit.collapse();

      await waitUntil({
        message: 'the leaf alias is in the metadata cache',
        predicate: () => {
          const leaf = app.vault.getFileByPath('Alpha/Bravo/Charlie.md');
          if (!leaf) {
            return false;
          }

          return Boolean(app.metadataCache.getFileCache(leaf)?.frontmatter);
        },
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);
    },
    input: { waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS },
    vaultPath: vaultPath()
  });
}, TEST_TIMEOUT_IN_MILLISECONDS);

describe('the built-in switcher and this one, on the same match', () => {
  it('a - the built-in, matching the leaf alias Echo', async () => {
    const rows = await openSwitcher(BUILT_IN_COMMAND_ID, '.prompt', 'Echo');

    expect(rows.length).toBeGreaterThan(0);
    await shoot('builtin', 'Obsidian’s own switcher: Echo');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('b - this plugin, matching the same leaf alias', async () => {
    const rows = await openSwitcher(`${PLUGIN_ID}:open`, '.alias-quick-switcher-modal', 'Echo');

    expect(rows.length).toBeGreaterThan(0);
    await shoot('plugin-leaf', 'This plugin: Echo');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('c - this plugin, on a match the built-in cannot make', async () => {
    const rows = await openSwitcher(`${PLUGIN_ID}:open`, '.alias-quick-switcher-modal', 'Alpha/Delta/Echo');

    expect(rows.length).toBeGreaterThan(0);
    await shoot('plugin-path', 'This plugin: Alpha/Delta/Echo');
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

/**
 * Opens a switcher, types a query, and leaves it on screen for the capture.
 *
 * @param commandId - The command that opens the switcher.
 * @param modalSelector - What distinguishes that switcher's modal in the DOM.
 * @param query - What to type into it.
 * @returns The text of the rows it is showing.
 */
async function openSwitcher(commandId: string, modalSelector: string, query: string): Promise<string[]> {
  return await evalInObsidian({
    async callback({ app, currentCommandId, currentModalSelector, lib: { waitUntil }, query: currentQuery, waitTimeoutInMilliseconds }): Promise<string[]> {
      const SETTLE_DELAY_IN_MILLISECONDS = 900;

      const background = document.querySelector('.modal-bg');
      if (background instanceof HTMLElement) {
        background.click();
      }

      await waitUntil({
        message: 'no switcher left open',
        predicate: () => document.querySelector('.prompt') === null,
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      app.commands.executeCommandById(currentCommandId);
      await waitUntil({
        message: 'the switcher is open',
        predicate: () => document.querySelector(currentModalSelector) !== null,
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      const input = document.querySelector(`${currentModalSelector} .prompt-input`);
      if (!(input instanceof HTMLInputElement)) {
        throw new TypeError('The switcher has no input.');
      }

      input.value = currentQuery;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      await waitUntil({
        message: `a row is offered for ${currentQuery}`,
        predicate: () => document.querySelector(`${currentModalSelector} .suggestion-item`) !== null,
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return [...document.querySelectorAll(`${currentModalSelector} .suggestion-item`)].map((el) => el.textContent);
    },
    input: {
      currentCommandId: commandId,
      currentModalSelector: modalSelector,
      query,
      waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
    },
    vaultPath: vaultPath()
  });
}

/**
 * Captures the window, captions it, and writes it as
 * `images/screenshots/comparison-<name>.png`.
 *
 * @param name - The frame's name.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(name: string, caption: string): Promise<void> {
  const bytes = await captureObsidianScreenshot({
    heightInPixels: HEIGHT_IN_PIXELS,
    vaultPath: vaultPath(),
    widthInPixels: WIDTH_IN_PIXELS
  });

  const labeled = await labelScreenshot(bytes, { text: caption });

  expect(readPngDimensions(labeled)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `comparison-${name}.png`), labeled);
}

/**
 * The vault the harness staged for this run.
 *
 * @returns Its absolute path.
 */
function vaultPath(): string {
  return getTemporaryVault().path;
}
