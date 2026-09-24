import type { PluginManifest } from 'obsidian';
import type { PluginDependency } from 'obsidian-dev-utils/obsidian/components/plugin-gate-component';
import type { SettingsMigrationComponentConstructorParams } from 'obsidian-dev-utils/obsidian/components/settings-migration-component';
import type { PublishPluginApiParams } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';

import { Component } from 'obsidian';
import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { OpenDemoVaultCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/open-demo-vault-command-handler';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import { SettingsMigrationComponent } from 'obsidian-dev-utils/obsidian/components/settings-migration-component';
import { publishPluginApi } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { MigratableSettings } from './advanced-metadata-cache.ts';
import type { PluginSettings } from './plugin-settings.ts';

import { AliasQuickSwitcherComponent } from './alias-quick-switcher-component.ts';
import { LabelIndexComponent } from './label-index-component.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';

/*
 * The real `PluginBase` (from `obsidian-dev-utils`) drives the lifecycle here —
 * it is NOT mocked. `await plugin.onload()` registers the base's universal
 * components, runs the plugin's `onloadImpl`, then loads every queued child via
 * the real children-first lifecycle. Each child the plugin adds must therefore
 * be a real loadable `Component`, so every sibling/collaborator stub below that
 * is added as a child returns a real `Component`.
 */

// The shared command handler component is now constructed and registered by PluginBase itself, so the mock exposes the registerCommandHandlers spy the base calls at load.
const { registerCommandHandlers } = vi.hoisted(() => ({ registerCommandHandlers: vi.fn() }));

/**
 * The one setting these tests read through the stubbed settings component.
 */
type HandoverSettings = Pick<PluginSettings, 'proposedTitlePropertyName'>;

interface HoistedSettingsState {
  readonly settingsState: SettingsState;
}

/**
 * What the stubbed settings component answers, and every edit it was asked to save.
 */
interface SettingsState {
  editedSettings: HandoverSettings[];
  settings: HandoverSettings;
}

// A plain object, so `clearAllMocks` does not reset it; `beforeEach` puts it back.
const { settingsState } = vi.hoisted((): HoistedSettingsState => ({
  settingsState: {
    editedSettings: [],
    settings: { proposedTitlePropertyName: null }
  }
}));

vi.mock('obsidian-dev-utils/obsidian/command-handlers/command-handler-component', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a loadable Component exposing registerCommandHandlers.
  CommandHandlerComponent: vi.fn(function (): Component {
    return Object.assign(new Component(), { registerCommandHandlers });
  })
}));

vi.mock('obsidian-dev-utils/obsidian/active-file-provider', () => ({
  AppActiveFileProvider: vi.fn()
}));

// `PluginDataHandler` and `PluginEventSourceImpl` are NOT stubbed: since obsidian-dev-utils 93.2 the base
// builds its own settings component out of them during `onload`, and that component really calls
// `pluginEventSource.on`, so a bare `vi.fn()` double makes the base throw before `onloadImpl` runs.

vi.mock('obsidian-dev-utils/obsidian/command-registrar', () => ({
  PluginCommandRegistrar: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/components/plugin-settings-tab-component', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  PluginSettingsTabComponent: vi.fn(function () {
    return new Component();
  })
}));

vi.mock('obsidian-dev-utils/obsidian/components/settings-migration-component', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  SettingsMigrationComponent: vi.fn(function () {
    return new Component();
  })
}));

vi.mock('./plugin-settings-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  PluginSettingsComponent: vi.fn(function () {
    const component = Object.assign(new Component(), {
      editAndSave: (editor: (settings: HandoverSettings) => void): Promise<void> => {
        const edited = { ...settingsState.settings };
        editor(edited);
        settingsState.editedSettings.push(edited);
        return noopAsync();
      }
    });
    // Defined rather than assigned: `Object.assign` would read a getter once and copy the value, and the tests
    // change what the settings answer after the plugin has loaded.
    return Object.defineProperty(component, 'settings', { get: () => settingsState.settings });
  })
}));

vi.mock('./plugin-settings-tab.ts', () => ({
  PluginSettingsTab: vi.fn()
}));

vi.mock('./label-index-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  LabelIndexComponent: vi.fn(function (): Component {
    return new Component();
  })
}));

vi.mock('./alias-quick-switcher-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  AliasQuickSwitcherComponent: vi.fn(function () {
    return new Component();
  })
}));

// eslint-disable-next-line import-x/first, import-x/imports-first -- vi.mock must precede imports.
import { Plugin } from './plugin.ts';

// Where `strictProxy` keeps the object it wraps, so a test can seed a member the strict `App` mock has none of.
const STRICT_PROXY_TARGET_SYMBOL = Symbol.for('strictProxyTarget');

// `getPluginDependencies` is protected on the base, so a test reads it through a probe.
interface PluginDependenciesProbe {
  getPluginDependencies: () => PluginDependency[];
}

