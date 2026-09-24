/**
 * @file
 *
 * The global setup of the desktop and Android projects, and of the capture projects built from them:
 * `obsidian-integration-testing`'s own, plus Advanced Metadata Cache, which this plugin declares as a dependency
 * and cannot load without.
 *
 * The dependency is enabled after this plugin, so every run also drives the live path: this plugin loads
 * blocked, and finishes loading the moment its dependency's API appears.
 */

import { createSetup } from 'obsidian-integration-testing/vitest-global-setup-plugin';

import {
  ADVANCED_METADATA_CACHE_PLUGIN_ID,
  getAdvancedMetadataCachePopulate
} from './helpers/advanced-metadata-cache-seed.ts';

export const { setup, teardown } = createSetup({
  enableCommunityPlugins: [ADVANCED_METADATA_CACHE_PLUGIN_ID],
  populate: getAdvancedMetadataCachePopulate
});
