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
  parseInputMethodState,
  pollInObsidian,
  raiseSoftKeyboard,
  readPngDimensions,
  resolveEmulatorDeviceId,
  runAdbText,
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
 * it — a name the switcher can only reach while `extraLabelPropertyName` names that property.
 */
const TITLE_PROPERTY_NAME = 'title';
const TITLE_VALUE = 'India';

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 600_000;

const THEME_SETTLE_DELAY_IN_MILLISECONDS = 1000;
const ROW_SETTLE_DELAY_IN_MILLISECONDS = 900;
const KEYBOARD_RETRACT_DELAY_IN_MILLISECONDS = 900;

/**
 * The flag `dumpsys input_method` sets while an IME is showing. Nothing in the page reports the keyboard,
 * so the device's own answer is the only one there is.
 */
const INPUT_SHOWN_STATE = 'mInputShown=true';

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
      if (!folderNote || !leaf) {
        return false;
      }

      return Boolean(app.metadataCache.getFileCache(folderNote)?.frontmatter)
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
    // The only frame that needs a setting: `extraLabelPropertyName` is empty by default, which is what
    // frames 1-4 are taken under. Turned on here and put back afterwards, because these frames share one
    // Obsidian and one settings file.
    await setExtraLabelPropertyName(TITLE_PROPERTY_NAME);

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
      await setExtraLabelPropertyName('');
    }
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});

/**
 * Asks the DEVICE whether an IME is showing, since nothing in the page reports one.
 *
 * @returns A {@link Promise} that resolves to whether the soft keyboard is up.
 */
async function checkIsSoftKeyboardShown(): Promise<boolean> {
  const dump = await runAdbText({
    commandArguments: ['shell', 'dumpsys', 'input_method'],
    deviceId
  });

  return parseInputMethodState(dump).includes(INPUT_SHOWN_STATE);
}

/**
 * Puts the soft keyboard down if one is up, so the raise that follows has a field that has not moved yet
 * to measure against.
 *
 * `KEYCODE_BACK` is what Android defines for this: a showing IME consumes the key and retracts, and the
 * app behind it never sees it — which is why this cannot close the switcher instead. The device is asked
 * FIRST for exactly that reason: with no IME showing, the same key would reach the app and close the
 * switcher this frame is about to photograph.
 *
 * It fails here rather than leaving {@link raiseSoftKeyboard} to fail: a keyboard that is already up makes
 * that call report `the keyboard did not come up` about a keyboard that is up, which is the most
 * misleading error this suite can produce.
 */
async function lowerSoftKeyboard(): Promise<void> {
  if (!await checkIsSoftKeyboardShown()) {
    return;
  }

  await pressBackAndSettle();
  if (!await checkIsSoftKeyboardShown()) {
    return;
  }

  // One retry, because the first BACK can land while the IME is still animating up from the focus that
  // raised it, and an IME mid-animation swallows it without retracting.
  await pressBackAndSettle();
  if (await checkIsSoftKeyboardShown()) {
    throw new Error('The soft keyboard would not retract, so the raise that follows could not prove anything.');
  }
}

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
 * Presses BACK on the device and gives the IME time to finish retracting.
 */
async function pressBackAndSettle(): Promise<void> {
  await runAdbText({
    commandArguments: ['shell', 'input', 'keyevent', 'KEYCODE_BACK'],
    deviceId
  });

  await sleepInNode(KEYBOARD_RETRACT_DELAY_IN_MILLISECONDS);
}

/**
 * Points the plugin at a frontmatter property, or at none.
 *
 * Read structurally rather than asserted through `unknown`, the same way
 * `source-flairs.desktop.integration.test.ts` reaches it: this touches a member the plugin base keeps
 * protected, so a version that renamed it fails loudly here rather than at the first property access.
 *
 * @param propertyName - The property to treat as a name, or the empty string for `aliases` alone.
 */
async function setExtraLabelPropertyName(propertyName: string): Promise<void> {
  await evalInObsidian({
    async callback({ app, pluginId, propertyName: newPropertyName }): Promise<void> {
      interface SettingsEditor {
        editAndSave: (this: void, settingsEditor: (settings: SwitcherSettingsLike) => void) => Promise<void>;
      }

      interface SwitcherSettingsLike {
        extraLabelPropertyName: string;
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
        settings.extraLabelPropertyName = newPropertyName;
      });
    },
    input: { pluginId: PLUGIN_ID, propertyName },
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
 * alone, so `raiseSoftKeyboard` puts a real touch on the field and proves it came up.
 *
 * The frame starts by putting any keyboard already up back DOWN, and that is what makes a suite of
 * several frames possible at all. `raiseSoftKeyboard` proves the lift as a DELTA against a baseline read
 * just before its touch, so a keyboard that is already up reads as a field that never moved — the blind
 * spot its own diagnostic names. Measured here on 2026-09-20: frame 1 passed and frames 2-5 all failed
 * `the keyboard did not come up` with `lift=0` while the device reported `mInputShown=true`, and the
 * failure framebuffer showed a correctly lifted field under a fully drawn keyboard. Lowering it first
 * keeps every frame's proof honest instead of teaching the suite to accept an unproved one.
 *
 * It has to happen HERE rather than after the previous capture, which was tried first and did not work:
 * the IME comes back on its own when {@link openSwitcher} opens the next switcher and Obsidian focuses
 * its field, so a keyboard lowered at the end of the previous frame is up again before this frame's
 * baseline is read.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
  const bytes = await withSoftKeyboardEnabled({
    async callback() {
      await lowerSoftKeyboard();

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
