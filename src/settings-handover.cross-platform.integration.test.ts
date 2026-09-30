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
 * The retired `extraLabelPropertyName`, end to end against the REAL provider: a `data.json` written by a release
 * that still had the setting is loaded, the value is parked as `proposedTitlePropertyName`, and Advanced Metadata
 * Cache's own dialog offers it. The unit tests cover the parking and the retirement against a published fake; only
 * a real provider can say that the envelope this plugin sends is one it actually accepts.
 *
 * - OK hands the name over (merged into the provider's list, the `Titles` module switched on) and retires the
 *   parked value, so the offer is never made again.
 * - Cancel writes nothing on either side: the value stays parked, to be offered on the next load.
 *
 * Cross-platform: the handover runs on a phone as much as on a desktop, and the dialog is the same modal. Split
 * across calls because one `evalInObsidian` is one `execute/sync`, which the transport caps at ~30s, and **the
 * waiting is done from Node**, since a budget declared inside a closure is one the cap can never honour.
 */

const PLUGIN_ID = 'alias-quick-switcher';
const PLUGIN_NAME = 'Alias Quick Switcher';

const ADVANCED_METADATA_CACHE_PLUGIN_ID = 'advanced-metadata-cache';

// What a fresh install of the provider has, which is what every other suite in this project was written against.
const DEFAULT_TITLE_PROPERTY_NAMES = ['title'];

const BUTTON_TEXT_CANCEL = 'Cancel';
const BUTTON_TEXT_OK = 'OK';

const DIALOG_TITLE = `Title properties proposed by ${PLUGIN_NAME}`;

const CENTRE_DIVISOR = 2;

const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

const WAIT_TIMEOUT_IN_MILLISECONDS = 60_000;

const STAMP_RANGE = 1000;

/**
 * Both sides of the handover, as each plugin holds it after the user answered.
 */
interface HandoverState {
  readonly isTitlesModuleEnabled: boolean;
  readonly proposedTitlePropertyName: unknown;
  readonly savedKeys: string[];
  readonly titlePropertyNames: string[];
}

/**
 * The provider's settings, as far as this suite reads and resets them.
 */
interface TitlesSettingsLike {
  isTitlesModuleEnabled: boolean;
  titlePropertyNames: string[];
}

/**
 * Presses one of the dialog's buttons with a trusted tap, and waits for the dialog to go.
 *
 * @param buttonText - The button's label.
 */
async function answerDialog(buttonText: string): Promise<void> {
  await pollInObsidian({
    input: { buttonText, centreDivisor: CENTRE_DIVISOR },
    poll(): boolean {
      return document.querySelector('.modal-container') === null;
    },
    async start({ buttonText: text, centreDivisor, lib: { clickElement } }): Promise<void> {
      const button = [...document.querySelectorAll('.modal-container button')].find((candidate) => candidate.textContent === text);
      if (!button?.instanceOf(HTMLElement)) {
        throw new TypeError(`The dialog has no ${text} button.`);
      }

      // `clickElement` taps the CENTRE and hit-tests nothing itself, so the centre has to be the button.
      const rect = button.getBoundingClientRect();
      const elementAtCentre = document.elementFromPoint(rect.left + rect.width / centreDivisor, rect.top + rect.height / centreDivisor);
      if (!button.contains(elementAtCentre)) {
        throw new Error(`The ${text} button's centre is covered, so a trusted tap would not reach it.`);
      }

      await clickElement({ element: button });
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: `the dialog did not close on ${buttonText}`,
    until: (isClosed: boolean): boolean => isClosed
  });
}

async function readHandoverState(): Promise<HandoverState> {
  return await evalInObsidian({
    async callback({ app, pluginId, providerPluginId }): Promise<HandoverState> {
      const plugin = app.plugins.getPlugin(pluginId);
      const provider = app.plugins.getPlugin(providerPluginId);
      if (!plugin || !provider) {
        throw new Error('A plugin of the handover is not enabled.');
      }

      const saved: unknown = await plugin.loadData();
      const savedRecord = typeof saved === 'object' && saved !== null ? saved : {};
      const providerSaved: unknown = await provider.loadData();
      const providerRecord = typeof providerSaved === 'object' && providerSaved !== null ? providerSaved : {};

      function readValue(record: object, key: string): unknown {
        return Object.entries(record).find(([entryKey]) => entryKey === key)?.[1];
      }

      const titlePropertyNames = readValue(providerRecord, 'titlePropertyNames');
      return {
        isTitlesModuleEnabled: readValue(providerRecord, 'isTitlesModuleEnabled') === true,
        proposedTitlePropertyName: readValue(savedRecord, 'proposedTitlePropertyName') ?? null,
        savedKeys: Object.keys(savedRecord),
        titlePropertyNames: Array.isArray(titlePropertyNames) ? titlePropertyNames.map(String) : []
      };
    },
    input: { pluginId: PLUGIN_ID, providerPluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID }
  });
}

/**
 * Puts both plugins back as every other suite in this project expects them: this plugin on the `data.json` it had
 * before, the provider on a fresh install's titles, and no dialog left up to sit over the suites after this one.
 *
 * @param previousData - What {@link stageLegacySettings} returned.
 */
async function restoreSettings(previousData: null | string): Promise<void> {
  await pollInObsidian({
    poll(): boolean {
      return document.querySelector('.modal-container') === null;
    },
    async start({ lib: { pressKey } }): Promise<void> {
      if (document.querySelector('.modal-container') !== null) {
        await pressKey({ key: 'Escape' });
      }
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'a dialog was left up and would not close',
    until: (isClosed: boolean): boolean => isClosed
  });

  await evalInObsidian({
    async callback({ app, pluginId, previousData: data }): Promise<void> {
      const dataPath = `${app.vault.configDir}/plugins/${pluginId}/data.json`;
      await app.plugins.disablePlugin(pluginId);
      if (data === null) {
        await app.vault.adapter.remove(dataPath);
      } else {
        await app.vault.adapter.write(dataPath, data);
      }
      await app.plugins.enablePlugin(pluginId);
    },
    input: { pluginId: PLUGIN_ID, previousData }
  });

  await setProviderTitles({ isTitlesModuleEnabled: false, titlePropertyNames: DEFAULT_TITLE_PROPERTY_NAMES });
}

async function setProviderTitles(titlesSettings: TitlesSettingsLike): Promise<void> {
  await evalInObsidian({
    async callback({ app, pluginId, titlesSettings: newSettings }): Promise<void> {
      interface SettingsEditor {
        editAndSave: (this: void, settingsEditor: (settings: TitlesSettingsLike) => void) => Promise<void>;
      }

      const plugin = app.plugins.getPlugin(pluginId);
      if (!plugin) {
        throw new Error('The provider is not enabled.');
      }

      // Read structurally rather than asserted through `unknown`: this reaches a member the plugin base keeps
      // protected, so a version that renamed it must fail loudly here rather than at the first property access.
      if (!('pluginSettingsComponent' in plugin)) {
        throw new Error('The provider exposes no settings component.');
      }

      const candidate: unknown = plugin.pluginSettingsComponent;
      if (typeof candidate !== 'object' || candidate === null || !('editAndSave' in candidate)) {
        throw new TypeError('The provider settings component cannot save.');
      }

      await (candidate as SettingsEditor).editAndSave((settings) => {
        settings.isTitlesModuleEnabled = newSettings.isTitlesModuleEnabled;
        settings.titlePropertyNames = newSettings.titlePropertyNames;
      });
    },
    input: { pluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID, titlesSettings }
  });
}

/**
 * Writes `data.json` as a release that still had the retired setting left it, and reloads this plugin onto it,
 * which is what an update does.
 *
 * @param extraLabelPropertyName - The retired setting's value.
 * @returns The `data.json` this plugin had before, for {@link restoreSettings}; `null` when there was none.
 */
async function stageLegacySettings(extraLabelPropertyName: string): Promise<null | string> {
  return await evalInObsidian({
    async callback({ app, extraLabelPropertyName: legacyValue, pluginId }): Promise<null | string> {
      const dataPath = `${app.vault.configDir}/plugins/${pluginId}/data.json`;
      const previous = await app.vault.adapter.exists(dataPath) ? await app.vault.adapter.read(dataPath) : null;
      await app.plugins.disablePlugin(pluginId);
      await app.vault.adapter.write(dataPath, JSON.stringify({ extraLabelPropertyName: legacyValue }));
      await app.plugins.enablePlugin(pluginId);
      return previous;
    },
    input: { extraLabelPropertyName, pluginId: PLUGIN_ID }
  });
}

async function waitForOffer(): Promise<void> {
  await pollInObsidian({
    poll(): string {
      return document.querySelector('.modal-container .modal-title')?.textContent ?? '';
    },
    timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
    timeoutMessage: 'the provider never offered the retired setting',
    until: (title: string): boolean => title === DIALOG_TITLE
  });
}

describe('The retired extra label property', () => {
  it('is handed over to Advanced Metadata Cache and retired when the user presses OK', async () => {
    const propertyName = `subtitle${Date.now().toString()}${Math.floor(Math.random() * STAMP_RANGE).toString()}`;

    const previousData = await stageLegacySettings(propertyName);
    try {
      await waitForOffer();
      await answerDialog(BUTTON_TEXT_OK);

      // The retirement is saved after the dialog resolves, so it is waited for rather than read straight away.
      await pollInObsidian({
        input: { pluginId: PLUGIN_ID },
        async poll({ app, pluginId }): Promise<boolean> {
          const saved: unknown = await app.plugins.getPlugin(pluginId)?.loadData();
          return typeof saved === 'object' && saved !== null
            && Object.entries(saved).every(([key, value]) => key !== 'proposedTitlePropertyName' || value === null);
        },
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the parked value was never retired',
        until: (isRetired: boolean): boolean => isRetired
      });

      const state = await readHandoverState();

      expect(state.proposedTitlePropertyName).toBeNull();
      // Merged, not replaced: the name a fresh install already reads survives the handover.
      expect(state.titlePropertyNames).toStrictEqual([...DEFAULT_TITLE_PROPERTY_NAMES, propertyName]);
      expect(state.isTitlesModuleEnabled).toBe(true);
      expect(state.savedKeys).not.toContain('extraLabelPropertyName');
    } finally {
      await restoreSettings(previousData);
    }
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('stays parked, and the provider untouched, when the user cancels', async () => {
    const propertyName = `subtitle${Date.now().toString()}${Math.floor(Math.random() * STAMP_RANGE).toString()}`;

    const previousData = await stageLegacySettings(propertyName);
    try {
      await waitForOffer();
      await answerDialog(BUTTON_TEXT_CANCEL);

      const state = await readHandoverState();

      expect(state.proposedTitlePropertyName).toBe(propertyName);
      expect(state.titlePropertyNames).toStrictEqual(DEFAULT_TITLE_PROPERTY_NAMES);
      expect(state.isTitlesModuleEnabled).toBe(false);
    } finally {
      await restoreSettings(previousData);
    }
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
