import { createSetup } from 'obsidian-integration-testing/vitest-global-setup-plugin';

import {
  ADVANCED_METADATA_CACHE_PLUGIN_ID,
  getAdvancedMetadataCachePopulate
} from './helpers/advanced-metadata-cache-seed.ts';
import { generatePerformanceVault } from './helpers/generate-performance-vault.ts';

/**
 * Vitest global setup for the `integration-tests:desktop-performance` project: it pre-populates the vault
 * with a note tree at the scale the plugin was designed against before Obsidian opens it, so the startup
 * scan indexes everything in one pass.
 *
 * Advanced Metadata Cache is seeded alongside, as in every other project: this plugin declares it as a
 * dependency and loads nothing without it.
 */
export const { setup, teardown } = createSetup({
  enableCommunityPlugins: [ADVANCED_METADATA_CACHE_PLUGIN_ID],
  populate: async () => ({
    ...generatePerformanceVault(),
    ...await getAdvancedMetadataCachePopulate()
  })
});
