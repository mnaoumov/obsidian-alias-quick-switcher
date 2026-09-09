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
 * The waiting happens in NODE: a single closure is capped at ~30s by the transport, and this file used to
 * declare a 60s ceiling inside one — plus a settle on top of it — which the cap could never honour. The
 * settles are Node-side sleeps now, since a settle is wall-clock time either way.
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
import { setTimeout as sleepInNode } from 'node:timers/promises';
import {
  captureObsidianScreenshot,
  evalInObsidian,
  labelScreenshot,
  pollInObsidian,
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

const THEME_SETTLE_DELAY_IN_MILLISECONDS = 1000;
const ROW_SETTLE_DELAY_IN_MILLISECONDS = 900;

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

  await pollInObsidian({
    poll({ app }): boolean {
      const leaf = app.vault.getFileByPath('Alpha/Bravo/Charlie.md');
      if (!leaf) {
        return false;
      }

      return Boolean(app.metadataCache.getFileCache(leaf)?.frontmatter);
    },
    start({ app }): void {
      app.changeTheme('obsidian');
      app.workspace.leftSplit.collapse();
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the leaf alias never reached the metadata cache',
    until: (isCached: boolean): boolean => isCached,
    vaultPath: vaultPath()
  });

  await sleepInNode(THEME_SETTLE_DELAY_IN_MILLISECONDS);
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
  await pollInObsidian({
    poll(): boolean {
      return document.querySelector('.prompt') === null;
    },
    start(): void {
      const background = document.querySelector('.modal-bg');
      if (background instanceof HTMLElement) {
        background.click();
      }
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'a switcher was left open',
    until: (isClosed: boolean): boolean => isClosed,
    vaultPath: vaultPath()
  });

  await pollInObsidian({
    input: { currentCommandId: commandId, currentModalSelector: modalSelector },
    poll({ currentModalSelector }): boolean {
      return document.querySelector(currentModalSelector) !== null;
    },
    start({ app, currentCommandId }): void {
      app.commands.executeCommandById(currentCommandId);
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the switcher never opened',
    until: (isOpen: boolean): boolean => isOpen,
    vaultPath: vaultPath()
  });

  await evalInObsidian({
    callback({ currentModalSelector, query: currentQuery }): void {
      const input = document.querySelector(`${currentModalSelector} .prompt-input`);
      if (!(input instanceof HTMLInputElement)) {
        throw new TypeError('The switcher has no input.');
      }

      input.value = currentQuery;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    input: { currentModalSelector: modalSelector, query },
    vaultPath: vaultPath()
  });

  await pollInObsidian({
    input: { currentModalSelector: modalSelector },
    poll({ currentModalSelector }): boolean {
      return document.querySelector(`${currentModalSelector} .suggestion-item`) !== null;
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: `no row was ever offered for ${query}`,
    until: (isOffered: boolean): boolean => isOffered,
    vaultPath: vaultPath()
  });

  // The list has a row; this lets it finish rendering before the frame is taken.
  await sleepInNode(ROW_SETTLE_DELAY_IN_MILLISECONDS);

  return await evalInObsidian({
    callback({ currentModalSelector }): string[] {
      return [...document.querySelectorAll(`${currentModalSelector} .suggestion-item`)].map((el) => el.textContent);
    },
    input: { currentModalSelector: modalSelector },
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
