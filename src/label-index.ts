/**
 * @file
 *
 * The `folderPath -> labels` and `filePath -> labels` index the switcher matches against.
 *
 * It exists for one measured reason. In the vault this plugin was written for there are 18,763 folders, so
 * resolving each candidate's ancestor folder notes while the user types would be 18,763 `resolveFolderNote`
 * calls PER KEYSTROKE. Every answer here is memoized on first use and invalidated by vault and metadata
 * events, so the work happens once per changed file rather than once per candidate per keystroke.
 *
 * Memoizing lazily rather than building eagerly also sidesteps the metadata cache not being populated when
 * a plugin loads: a label computed before the cache knows about a file would simply be wrong, whereas a
 * label computed on first use is computed against whatever the cache knows by then, and the `changed` event
 * invalidates it if that answer later improves.
 */

import type {
  App,
  FrontMatterCache,
  TFile,
  TFolder
} from 'obsidian';
import type { FolderNoteConfig } from 'obsidian-dev-utils/obsidian/folder-note';

import { parseFrontMatterAliases } from 'obsidian';
import { resolveFolderNote } from 'obsidian-dev-utils/obsidian/folder-note';

import type { Label } from './segment-matcher.ts';

/**
 * Constructor parameters for {@link LabelIndex}.
 */
export interface LabelIndexConstructorParams {
  /**
   * The Obsidian app instance whose vault is indexed.
   */
  readonly app: App;

  /**
   * An extra frontmatter property whose value is treated as a label alongside `aliases`. Empty means only
   * `aliases` is consulted.
   */
  readonly extraLabelPropertyName: string;

  /**
   * The already-resolved folder-note setup. Resolved by the caller so the whole index shares ONE answer
   * instead of asking per folder.
   */
  readonly folderNoteConfig: FolderNoteConfig;
}

/**
 * Answers what a file or folder is called, counting aliases.
 *
 * Every method is O(1) after the first call for a given path, which is the whole point — see the file
 * comment for the measurement that made it a requirement rather than an optimization.
 */
export class LabelIndex {
  private readonly app: App;
  private extraLabelPropertyName: string;
  private readonly fileLabels = new Map<string, readonly Label[]>();
  private readonly folderLabels = new Map<string, readonly Label[]>();
  private folderNoteConfig: FolderNoteConfig;

  public constructor(params: LabelIndexConstructorParams) {
    this.app = params.app;
    this.extraLabelPropertyName = params.extraLabelPropertyName;
    this.folderNoteConfig = params.folderNoteConfig;
  }

  /**
   * Forgets every memoized answer. Called when something that changes ALL answers changes — the
   * folder-note setup, or the extra-label property.
   */
  public clear(): void {
    this.fileLabels.clear();
    this.folderLabels.clear();
  }

  /**
   * Names a file: its basename, then its aliases.
   *
   * @param file - The file.
   * @returns Its labels, real name first.
   */
  public getFileLabels(file: TFile): readonly Label[] {
    const memoized = this.fileLabels.get(file.path);

    if (memoized) {
      return memoized;
    }

    const labels = deduplicateLabels([{ isAlias: false, text: file.basename }, ...this.readAliasLabels(file)]);
    this.fileLabels.set(file.path, labels);
    return labels;
  }

  /**
   * Names a folder: its own name, then the aliases on its folder note.
   *
   * A folder with no folder note answers with its real name alone. Resolving never creates a note.
   *
   * @param folder - The folder.
   * @returns Its labels, real name first.
   */
  public getFolderLabels(folder: TFolder): readonly Label[] {
    const memoized = this.folderLabels.get(folder.path);

    if (memoized) {
      return memoized;
    }

    const folderNote = resolveFolderNote({ app: this.app, config: this.folderNoteConfig, folder });
    const labels = deduplicateLabels([
      { isAlias: false, text: folder.name },
      ...(folderNote ? this.readAliasLabels(folderNote) : [])
    ]);
    this.folderLabels.set(folder.path, labels);
    return labels;
  }

