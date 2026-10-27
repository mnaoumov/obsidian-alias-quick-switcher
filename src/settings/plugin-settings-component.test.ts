import type { DataHandler } from '@mnaoumov/obsidian-lib/data-handler';
import type { PluginEventSource } from '@mnaoumov/obsidian-lib/plugin/plugin-event-source';
import type { AsyncEventRef } from '@mnaoumov/typescript-lib/async-events';

import { PluginSettingsComponentBase } from '@mnaoumov/obsidian-lib/components/plugin-settings-component';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettings } from './plugin-settings.ts';

/**
 * A settings component after loading a given `data.json`, and every record it wrote back.
 */
interface LoadedRecord {
  readonly component: PluginSettingsComponent;
  readonly saved: unknown[];
}

interface ProtectedBase {
  readonly registerValidator: (key: string, validator: unknown) => void;
  readonly registerValidators: () => void;
}

interface RegisteredValidator {
  readonly key: string;
  readonly validator: (value: number) => string | undefined;
}

const protectedBasePrototype = castTo<ProtectedBase>(PluginSettingsComponentBase.prototype);

describe('PluginSettingsComponent', () => {
  function createComponent(): PluginSettingsComponent {
    return new PluginSettingsComponent({
      dataHandler: strictProxy<DataHandler>({}),
      pluginEventSource: strictProxy<PluginEventSource>({})
    });
  }

  it('should create an instance', () => {
    const component = createComponent();
    expect(component).toBeInstanceOf(PluginSettingsComponent);
  });

  it('should create default PluginSettings as defaultSettings', () => {
    const component = createComponent();
    expect(component.defaultSettings).toBeInstanceOf(PluginSettings);
  });

  /*
   * The extra label property moved to `Advanced Metadata Cache`. A value the user had configured is PARKED for the
   * handover rather than dropped: dropping it would silently stop a title they relied on from matching.
   */
  describe('the retired extra label property', () => {
    async function loadRecord(record: Record<string, unknown>): Promise<LoadedRecord> {
      const saved: unknown[] = [];
      const component = new PluginSettingsComponent({
        dataHandler: strictProxy<DataHandler>({
          loadData: () => Promise.resolve(record),
          saveData: (data: unknown) => {
            saved.push(structuredClone(data));
            return noopAsync();
          }
        }),
        pluginEventSource: strictProxy<PluginEventSource>({
          on: (): AsyncEventRef => strictProxy<AsyncEventRef>({})
        })
      });
      await component.loadWithPromises();
      return { component, saved };
    }

    it('should park a configured value for the handover, and stop storing the old key', async () => {
      const { component, saved } = await loadRecord({ extraLabelPropertyName: 'subtitle' });

      expect(component.settings.proposedTitlePropertyName).toBe('subtitle');
      expect(saved.at(-1)).not.toHaveProperty('extraLabelPropertyName');
      expect(saved.at(-1)).toHaveProperty('proposedTitlePropertyName', 'subtitle');
    });

    it('should have nothing to hand over when the old key was left empty', async () => {
      const { component } = await loadRecord({ extraLabelPropertyName: '' });
      expect(component.settings.proposedTitlePropertyName).toBeNull();
    });
  });

  describe('registerValidators', () => {
    function getRegisteredValidators(): RegisteredValidator[] {
      const registered: RegisteredValidator[] = [];
      const registerValidatorSpy = vi.spyOn(protectedBasePrototype, 'registerValidator')
        .mockImplementation((key, validator) => {
          registered.push({
            key,
            validator: castTo<RegisteredValidator['validator']>(validator)
          });
        });
      const superSpy = vi.spyOn(protectedBasePrototype, 'registerValidators').mockImplementation(() => undefined);
      const component = createComponent();
      component['registerValidators']();
      registerValidatorSpy.mockRestore();
      superSpy.mockRestore();
      return registered;
    }

    it('should reject a negative recency tiebreak', () => {
      const validator = getRegisteredValidators().find((candidate) => candidate.key === 'recentFilesBoostCount');
      expect(validator).toBeDefined();
      expect(validator?.validator(-1)).toBe('The recency tiebreak cannot be negative');
    });

    it('should accept a recency tiebreak of zero or more', () => {
      const validator = getRegisteredValidators().find((candidate) => candidate.key === 'recentFilesBoostCount');
      expect(validator?.validator(0)).toBeUndefined();
    });
  });
});
