import process from 'node:process';
import { registerDemoVaultCoverageSuite } from 'obsidian-dev-utils/script-utils/demo-vault-coverage';
import { getRootFolder } from 'obsidian-dev-utils/script-utils/root';

// Keeps the in-repo `demo-vault/` in sync with the plugin's public surface WITHOUT
// Launching Obsidian: it reflects the real config from source and asserts every
// Setting is documented in a note, and that the guard note/member still exist
// (rename drift).
//
// The `Alpha/` notes are the fixture the plugin is demonstrated ON, not lessons about it, so they sit
// Outside the authoring checks - they deliberately carry aliases and no explanatory prose, because that
// Is exactly the shape the switcher has to resolve.
registerDemoVaultCoverageSuite({
  authoring: {
    excludedNotes: [
      'README.md',
      'Alpha/Bravo/Bravo.md',
      'Alpha/Bravo/Charlie.md'
    ]
  },
  configInterfaces: [{ interfaceName: 'PluginSettings', sourcePath: 'src/plugin-settings.ts' }],
  interfaces: [],
  nonTrivialGuard: {
    expectDemoNote: '02 Settings.md',
    expectMember: 'shouldIncludeFolders',
    interfaceName: 'PluginSettings',
    sourcePath: 'src/plugin-settings.ts'
  },
  rootFolder: getRootFolder() ?? process.cwd()
});
