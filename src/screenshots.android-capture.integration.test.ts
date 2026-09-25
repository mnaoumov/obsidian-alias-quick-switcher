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
 * **Every frame is taken with the soft keyboard up**, because every frame shows a focused search field and
 * that is what a phone looks like with one. See {@link shoot} for what raising it takes and why the
 * harness owns both halves. The consequence to accept: these four frames are **no longer
 * byte-reproducible**, since the status-bar clock and the battery indicator are now in them.
 *
 * Split across several short `evalInObsidian` calls because one call is one `execute/sync`, which
 * WebDriver caps at 30 seconds — the wall this repo's eight cross-platform suites all hit on their first
 * Android run. The waiting itself happens in NODE for the same reason: the 60s ceiling this file used to
 * declare inside a closure was one the cap could never honour, and the settles are Node-side sleeps now,
 * since a settle is wall-clock time either way.
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
import { setTimeout as sleepInNode } from 'node:timers/promises';
import {
  captureDeviceScreenshot,
  evalInObsidian,
  labelScreenshot,
  pollInObsidian,
  raiseSoftKeyboard,
  readPngDimensions,
  resolveEmulatorDeviceId,
  withSoftKeyboardEnabled
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'alias-quick-switcher';

// The plugin that owns the title properties this switcher reads, and whose Titles module a frame switches on.
const ADVANCED_METADATA_CACHE_PLUGIN_ID = 'advanced-metadata-cache';

const WIDTH_IN_PIXELS = 900;
const HEIGHT_IN_PIXELS = 1600;

const MODAL_SELECTOR = '.alias-quick-switcher-modal';

/**
 * The switcher's search field, which is what a thumb touches to bring the keyboard up.
 */
const INPUT_SELECTOR = `${MODAL_SELECTOR} .prompt-input`;

/**
 * The AVD these frames are taken on, matched by name.
 *
 * Never the first device `adb devices` lists: a physical phone is routinely plugged into the same machine,
 * and the shared `obsidian_test` AVD the cross-platform suites drive is a different size.
 */
const AVD_NAME = 'obsidian_screenshots';

/**
 * The frontmatter property frame 5 points the plugin at, and the value the staged `Charlie` carries under
 * it — a name the switcher can only reach while Advanced Metadata Cache's Titles module reads that property.
 */
const TITLE_PROPERTY_NAME = 'title';
const TITLE_VALUE = 'India';

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 600_000;

const THEME_SETTLE_DELAY_IN_MILLISECONDS = 1000;
const ROW_SETTLE_DELAY_IN_MILLISECONDS = 900;

const IMAGES_DIRECTORY = join(process.cwd(), 'images', 'screenshots');

let deviceId = '';

beforeAll(async () => {
  deviceId = await resolveEmulatorDeviceId({ avdName: AVD_NAME });

  const vault = getTemporaryVault();

  vault.populate({
    'Alpha/Bravo/Bravo.md': '---\naliases:\n  - Delta\n---\n\n# Bravo\n',
    // `title` alongside the alias, exactly as the demo vault's own `Charlie` carries both — frame 5 is the
    // one row that needs an alias and a property at once, and no other frame is affected by it because the
    // setting that reads a property is off until frame 5 turns it on.
    'Alpha/Bravo/Charlie.md': '---\naliases:\n  - Echo\ntitle: India\n---\n\n# Charlie\n',
    'Alpha/Bravo/Foxtrot.md': '# Foxtrot\n',
    'Alpha/Golf/Hotel.md': '# Hotel\n',
    'Meetings/Charlie handover.md': '# Charlie handover\n'
  });
  await vault.syncToDevice();

  // No sidebar to collapse, unlike the desktop suite: on a phone it is a drawer that is already closed,
  // and the switcher is a full-screen modal over whatever is behind it.
  await pollInObsidian({
    poll({ app }): boolean {
      const folderNote = app.vault.getFileByPath('Alpha/Bravo/Bravo.md');
      const leaf = app.vault.getFileByPath('Alpha/Bravo/Charlie.md');
      return folderNote !== null && leaf !== null
        && Boolean(app.metadataCache.getFileCache(folderNote)?.frontmatter)
        && Boolean(app.metadataCache.getFileCache(leaf)?.frontmatter);
    },
    start({ app }): void {
      app.changeTheme('obsidian');
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'both aliases never reached the metadata cache',
    until: (areCached: boolean): boolean => areCached,
    vaultPath: vaultPath()
  });

  await sleepInNode(THEME_SETTLE_DELAY_IN_MILLISECONDS);
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
    // folder's name — so this query is the one place the two row kinds stand side by side.
    expect(rows.length).toBeGreaterThan(1);
    await shoot(3, 'A folder answers to its folder note’s alias');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('4 - a partial path, so the highlight sits mid-path', async () => {
    const rows = await openSwitcher('Delta/Echo');

    expect(rows.length).toBeGreaterThan(0);
    await shoot(4, 'A partial path is enough');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('5 - an alias and a frontmatter property on one row', async () => {
    // The only frame that needs a setting: Advanced Metadata Cache's Titles module is off by default, which is what
    // frames 1-4 are taken under. Turned on here and put back afterwards, because these frames share one
    // Obsidian and one settings file.
    await setTitleProperties([TITLE_PROPERTY_NAME]);

    try {
      // `Delta` is the FOLDER's alias and `India` is the leaf's `title`, so this one row carries both
      // markers. It earns a mobile frame of its own because the markers are the smallest thing on the row
      // and a phone is where that is hardest — and because a tooltip is reached by touch and hold here.
      const rows = await openSwitcher(`Alpha/Delta/${TITLE_VALUE}`);

      // A weak-looking assertion that is not: nothing else in the staged vault answers to `India`, so a
      // setting that failed to apply offers no row at all rather than a differently-matched one.
      expect(rows.length).toBeGreaterThan(0);
      await shoot(5, 'An alias and a title, each with its own marker');
    } finally {
      await setTitleProperties([]);
    }
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
    async start({ lib: { pressKey } }): Promise<void> {
      // Each shot leaves its switcher on screen — that is the point of the shot — so the next one has to
      // put it away before opening its own. Escape rather than a tap on the modal background: a trusted
      // tap is hit-tested at the element's centre, and the background's centre is behind the switcher, so
      // the tap would land on the switcher itself.
      await pressKey({ key: 'Escape' });
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
 * Points Advanced Metadata Cache's Titles module at frontmatter properties, or switches it off.
 *
 * Read structurally rather than asserted through `unknown`, the same way
 * `source-flairs.desktop.integration.test.ts` reaches it: this touches a member the plugin base keeps
 * protected, so a version that renamed it fails loudly here rather than at the first property access.
 *
 * @param propertyNames - The properties to treat as names, or none for `aliases` alone, which switches the Titles
 * module off.
 */
async function setTitleProperties(propertyNames: string[]): Promise<void> {
  await evalInObsidian({
    async callback({ app, pluginId, propertyNames: newPropertyNames }): Promise<void> {
      interface SettingsEditor {
        editAndSave: (this: void, settingsEditor: (settings: TitlesSettingsLike) => void) => Promise<void>;
      }

      interface TitlesSettingsLike {
        isTitlesModuleEnabled: boolean;
        titlePropertyNames: string[];
      }

      const plugin = app.plugins.getPlugin(pluginId);
      if (!plugin) {
        throw new Error('The plugin is not enabled.');
      }

      if (!('pluginSettingsComponent' in plugin)) {
        throw new Error('The plugin exposes no settings component.');
      }

      const candidate: unknown = plugin.pluginSettingsComponent;
      if (typeof candidate !== 'object' || candidate === null || !('editAndSave' in candidate)) {
        throw new TypeError('The settings component cannot save.');
      }

      await (candidate as SettingsEditor).editAndSave((settings) => {
        settings.isTitlesModuleEnabled = newPropertyNames.length > 0;
        // Left as it was on the way out, so switching the module off restores exactly what a fresh install has.
        if (newPropertyNames.length > 0) {
          settings.titlePropertyNames = newPropertyNames;
        }
      });
    },
    input: { pluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID, propertyNames },
    vaultPath: vaultPath()
  });
}

/**
 * Captures the device's framebuffer with the soft keyboard up, captions it, and writes it as
 * `images/screenshots/screenshot-mobile-<index>.png`.
 *
 * Every frame here shows the switcher's focused search field, so every frame gets the keyboard — and
 * therefore the DEVICE capture rather than the page one. `captureObsidianScreenshot` drives Appium in the
 * WebView context, so it photographs the page: no status bar, and no keyboard, because the IME is a system
 * window and not part of the page. That left the lower ~60-70 % of each frame as an empty band where a
 * phone shows an IME.
 *
 * Two things are needed and both are easy to miss, which is why they are the harness's job rather than
 * this file's: the AVD is built `hw.keyboard=yes`, so Android suppresses the on-screen keyboard until
 * `withSoftKeyboardEnabled` lifts that; and a WebView does not ask for an IME on programmatic focus
 * alone, so `raiseSoftKeyboard` puts a real touch on the field and proves it came up. It also puts down a
 * keyboard still up from the previous frame before it reads its baseline, which is what lets one suite
 * take several frames in a row.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
  const bytes = await withSoftKeyboardEnabled({
    async callback() {
      await raiseSoftKeyboard({
        deviceId,
        inputSelector: INPUT_SELECTOR,
        vaultPath: vaultPath()
      });

      return await captureDeviceScreenshot({ deviceId });
    },
    deviceId
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
