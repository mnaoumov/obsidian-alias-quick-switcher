/**
 * @file
 *
 * Seeds Advanced Metadata Cache into an integration vault, because this plugin declares it as a dependency and
 * loads nothing of its own until it is there.
 *
 * Without it every suite would meet this plugin blocked — no command, no switcher, no settings — and fail on
 * something that has nothing to do with what it tests. So every project that opens a vault seeds it: the plain
 * desktop and Android projects and the capture projects through `scripts/vitest-global-setup.ts`, and the
 * demo-vault and performance projects through their own setups.
 *
 * The seeded copy is the RELEASED build, pinned, for the reason `download-released-plugin.ts` gives: it is what a
 * user installs, and a test that follows a moving artifact stops being a statement about anything.
 *
 * No `data.json` is seeded. That plugin's defaults are what a fresh install has — its `Titles` module OFF — and
 * that is exactly the vault this plugin's suites were written against: aliases only. A suite about title
 * properties switches the module on itself and puts it back.
 */

import type { PopulateFilesParams } from 'obsidian-integration-testing';

import { downloadReleasedPlugin } from './download-released-plugin.ts';

/**
 * The dependency's `manifest.id`, which is also the folder it is seeded into.
 */
export const ADVANCED_METADATA_CACHE_PLUGIN_ID = 'advanced-metadata-cache';

/**
 * The release seeded. `1.0.0` publishes contract `1.0.0`, which carries `getTitlePropertyNames`.
 */
export const ADVANCED_METADATA_CACHE_VERSION = '1.0.0';

/**
 * The repository publishing that release.
 */
export const ADVANCED_METADATA_CACHE_REPO = 'mnaoumov/obsidian-advanced-metadata-cache';

// Every vault the harness opens keeps its configuration in the default folder.
const VAULT_CONFIG_FOLDER = '.obsidian';

/**
 * Builds the files that install the dependency into a vault.
 *
 * @returns The populate map.
 */
export async function getAdvancedMetadataCachePopulate(): Promise<PopulateFilesParams> {
  const files = await downloadReleasedPlugin({
    pluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID,
    repo: ADVANCED_METADATA_CACHE_REPO,
    version: ADVANCED_METADATA_CACHE_VERSION
  });

  const pluginFolder = `${VAULT_CONFIG_FOLDER}/plugins/${ADVANCED_METADATA_CACHE_PLUGIN_ID}`;
  return {
    [`${pluginFolder}/main.js`]: files.mainJs,
    [`${pluginFolder}/manifest.json`]: files.manifestJson
  };
}
