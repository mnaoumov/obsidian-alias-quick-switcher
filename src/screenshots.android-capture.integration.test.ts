/**
 * @file
 *
 * Produces the mobile frames of the matched row, driving the switcher in Obsidian Mobile on a real
 * Android emulator and writing `images/screenshots/screenshot-mobile-N.png`.
 *
 * They are not redundant with the desktop frames. The row's second line is drawn in `--text-muted` at
 * `--font-smaller`, and whether that reads as an explanation or as noise is a question about the screen
 * it is read on — a phone is where it is smallest and where the answer could differ.
 *
 * There is no mobile equivalent of the desktop viewport override, so the capture is always the device's
 * own framebuffer — which is why this runs on the `obsidian_screenshots` AVD, built at exactly the
 * 900x1600 the community store asks for. See `scripts/vitest-config.ts` for why the shared `obsidian_test`
 * AVD cannot stand in for it.
 *
 * Split across several short `evalInObsidian` calls because one call is one `execute/sync`, which
 * WebDriver caps at 30 seconds — the wall this repo's eight cross-platform suites all hit on their first
 * Android run.
 *
 * Excluded from `npm run test:integration` by its file name — see the `capture-screenshots:android`
 * project in `scripts/vitest-config.ts`. Capturing is an explicit operation
 * (`npm run capture:screenshots`), not something every test run does.
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

const WIDTH_IN_PIXELS = 900;
const HEIGHT_IN_PIXELS = 1600;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 600_000;

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

      // No sidebar to collapse, unlike the desktop suite: on a phone it is a drawer that is already
      // Closed, and the switcher is a full-screen modal over whatever is behind it.
      await waitUntil({
        message: 'both aliases are in the metadata cache',
        predicate: () => {
          const folderNote = app.vault.getFileByPath('Alpha/Bravo/Bravo.md');
          const leaf = app.vault.getFileByPath('Alpha/Bravo/Charlie.md');
          if (!folderNote || !leaf) {
            return false;
          }

          return Boolean(app.metadataCache.getFileCache(folderNote)?.frontmatter)
            && Boolean(app.metadataCache.getFileCache(leaf)?.frontmatter);
        },
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);
    },
    input: { waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS },
    vaultPath: vaultPath()
  });
}, TEST_TIMEOUT_IN_MILLISECONDS);

describe('mobile frames of the matched row', () => {
  it('1 - a row matched by real names alone', async () => {
    const rows = await openSwitcher('Charlie');

    expect(rows.length).toBeGreaterThan(0);
    await shoot(1, 'Matched by name — one line, nothing to explain');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('2 - a row reached through two aliases', async () => {
    const rows = await openSwitcher('Alpha/Delta/Echo');

    expect(rows.length).toBeGreaterThan(0);
    // Without the extension, matching what the row's second line actually shows.
    await shoot(2, 'Alpha/Delta/Echo finds Alpha/Bravo/Charlie — and says so');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('3 - a folder row beside a note row', async () => {
    const rows = await openSwitcher('Delta');

    // The folder note is reachable twice on purpose — as a file by its own name, and as its folder by the
    // Folder's name — so this query is the one place the two row kinds stand side by side.
    expect(rows.length).toBeGreaterThan(1);
    await shoot(3, 'A folder answers to its folder note’s alias');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('4 - a partial path, so the highlight sits mid-path', async () => {
    const rows = await openSwitcher('Delta/Echo');

    expect(rows.length).toBeGreaterThan(0);
    await shoot(4, 'A partial path is enough');
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

/**
 * Opens the switcher, types a query, and leaves it on screen for the capture.
 *
 * @param query - What to type into the switcher.
 * @returns The text of the rows the switcher is showing.
 */
async function openSwitcher(query: string): Promise<string[]> {
  return await evalInObsidian({
    async callback({ app, lib: { waitUntil }, pluginId, query: currentQuery, waitTimeoutInMilliseconds }): Promise<string[]> {
      const SETTLE_DELAY_IN_MILLISECONDS = 900;

      // Each shot leaves its switcher on screen — that is the point of the shot — so the next one has to
      // Put it away before opening its own. Dismissed by clicking the modal background: the harness's
      // Trusted-key helpers reach for Electron's `remote`, which Android has not got, and a dispatched
      // KeyboardEvent is untrusted and ignored. A plain click is the one gesture that works here.
      const background = document.querySelector('.modal-bg');
      if (background instanceof HTMLElement) {
        background.click();
      }

      await waitUntil({
        message: 'no switcher left open',
        predicate: () => document.querySelector('.alias-quick-switcher-modal') === null,
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      app.commands.executeCommandById(`${pluginId}:open`);
      await waitUntil({
        message: 'the switcher is open',
        predicate: () => document.querySelector('.alias-quick-switcher-modal') !== null,
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      const input = document.querySelector('.alias-quick-switcher-modal .prompt-input');
      if (!(input instanceof HTMLInputElement)) {
        throw new TypeError('The switcher has no input.');
      }

      input.value = currentQuery;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      await waitUntil({
        message: `a row is offered for ${currentQuery}`,
        predicate: () => document.querySelector('.alias-quick-switcher-modal .suggestion-item') !== null,
        timeoutInMilliseconds: waitTimeoutInMilliseconds
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return [...document.querySelectorAll('.alias-quick-switcher-modal .suggestion-item')].map((el) => el.textContent);
    },
    input: { pluginId: PLUGIN_ID, query, waitTimeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS },
    vaultPath: vaultPath()
  });
}

/**
 * Captures the device's framebuffer, captions it, and writes it as
 * `images/screenshots/screenshot-mobile-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
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
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-mobile-${String(index)}.png`), labeled);
}

/**
 * The vault the harness staged for this run.
 *
 * @returns Its absolute path.
 */
function vaultPath(): string {
  return getTemporaryVault().path;
}