  /**
   * Forgets what is known about one path, and about whatever else that path's existence answered for.
   *
   * @param path - The vault-relative path that changed, was created, or was deleted.
   */
  public invalidate(path: string): void {
    this.fileLabels.delete(path);
    this.folderLabels.delete(path);

    // A note is a candidate folder note for the folder it sits in AND — under the `ParentFolder` setup —
    // For a sibling folder. Neither relationship is knowable from the path alone once the file is gone, so
    // Both are dropped rather than resolved.
    const lastSlashIndex = path.lastIndexOf('/');
    const parentPath = lastSlashIndex === -1 ? '' : path.slice(0, lastSlashIndex);
    this.folderLabels.delete(parentPath);

    const lastDotIndex = path.lastIndexOf('.');
    if (lastDotIndex > lastSlashIndex) {
      this.folderLabels.delete(path.slice(0, lastDotIndex));
    }
  }

  /**
   * Forgets a whole subtree, for when a folder is renamed or deleted.
   *
   * @param path - The vault-relative path of the folder.
   */
  public invalidateSubtree(path: string): void {
    this.invalidate(path);

    const prefix = `${path}/`;
    for (const key of this.fileLabels.keys()) {
      if (key.startsWith(prefix)) {
        this.fileLabels.delete(key);
      }
    }

    for (const key of this.folderLabels.keys()) {
      if (key.startsWith(prefix)) {
        this.folderLabels.delete(key);
      }
    }
  }

  /**
   * Finds the folder note of a folder, using the setup this index already holds.
   *
   * Exposed because picking a folder in the switcher opens its folder note, and re-resolving the setup at
   * that point would be a second, possibly different answer to a question already settled.
   *
   * @param folder - The folder.
   * @returns Its folder note, or `null` when it has none.
   */
  public resolveFolderNote(folder: TFolder): null | TFile {
    return resolveFolderNote({ app: this.app, config: this.folderNoteConfig, folder });
  }

  /**
   * Sets the extra-label property, forgetting every memoized answer when it actually changes.
   *
   * @param extraLabelPropertyName - The new property name.
   */
  public setExtraLabelPropertyName(extraLabelPropertyName: string): void {
    if (this.extraLabelPropertyName === extraLabelPropertyName) {
      return;
    }

    this.extraLabelPropertyName = extraLabelPropertyName;
    this.clear();
  }

  /**
   * Adopts a freshly-resolved folder-note setup.
   *
   * The folder answers are dropped unconditionally rather than compared against the previous setup: the
   * setup's naming rule is a closure, so two setups cannot be compared for equality, and dropping is cheap
   * — the answers are rebuilt lazily, once per folder the user's next query actually walks.
   *
   * @param folderNoteConfig - The newly-resolved setup.
   */
  public setFolderNoteConfig(folderNoteConfig: FolderNoteConfig): void {
    this.folderNoteConfig = folderNoteConfig;
    this.folderLabels.clear();
  }

  private readAliasLabels(file: TFile): Label[] {
    const frontmatter: FrontMatterCache | undefined = this.app.metadataCache.getFileCache(file)?.frontmatter ?? undefined;
    const labels: Label[] = (parseFrontMatterAliases(frontmatter) ?? []).map((alias) => ({ isAlias: true, text: alias }));

    if (!this.extraLabelPropertyName) {
      return labels;
    }

    const rawExtraLabel: unknown = frontmatter?.[this.extraLabelPropertyName];

    for (const extraLabel of Array.isArray(rawExtraLabel) ? rawExtraLabel : [rawExtraLabel]) {
      if (typeof extraLabel === 'string' && extraLabel) {
        labels.push({ isAlias: true, text: extraLabel });
      }
    }

    return labels;
  }
}

/**
 * Drops labels that repeat one already in the list, case-insensitively.
 *
 * A note aliased with its own name, or twice with the same word in different casing, would otherwise render
 * as `Charlie -> Charlie` and be matchable twice at the same position for no gain.
 *
 * @param labels - The labels, real name first.
 * @returns The labels with repeats removed, order preserved.
 */
function deduplicateLabels(labels: readonly Label[]): readonly Label[] {
  const seen = new Set<string>();
  const result: Label[] = [];

  for (const label of labels) {
    const key = label.text.toLowerCase();

    if (!label.text || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(label);
  }

  return result;
}
