import { registerDemoVaultCoverageSuite } from '@mnaoumov/obsidian-dev-toolkit/demo-vault-coverage';
import { getRootFolder } from '@mnaoumov/typescript-dev-toolkit/root';
import process from 'node:process';

// Keeps the in-repo `demo-vault/` in sync with the plugin's public surface WITHOUT
// launching Obsidian: it reflects the real config from source and asserts every
// setting is documented in a note, and that the guard note/member still exist
// (rename drift).
//
// The `Alpha/` and `Reference/` notes are the fixture the plugin is demonstrated ON, not lessons about it, so they sit
// outside the authoring checks - they deliberately carry aliases and no explanatory prose, because that
// is exactly the shape the switcher has to resolve.
registerDemoVaultCoverageSuite({
  authoring: {
    excludedNotes: [
      'README.md',
      'Alpha/Bravo/Bravo.md',
      'Alpha/Bravo/Charlie.md',
      'Reference/English.md',
      'Reference/Ukrainian.md'
    ]
  },
  configInterfaces: [{ interfaceName: 'PluginSettings', sourcePath: 'src/settings/plugin-settings.ts' }],
  interfaces: [],
  nonTrivialGuard: {
    expectDemoNote: '02 Settings.md',
    expectMember: 'shouldIncludeFolders',
    interfaceName: 'PluginSettings',
    sourcePath: 'src/settings/plugin-settings.ts'
  },
  rootFolder: getRootFolder() ?? process.cwd()
});
