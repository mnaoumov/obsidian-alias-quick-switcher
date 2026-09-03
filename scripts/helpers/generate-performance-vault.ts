import type { PopulateFilesParams } from 'obsidian-integration-testing';

/**
 * The folder the whole generated tree hangs under, so the perf suite can address it without colliding with
 * anything the harness itself writes.
 */
export const PERFORMANCE_VAULT_FOLDER = 'big';

/**
 * The alias on the folder note of {@link TARGET_FOLDER}, and the alias on the note inside it. Together they
 * make `<folder alias>/<note alias>` a query that ONLY this plugin can answer — which is what the latency
 * test measures, rather than a query the built-in could have served just as fast.
 */
export const TARGET_FOLDER_ALIAS = 'ZuluFolderAlias';

/**
 * The alias on the target note itself.
 */
export const TARGET_NOTE_ALIAS = 'ZuluNoteAlias';

/**
 * Roughly the maintainer's real vault: 36,315 notes across 18,763 folders, 42% of them aliased, and only
 * 9% of folders carrying a folder note. Those three ratios are the measurement the whole design rests on,
 * so the generated vault reproduces them rather than picking round numbers.
 *
 * Overridable via `AQS_PERF_VAULT_SIZE` for bounded diagnostic runs.
 */
const DEFAULT_PERFORMANCE_VAULT_SIZE = 36_000;
const PERFORMANCE_VAULT_SIZE = Number(process.env['AQS_PERF_VAULT_SIZE']) || DEFAULT_PERFORMANCE_VAULT_SIZE;

/**
 * Two notes per folder, which lands the folder count in the same order as the notes count — the shape that
 * makes ancestor resolution expensive, and therefore the shape worth measuring.
 */
const FILES_PER_FOLDER = 2;

/**
 * Nine per cent of folders carry a folder note, as measured. This is the number that decides how much of
 * the segment walk branches at all: the other 91% of ancestor positions have exactly one label.
 */
const FOLDER_NOTE_EVERY_NTH_FOLDER = 11;

/**
 * Forty-two per cent of notes carry `aliases`, as measured — which is why "only scan aliased notes" is not
 * a useful pre-filter and the suite must not accidentally make it one.
 */
const ALIASED_EVERY_NTH_FILE = 5;
const ALIASED_OUT_OF = 12;

/**
 * The folder whose folder note is aliased, and which holds the aliased target note.
 */
const TARGET_FOLDER_INDEX = 7;

/**
 * The folder holding the target note, named the way the generator names every folder.
 */
const TARGET_FOLDER_NAME = `dir-${String(TARGET_FOLDER_INDEX)}`;

/**
 * Builds the file map for a vault at the scale the plugin was designed against, written to disk by
 * `TemporaryVault.populate()` before Obsidian opens it — so its startup scan indexes everything in one
 * pass, which is far faster and more reliable than writing notes after open and forcing a re-scan.
 *
 * @returns A map of vault-relative note paths to content.
 */
export function generatePerformanceVault(): PopulateFilesParams {
  const files: PopulateFilesParams = {};
  let written = 0;
  let folderIndex = 0;

  while (written < PERFORMANCE_VAULT_SIZE) {
    const folderName = `dir-${String(folderIndex)}`;
    const folderPath = `${PERFORMANCE_VAULT_FOLDER}/${folderName}`;

    if (folderIndex === TARGET_FOLDER_INDEX) {
      files[`${folderPath}/${folderName}.md`] = buildFrontmatter(TARGET_FOLDER_ALIAS);
      files[`${folderPath}/target.md`] = buildFrontmatter(TARGET_NOTE_ALIAS);
      written += FILES_PER_FOLDER;
    } else if (folderIndex % FOLDER_NOTE_EVERY_NTH_FOLDER === 0) {
      // A folder note named after its folder, under the default convention, aliased so the folder answers
      // To a second name the way the measured vault's do.
      files[`${folderPath}/${folderName}.md`] = buildFrontmatter(`alias-of-${folderName}`);
      written++;
    }

    for (let fileIndex = 0; fileIndex < FILES_PER_FOLDER && written < PERFORMANCE_VAULT_SIZE; fileIndex++) {
      const notePath = `${folderPath}/file-${String(fileIndex)}.md`;
      files[notePath] = written % ALIASED_OUT_OF < ALIASED_EVERY_NTH_FILE
        ? buildFrontmatter(`alias-${String(folderIndex)}-${String(fileIndex)}`)
        : 'body\n';
      written++;
    }

    folderIndex++;
  }

  return files;
}

function buildFrontmatter(alias: string): string {
  return `---\naliases:\n  - ${alias}\n---\n\nbody\n`;
}

/**
 * The folder note whose alias makes the target folder reachable, so a test can wait for its frontmatter
 * rather than hard-coding a path the generator owns.
 */
export const TARGET_FOLDER_NOTE_PATH = `${PERFORMANCE_VAULT_FOLDER}/${TARGET_FOLDER_NAME}/${TARGET_FOLDER_NAME}.md`;

/**
 * The target note itself.
 */
export const TARGET_NOTE_PATH = `${PERFORMANCE_VAULT_FOLDER}/${TARGET_FOLDER_NAME}/target.md`;
