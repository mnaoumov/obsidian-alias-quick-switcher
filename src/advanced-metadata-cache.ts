/**
 * @file
 *
 * Advanced Metadata Cache, the plugin this one cannot run without, as this plugin compiles against it.
 *
 * The API is DECLARED here rather than imported. That plugin is an Obsidian plugin repo, not an npm package, so
 * there is nothing to depend on — the shape below is this plugin's compiled-against copy of the members it
 * actually calls, taken from that repo's own copyable `api.d.ts`, and `watchPluginApi` negotiates the version
 * at runtime.
 */

import type { PluginApiContract } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';
import type { SettingsMigrationApi } from 'obsidian-dev-utils/obsidian/plugin/settings-migration-api';

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
 * asks for exactly what it calls and nothing the migration below needs.
 */
export const ADVANCED_METADATA_CACHE_TITLES_API_CONTRACT: PluginApiContract = {
  getTitlePropertyNames: {}
};

/**
 * What the MIGRATION needs — the generic handover envelope.
 *
 * Contract `1.0.0` does not publish it. That is deliberate rather than a gap this plugin has to fill: against
 * such a provider the record fails this shape check, the ref stays `null`, and the offer simply waits in this
 * plugin's `data.json` until a provider that accepts it is installed. Asking for it in the dependency range
 * instead would refuse to RUN on every provider that exists today, to carry across one optional string.
 */
export const ADVANCED_METADATA_CACHE_MIGRATION_API_CONTRACT: PluginApiContract = {
  migrateSettings: {}
};

/**
 * Advanced Metadata Cache's public API, as far as this plugin uses it.
 */
export interface AdvancedMetadataCacheApi extends SettingsMigrationApi<MigratableSettings> {
  /**
   * The frontmatter properties whose values currently count as a note's title.
   *
   * @returns The configured property names, in the order they were typed. Empty while that plugin's `Titles`
   *   module is off, which is the same answer as "none are configured".
   */
  getTitlePropertyNames: () => string[];
}

/**
 * The settings this plugin once owned and now proposes to Advanced Metadata Cache.
 *
 * Every member is optional, per the envelope's convention: a proposal carries only what was actually
 * configured, so a value the provider already owns is never overwritten by a default nobody chose.
 */
export interface MigratableSettings {
  /**
   * Property names to count as titles. This plugin only ever proposes one — the single extra label property it
   * used to have — and the provider decides how to merge it into its own list.
   */
  readonly titlePropertyNames?: readonly string[];
}
