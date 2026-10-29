import type {
  App,
  TFile
} from 'obsidian';

import { getLinkpath } from 'obsidian';

import type { LabelIndex } from '../label-index/label-index.ts';
import type { PropertyFilterContext } from './property-filter.ts';

/**
 * Builds the vault-backed {@link PropertyFilterContext}.
 *
 * A link's target names come from the {@link LabelIndex}, so they are the same names the switcher itself
 * matches a note by — its basename, its aliases and its title properties — and are memoized the same way.
 *
 * @param app - The Obsidian app.
 * @param labelIndex - The index that names a link's target.
 * @returns The context.
 */
export function createPropertyFilterContext(app: App, labelIndex: LabelIndex): PropertyFilterContext {
  return {
    getFrontmatter: (file: TFile) => app.metadataCache.getFileCache(file)?.frontmatter,
    getLinkTargetNames: (file: TFile, key: string): readonly string[] => {
      const names: string[] = [];

      // The cache keys a list element's link as `key.<index>`; a nested object's as `key.<child>`, which core
      // Search does not search and neither does this.
      for (const frontmatterLink of app.metadataCache.getFileCache(file)?.frontmatterLinks ?? []) {
        if (frontmatterLink.key !== key && !checkIsListElementKey(frontmatterLink.key, key)) {
          continue;
        }

        const target = app.metadataCache.getFirstLinkpathDest(getLinkpath(frontmatterLink.link), file.path);

        if (target) {
          names.push(...labelIndex.getFileLabels(target).map((label) => label.text));
        }
      }

      return names;
    }
  };
}

function checkIsListElementKey(linkKey: string, key: string): boolean {
  return linkKey.startsWith(`${key}.`) && /^\d+$/.test(linkKey.slice(key.length + 1));
}
