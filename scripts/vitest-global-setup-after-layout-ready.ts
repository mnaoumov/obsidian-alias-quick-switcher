/**
 * @file
 *
 * The desktop suites with this plugin enabled after layout ready, as when a user enables it in settings.
 * Keep the dependency fixture and enable order aligned with the startup-timed global setup.
 */

import { createSetup } from 'obsidian-integration-testing/vitest-global-setup-plugin';

import {
  ADVANCED_METADATA_CACHE_PLUGIN_ID,
  getAdvancedMetadataCachePopulate
} from './helpers/advanced-metadata-cache-seed.ts';

export const { setup, teardown } = createSetup({
  enableCommunityPlugins: [ADVANCED_METADATA_CACHE_PLUGIN_ID],
  pluginEnableTiming: 'after-layout-ready',
  populate: getAdvancedMetadataCachePopulate
});
