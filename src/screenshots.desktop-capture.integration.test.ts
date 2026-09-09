/**
 * @file
 *
 * Produces the desktop frames of the matched row, driving a staged vault in a real Obsidian and writing
 * `images/screenshots/screenshot-desktop-N.png`.
 *
 * Every assertion about the two-line row already passes on both platforms — `matched-rendering.
 * cross-platform.integration.test.ts` is the suite that makes them. What no assertion can settle is
 * whether the row READS as an explanation: whether the second line earns its space, whether the
 * highlight is legible against `--text-muted`, and whether a folder row reads differently enough from a
 * note row. These frames are what that judgement is made on, and they double as the community-store
 * listing shots.
 *
 * The staged vault mirrors the demo vault's worked example — `Alpha/Bravo/Charlie.md` aliased `Echo`,
 * under a `Bravo` folder note aliased `Delta` — so a reader who follows the README meets the same names.
 *
 * The waiting happens in NODE: a single closure is capped at ~30s by the transport, so the 60s ceiling
 * this file used to declare inside one — plus a settle on top of it — was a budget the cap could never
 * honour. The settles are Node-side sleeps now, since a settle is wall-clock time either way.
 *
 * Excluded from `npm run test:integration` by its file name — see the `capture-screenshots:desktop`
 * project in `scripts/vitest-config.ts`. Capturing is an explicit operation
 * (`npm run capture:screenshots`), not something every test run does.
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

const WIDTH_IN_PIXELS = 1200;
const HEIGHT_IN_PIXELS = 800;

/**
 * The close-up is the same row in a narrower window. There is no crop helper, and none is needed: the
 * modal is sized as a fraction of the window, so shrinking the window magnifies the row against the
 * frame — which is exactly what a legibility judgement on the highlight wants.
 */
const CLOSE_UP_WIDTH_IN_PIXELS = 720;
const CLOSE_UP_HEIGHT_IN_PIXELS = 460;

const MODAL_SELECTOR = '.alias-quick-switcher-modal';

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
      const folderNote = app.vault.getFileByPath('Alpha/Bravo/Bravo.md');
      const leaf = app.vault.getFileByPath('Alpha/Bravo/Charlie.md');
      if (!folderNote || !leaf) {
        return false;
      }

      return Boolean(app.metadataCache.getFileCache(folderNote)?.frontmatter)
        && Boolean(app.metadataCache.getFileCache(leaf)?.frontmatter);
    },
    start({ app }): void {
      app.changeTheme('obsidian');

      // The switcher is the subject, not the file explorer, so the sidebar is collapsed to give the modal
      // The frame.
      app.workspace.leftSplit.collapse();
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'both aliases never reached the metadata cache',
    until: (areCached: boolean): boolean => areCached,
    vaultPath: vaultPath()
  });

  await sleepInNode(THEME_SETTLE_DELAY_IN_MILLISECONDS);
}, TEST_TIMEOUT_IN_MILLISECONDS);