describe('Plugin', () => {
  let app: App;
  let manifest: PluginManifest;
  let providerComponent: Component;

  function getMigrationParams(): SettingsMigrationComponentConstructorParams<MigratableSettings> {
    const params = vi.mocked(SettingsMigrationComponent).mock.calls[0]?.[0];
    if (!params) {
      throw new Error('SettingsMigrationComponent was not constructed.');
    }

    return castTo<SettingsMigrationComponentConstructorParams<MigratableSettings>>(params);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    settingsState.editedSettings = [];
    settingsState.settings = { proposedTitlePropertyName: null };
    app = App.createConfigured__();
    const appOriginal = app.asOriginalType__();

    // What the dependency gate reaches when the dependency is missing: it registers a settings tab explaining
    // What to install. `obsidian-test-mocks` does not model `app.setting`.
    const rawApp = castTo<Partial<Record<symbol, object>>>(appOriginal)[STRICT_PROXY_TARGET_SYMBOL] ?? appOriginal;
    castTo<Record<string, unknown>>(rawApp)['setting'] = {
      addSettingTab: vi.fn(),
      removeSettingTab: vi.fn()
    };

    // Advanced Metadata Cache is a declared dependency, so the feature surface — everything these tests look at
    // — loads only once its API is published. An empty API is enough: the gate checks only that one is there, at
    // A matching version. Each test gets a fresh app, and with it a fresh registry.
    providerComponent = new Component();
    providerComponent.load();
    publishPluginApi({
      api: {},
      apiVersion: '1.0.0',
      component: providerComponent,
      plugin: castTo<PublishPluginApiParams<object>['plugin']>({ app: appOriginal, manifest: { id: 'advanced-metadata-cache' } })
    });

    // Fire layout-ready synchronously so the real lifecycle completes within the test.
    appOriginal.workspace.onLayoutReady = vi.fn((callback: () => void) => {
      callback();
    });

    manifest = {
      author: 'test',
      description: 'test',
      id: 'test-plugin',
      minAppVersion: '0.0.0',
      name: 'Test Plugin',
      version: '1.0.0'
    };
  });

  it('should wire up all child components on load', async () => {
    const appOriginal = app.asOriginalType__();
    const plugin = new Plugin(appOriginal, manifest);
    await plugin.onload();

    expect(plugin).toBeInstanceOf(Plugin);
    expect(PluginSettingsComponent).toHaveBeenCalledOnce();
    expect(PluginSettingsTab).toHaveBeenCalledOnce();
    expect(PluginSettingsTabComponent).toHaveBeenCalledOnce();
    expect(LabelIndexComponent).toHaveBeenCalledOnce();
    expect(AliasQuickSwitcherComponent).toHaveBeenCalledOnce();
  });

  it('should register the open demo vault command handler', async () => {
    const plugin = new Plugin(app.asOriginalType__(), manifest);
    await plugin.onload();

    // Since obsidian-dev-utils 89.0.0 the handlers are built lazily by a factory, and the base registers
    // its own batch through the same spy - so build every batch and look across them.
    const commandHandlers = registerCommandHandlers.mock.calls
      .flatMap(([commandHandlerFactory]) => castTo<() => unknown[]>(commandHandlerFactory)());
    expect(commandHandlers).toEqual(expect.arrayContaining([expect.any(OpenDemoVaultCommandHandler)]));
  });

  describe('Advanced Metadata Cache dependency', () => {
    it('should declare the plugin that owns the title properties as a dependency it cannot run without', () => {
      const plugin = new Plugin(app.asOriginalType__(), manifest);

      const [dependency, ...rest] = castTo<PluginDependenciesProbe>(plugin).getPluginDependencies();

      expect(rest).toEqual([]);
      expect(dependency?.pluginId).toBe('advanced-metadata-cache');
      expect(dependency?.pluginName).toBe('Advanced Metadata Cache');
      expect(dependency?.apiVersionRange).toBe('^1');
      expect(dependency?.reason).toContain('title properties');
    });

    it('should load nothing of its own while the dependency is missing', async () => {
      providerComponent.unload();
      const plugin = new Plugin(app.asOriginalType__(), manifest);

      await plugin.onload();

      expect(LabelIndexComponent).not.toHaveBeenCalled();
      expect(AliasQuickSwitcherComponent).not.toHaveBeenCalled();
      plugin.unload();
    });
  });

  describe('the extra label property handover', () => {
    it('should offer the parked value to Advanced Metadata Cache, as the one-entry list it now keeps', async () => {
      const plugin = new Plugin(app.asOriginalType__(), manifest);
      await plugin.onload();
      const params = getMigrationParams();

      expect(params.providerPluginId).toBe('advanced-metadata-cache');
      expect(params.sourcePluginId).toBe('test-plugin');
      // Only what migrating needs: the provider's first contract does not publish it, and asking for it in the
      // Dependency range instead would refuse to run against every provider that exists.
      expect(params.contract).toEqual({ migrateSettings: {} });

      expect(params.getProposedSettings()).toBeNull();
      settingsState.settings = { proposedTitlePropertyName: 'subtitle' };
      expect(params.getProposedSettings()).toEqual({ titlePropertyNames: ['subtitle'] });
    });

    it('should clear the parked value, persisted, once the user applies the migration', async () => {
      settingsState.settings = { proposedTitlePropertyName: 'subtitle' };
      const plugin = new Plugin(app.asOriginalType__(), manifest);
      await plugin.onload();

      await getMigrationParams().retireProposedSettings();

      expect(settingsState.editedSettings).toEqual([{ proposedTitlePropertyName: null }]);
    });
  });
});
