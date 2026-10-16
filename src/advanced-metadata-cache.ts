/**
 * @file
 *
 * `Advanced Metadata Cache`, the plugin this one cannot run without, as this plugin compiles against it.
 *
 * That plugin is an Obsidian plugin repo, not an npm package, so there is nothing to depend on. Its own copyable
 * `api.d.ts` and `api-contract.ts` are copied VERBATIM into `./advanced-metadata-cache-api/`, and everything here
 * narrows them to the members this plugin actually calls; `watchPluginApi` negotiates the version at runtime.
 * Refresh the copy from the provider's repository rather than editing it, so both ends keep checking ONE
 * definition.
 */

import type { TypedApiContract } from '@mnaoumov/typescript-lib/api-contract';

import type {
  AdvancedMetadataCacheApi as AdvancedMetadataCacheFullApi,
  AdvancedMetadataCacheMigratableSettings
} from './advanced-metadata-cache-api/api.d.ts';

import { ADVANCED_METADATA_CACHE_API_CONTRACT } from './advanced-metadata-cache-api/api-contract.ts';

export const ADVANCED_METADATA_CACHE_PLUGIN_ID = 'advanced-metadata-cache';

export const ADVANCED_METADATA_CACHE_PLUGIN_NAME = 'Advanced Metadata Cache';

/**
 * The contract version range this plugin compiled against. `getTitlePropertyNames` has been published since
 * contract `1.0.0`, the first one.
 */
export const ADVANCED_METADATA_CACHE_API_VERSION_RANGE = '^1';

/**
 * What the LABEL INDEX needs — the one read, published since contract `1.0.0`.
 *
 * Supplied to `watchPluginApi` as the consumer's own contract, which wins over the provider's, so the index
 * asks for exactly what it calls and nothing the migration below needs. The entry is the provider's own, schemas
 * included.
 */
export const ADVANCED_METADATA_CACHE_TITLES_API_CONTRACT: TypedApiContract<AdvancedMetadataCacheTitlesApi> = {
  getTitlePropertyNames: ADVANCED_METADATA_CACHE_API_CONTRACT.getTitlePropertyNames
};

/**
 * What the MIGRATION needs — the generic handover envelope, with the provider's own schemas.
 *
 * Contract `1.0.0` does not publish it. That is deliberate rather than a gap this plugin has to fill: against
 * such a provider the record fails this shape check, the ref stays `null`, and the offer simply waits in this
 * plugin's `data.json` until a provider that accepts it is installed. Asking for it in the dependency range
 * instead would refuse to RUN on every provider that exists today, to carry across one optional string.
 */
export const ADVANCED_METADATA_CACHE_MIGRATION_API_CONTRACT: TypedApiContract<AdvancedMetadataCacheMigrationApi> = {
  migrateSettings: ADVANCED_METADATA_CACHE_API_CONTRACT.migrateSettings
};

/**
 * The slice of `Advanced Metadata Cache`'s public API the label index calls.
 */
export type AdvancedMetadataCacheTitlesApi = Pick<AdvancedMetadataCacheFullApi, 'getTitlePropertyNames'>;

/**
 * The settings this plugin once owned and now proposes to `Advanced Metadata Cache`.
 *
 * Every member is optional, per the envelope's convention: a proposal carries only what was actually
 * configured, so a value the provider already owns is never overwritten by a default nobody chose. This plugin
 * only ever proposes one title property — the single extra label property it used to have — and the provider
 * decides how to merge it into its own list.
 */
export type MigratableSettings = AdvancedMetadataCacheMigratableSettings;

/**
 * The slice of `Advanced Metadata Cache`'s public API the settings handover calls.
 */
type AdvancedMetadataCacheMigrationApi = Pick<AdvancedMetadataCacheFullApi, 'migrateSettings'>;