describe('desktop frames of the matched row', () => {
  it('1 - a row matched by real names alone', async () => {
    const rows = await openSwitcher('Charlie');

    expect(rows.length).toBeGreaterThan(0);
    await shoot(1, 'Matched by name — one line, nothing to explain', WIDTH_IN_PIXELS, HEIGHT_IN_PIXELS);
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('2 - a row reached through two aliases', async () => {
    const rows = await openSwitcher('Alpha/Delta/Echo');

    expect(rows.length).toBeGreaterThan(0);
    // The caption names the path WITHOUT the extension, because that is what the row's second line shows.
    // A caption that names a string its own frame does not contain is the kind of thing nobody re-checks.
    await shoot(2, 'Alpha/Delta/Echo finds Alpha/Bravo/Charlie — and says so', WIDTH_IN_PIXELS, HEIGHT_IN_PIXELS);
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('3 - a folder row beside a note row', async () => {
    const rows = await openSwitcher('Delta');

    // The folder note is reachable twice on purpose — as a file by its own name, and as its folder by the
    // Folder's name — so this query is the one place the two row kinds stand side by side.
    expect(rows.length).toBeGreaterThan(1);
    await shoot(3, 'A folder answers to its folder note’s alias', WIDTH_IN_PIXELS, HEIGHT_IN_PIXELS);
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('4 - a partial path, so the highlight sits mid-path', async () => {
    const rows = await openSwitcher('Delta/Echo');

    expect(rows.length).toBeGreaterThan(0);
    await shoot(4, 'A partial path is enough', WIDTH_IN_PIXELS, HEIGHT_IN_PIXELS);
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('5 - the highlight broken into runs, close up', async () => {
    // The hardest case for legibility, and the one a full-segment query hides: when every segment matches
    // Whole, the entire first line is highlighted and the highlight is indistinguishable from its absence.
    // Here each segment is matched by a fragment, so highlighted and plain text sit side by side in the
    // Same word, directly above the muted second line.
    const rows = await openSwitcher('Alp/Del/Ech');

    expect(rows.length).toBeGreaterThan(0);
    await shoot(5, 'Each matched run, against the muted real path', CLOSE_UP_WIDTH_IN_PIXELS, CLOSE_UP_HEIGHT_IN_PIXELS);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

/**
 * Opens the switcher, types a query, and leaves it on screen for the capture.
 *
 * @param query - What to type into the switcher.
 * @returns The text of the rows the switcher is showing.
 */
async function openSwitcher(query: string): Promise<string[]> {
  await pollInObsidian({
    input: { modalSelector: MODAL_SELECTOR },
    poll({ modalSelector }): boolean {
      return document.querySelector(modalSelector) === null;
    },
    start(): void {
      // Each shot leaves its switcher on screen — that is the point of the shot — so the next one has to
      // Put it away before opening its own. Closed by clicking the modal background rather than by
      // Pressing Escape, the one gesture that works on Android too, which keeps this suite and its mobile
      // Twin the same shape.
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
    input: { modalSelector: MODAL_SELECTOR, pluginId: PLUGIN_ID },
    poll({ modalSelector }): boolean {
      return document.querySelector(modalSelector) !== null;
    },
    start({ app, pluginId }): void {
      app.commands.executeCommandById(`${pluginId}:open`);
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the switcher never opened',
    until: (isOpen: boolean): boolean => isOpen,
    vaultPath: vaultPath()
  });

  await evalInObsidian({
    callback({ modalSelector, query: currentQuery }): void {
      const input = document.querySelector(`${modalSelector} .prompt-input`);
      if (!(input instanceof HTMLInputElement)) {
        throw new TypeError('The switcher has no input.');
      }

      // A dispatched event rather than trusted input (G107), for the same reason the cross-platform
      // Suites use one: the harness drives keys through Electron's input API, which Android has not got,
      // And this suite's mobile twin has to do exactly what this one does.
      input.value = currentQuery;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    input: { modalSelector: MODAL_SELECTOR, query },
    vaultPath: vaultPath()
  });

  await pollInObsidian({
    input: { modalSelector: MODAL_SELECTOR },
    poll({ modalSelector }): boolean {
      return document.querySelector(`${modalSelector} .suggestion-item`) !== null;
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: `no row was ever offered for ${query}`,
    until: (isOffered: boolean): boolean => isOffered,
    vaultPath: vaultPath()
  });

  // The list has a row; this lets it finish rendering before the frame is taken.
  await sleepInNode(ROW_SETTLE_DELAY_IN_MILLISECONDS);

  return await evalInObsidian({
    callback({ modalSelector }): string[] {
      return [...document.querySelectorAll(`${modalSelector} .suggestion-item`)].map((el) => el.textContent);
    },
    input: { modalSelector: MODAL_SELECTOR },
    vaultPath: vaultPath()
  });
}

/**
 * Captures the window, captions it, and writes it as
 * `images/screenshots/screenshot-desktop-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 * @param widthInPixels - The window width to capture at.
 * @param heightInPixels - The window height to capture at.
 */
async function shoot(index: number, caption: string, widthInPixels: number, heightInPixels: number): Promise<void> {
  const bytes = await captureObsidianScreenshot({
    heightInPixels,
    vaultPath: vaultPath(),
    widthInPixels
  });

  const labeled = await labelScreenshot(bytes, { text: caption });

  expect(readPngDimensions(labeled)).toStrictEqual({
    heightInPixels,
    widthInPixels
  });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-desktop-${String(index)}.png`), labeled);
}

/**
 * The vault the harness staged for this run.
 *
 * @returns Its absolute path.
 */
function vaultPath(): string {
  return getTemporaryVault().path;
}
