import type { Linter } from 'eslint';

import { defineEslintConfigs } from '@mnaoumov/obsidian-dev-toolkit/linters/eslint-config';
import {
  defineConfig,
  globalIgnores
} from 'eslint/config';

export const configs: Linter.Config[] = defineEslintConfigs({
  customConfigs() {
    return defineConfig(
      // A verbatim copy of `Advanced Metadata Cache`'s hand-written `api.d.ts`, refreshed from that repository rather
      // Than edited, so its style is the provider's to keep.
      globalIgnores(['src/advanced-metadata-cache-api/api.d.ts']),
      {
        rules: {
          'obsidianmd/ui/sentence-case': [
            'error',
            {
              brands: [
                'React',
                'Svelte'
              ]
            }
          ]
        }
      }
    );
  }
});
