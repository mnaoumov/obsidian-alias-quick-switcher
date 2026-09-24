import type { PopulateFilesParams } from 'obsidian-integration-testing';

import { join } from 'node:path';
import process from 'node:process';
import { CODE_SCRIPT_TOOLKIT_PLUGIN_ID } from 'obsidian-dev-utils/script-utils/demo-vault-buttons';
import { getRootFolder } from 'obsidian-dev-utils/script-utils/root';
import { buildDemoVaultPopulateAsync } from 'obsidian-integration-testing';
import { createSetup } from 'obsidian-integration-testing/vitest-global-setup-plugin';

import {
  ADVANCED_METADATA_CACHE_PLUGIN_ID,
  ADVANCED_METADATA_CACHE_REPO,
  ADVANCED_METADATA_CACHE_VERSION
} from './helpers/advanced-metadata-cache-seed.ts';

// CodeScript Toolkit is what turns a ```code-button fence into a button, and its root-relative
// `require('/demoSetup.ts')` into a call. In real use the in-vault `demo-vault-helper` installs it from
// the community registry on first launch — a GUI step, and `.obsidian/plugins/*` is gitignored, so the
// installed copy exists on exactly the one machine that did it and is invisible to a fresh clone, a new
// machine or CI.
const CODE_SCRIPT_TOOLKIT_SETTINGS = {
  invocableScriptsFolder: 'Invocables',
  modulesRoot: '_assets/CodeScriptToolkit',
  shouldHandleProtocolUrls: true,
  startupScriptPath: 'startup.ts'
};

// The ASYNC builder, not the synchronous `buildDemoVaultPopulate`: the sync one requires the injected
// plugin's `main.js` / `manifest.json` to ALREADY be on disk and throws when they are not, so this whole
// project could not run at all in a checkout nobody had opened in a real Obsidian. The async sibling
// downloads the missing plugin's published release assets from the repository that Obsidian's own
// community registry names — the headless equivalent of the GUI step above. A warm checkout does no
// network I/O at all: an already-installed plugin is skipped.
async function populate(): Promise<PopulateFilesParams> {
  return await buildDemoVaultPopulateAsync({
    demoVaultPath: join(getRootFolder() ?? process.cwd(), 'demo-vault'),
    injectPlugins: [
      {
        data: CODE_SCRIPT_TOOLKIT_SETTINGS,
        pluginId: CODE_SCRIPT_TOOLKIT_PLUGIN_ID
      },
      // The dependency, which this plugin loads nothing without. Named by repository and pinned, rather than
      // resolved through the community registry the way CodeScript Toolkit is: the seeded copy must be the
      // same release every other project seeds. The vault's own startup script then finds it installed and
      // leaves it alone.
      {
        pluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID,
        repo: ADVANCED_METADATA_CACHE_REPO,
        version: ADVANCED_METADATA_CACHE_VERSION
      }
    ]
  });
}

// Pre-populates the whole `demo-vault/` tree (plus the CodeScript Toolkit binary and its settings)
// before Obsidian opens, so the startup scan indexes every note in one pass. Used by
// `integration-tests:demo-vault`.
const { setup, teardown } = createSetup({
  enableCommunityPlugins: [ADVANCED_METADATA_CACHE_PLUGIN_ID, CODE_SCRIPT_TOOLKIT_PLUGIN_ID],
  populate
});

export {
  setup,
  teardown
};
