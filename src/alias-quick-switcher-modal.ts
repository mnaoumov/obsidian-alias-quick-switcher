import type {
  App,
  TAbstractFile,
  TFile,
  TFolder
} from 'obsidian';

import {
  setIcon,
  SuggestModal
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { MARKDOWN_FILE_EXTENSION } from 'obsidian-dev-utils/obsidian/file-system';
import { PathSettings } from 'obsidian-dev-utils/obsidian/path-settings';
import { addPluginCssClasses } from 'obsidian-dev-utils/obsidian/plugin/plugin-context';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type { LabelIndex } from './label-index.ts';
import type {
  RankedCandidate,
  RankingMode
} from './ranking.ts';
import type {
  PathMatch,
  PathPosition,
  QueryToken
} from './segment-matcher.ts';

import { createCandidateComparator } from './ranking.ts';
import {
  matchPath,
  SegmentMatchMode,
  tokenizeQuery
} from './segment-matcher.ts';

/**
 * One thing the switcher can offer.
 */
export interface Suggestion {
  /**
   * The candidate behind the row, carrying its positions and the file a pick opens.
   */
  readonly candidate: Candidate;

  /**
   * How the query lay over the candidate, or `null` for the recently-opened list an empty query shows.
   */
  readonly match: null | PathMatch;

  /**
   * The candidate's own vault-relative path — the folder's path for a folder row.
   */
  readonly path: string;
}

/**
 * What the switcher reads out of the plugin's settings. Declared in full rather than derived from the
 * settings class, so the modal states its own needs and accepts the deep-readonly copy the settings
 * component hands out.
 */
export interface SwitcherSettings {
  /**
   * Paths matching any of these are never offered.
   */
  readonly excludedPathPatterns: readonly string[];

  /**
   * Which order results are shown in.
   */
  readonly rankingMode: RankingMode;

  /**
   * How many recently-opened files rank above the rest on a tie.
   */
  readonly recentFilesBoostCount: number;

  /**
   * How one query segment is tested against one name.
   */
  readonly segmentMatchMode: SegmentMatchMode;

  /**
   * Whether folders are offered, opening their folder note.
   */
  readonly shouldIncludeFolders: boolean;

  /**
   * Whether files that are not markdown notes are offered.
   */
  readonly shouldIncludeNonMarkdownFiles: boolean;
}

interface AliasQuickSwitcherModalConstructorParams {
  readonly app: App;
  readonly labelIndex: LabelIndex;
  readonly settings: SwitcherSettings;
}

/**
 * One thing the switcher may offer, with everything a keystroke needs already computed.
 *
 * Built once when the modal opens rather than per keystroke: at the scale this plugin was measured against
 * that is 36,315 of these, and rebuilding them on every key press is the difference between a switcher and
 * a stutter.
 */
interface Candidate {
  /**
   * The path as the SECOND LINE shows it — the real path with the markdown extension dropped, the way
   * Obsidian drops it everywhere else, and kept on any other file type where it is load-bearing.
   * Distinct from {@link Candidate.path}, which is what a pick opens, and from
   * {@link Candidate.plainPath}, which is what the rendering is compared against.
   */
  readonly displayPath: string;

  /**
   * Every name this candidate answers to, lower-cased and joined, for the pre-filter.
   */
  readonly haystack: string;

  readonly isFolder: boolean;

  /**
   * The file a pick opens — the folder note itself, for a folder row.
   */
  readonly openTarget: TFile;

  readonly path: string;

  /**
   * The candidate's path rendered from real names alone, which is what the row shows when nothing about
   * the match differs from it. Compared against rather than {@link Candidate.path} because the path
   * carries an extension and the rendering never does — comparing the two would put a redundant second
   * line under EVERY row.
   */
  readonly plainPath: string;

  /**
   * The candidate's path positions, outermost first.
   */
  readonly positions: readonly PathPosition[];
}

/**
 * A {@link Suggestion} that actually matched, so it can be ordered.
 */
interface MatchedSuggestion extends RankedCandidate {
  readonly candidate: Candidate;
}

/**
 * How many rows the modal shows. Obsidian's own switcher settles on a list of this order, and a longer one
 * is scrolling rather than choosing.
 */
const SUGGESTION_LIMIT = 50;

/**
 * The switcher itself.
 *
 * A plain {@link SuggestModal}, following `obsidian-link-picker`'s picker rather than subclassing
 * Obsidian's internal `QuickSwitcherModal`: the built-in switcher is never patched, never subclassed and
 * never rebound, so this is a second switcher the user opts into rather than a replacement of the one
 * their muscle memory already knows.
 */
export class AliasQuickSwitcherModal extends SuggestModal<Suggestion> {
  private candidates: readonly Candidate[] = [];
  private candidatesByPath = new Map<string, Candidate>();
  private excludedPaths = new PathSettings();
  private readonly labelIndex: LabelIndex;
  private readonly lastOpenFileIndexMap = new Map<string, number>();
  private readonly settings: SwitcherSettings;

  public constructor(params: AliasQuickSwitcherModalConstructorParams) {
    super(params.app);
    this.labelIndex = params.labelIndex;
    this.settings = params.settings;

    addPluginCssClasses(this.containerEl, 'alias-quick-switcher-modal');
    this.setPlaceholder('Type a path, an alias, or any mixture of the two');
    this.limit = SUGGESTION_LIMIT;
  }

  public getSuggestions(query: string): Suggestion[] {
    const tokens = tokenizeQuery(query);

    if (tokens.length === 0) {
      return this.collectRecentSuggestions();
    }

    const mode = this.settings.segmentMatchMode;
    const matched: MatchedSuggestion[] = [];

    for (const candidate of this.candidates) {
      if (!checkHaystack(candidate.haystack, tokens, mode)) {
        continue;
      }

      const match = matchPath({ mode, positions: candidate.positions, tokens });

      if (match) {
        matched.push({ candidate, match, path: candidate.path });
      }
    }

    matched.sort(createCandidateComparator({
      lastOpenFileIndexMap: this.lastOpenFileIndexMap,
      mode: this.settings.rankingMode
    }));

    return deduplicateByOpenTarget(matched);
  }

  public onChooseSuggestion(suggestion: Suggestion, event_: KeyboardEvent | MouseEvent): void {
    const shouldOpenInNewLeaf = event_.ctrlKey || event_.metaKey;
    invokeAsyncSafely(async () => {
      await this.app.workspace.getLeaf(shouldOpenInNewLeaf).openFile(suggestion.candidate.openTarget);
    });
  }

  public override onOpen(): void {
    this.excludedPaths = new PathSettings();
    this.excludedPaths.excludePaths = [...this.settings.excludedPathPatterns];
    this.rememberRecentFiles();
    this.candidates = this.buildCandidates();
    this.candidatesByPath = new Map(this.candidates.map((candidate) => [candidate.path, candidate]));
    super.onOpen();
  }

  public renderSuggestion(suggestion: Suggestion, el: HTMLElement): void {
    el.empty();

    // The row is the BUILT-IN switcher's own shape, measured off it rather than guessed at: a
    // `mod-complex` item holding `suggestion-content` > `suggestion-title` + `suggestion-note`, with the
    // Alias marker in `suggestion-aux` > `suggestion-flair`. Obsidian already renders an alias hit that
    // Way, so reusing the structure means this switcher inherits its styling — and every theme's — rather
    // Than carrying a private copy that no theme has ever seen.
    el.addClass('mod-complex');

    const contentEl = el.createDiv({ cls: 'suggestion-content' });
    const titleEl = contentEl.createDiv({ cls: 'suggestion-title' });

    if (suggestion.candidate.isFolder) {
      el.addClass('alias-quick-switcher-modal__folder');
      setIcon(titleEl.createSpan({ cls: 'alias-quick-switcher-modal__icon' }), 'lucide-folder');
    }

    const renderedPath = this.renderLabels(suggestion, titleEl);

    // The real path is shown ONLY when the rendering above is not already it. Repeating an identical path
    // Under itself is noise, while omitting a DIFFERENT one leaves the user unable to tell what they are
    // About to open — which is the whole point of the two-line row.
    if (renderedPath !== suggestion.candidate.plainPath) {
      contentEl.createDiv({ cls: 'suggestion-note', text: suggestion.candidate.displayPath });
    }

    // The same `lucide-forward` flair, with the same `Alias` label, that the built-in puts on an alias
    // Hit. Without it the two-line shape is the row's only signal that an alias was involved, which is a
    // Weaker one — and a different one from the marker the user already knows.
    if (wasAliasUsed(suggestion)) {
      const auxEl = el.createDiv({ cls: 'suggestion-aux' });
      setIcon(auxEl.createSpan({ attr: { 'aria-label': 'Alias' }, cls: 'suggestion-flair' }), 'lucide-forward');
    }
  }

  private buildAncestorPositions(abstractFile: TAbstractFile): PathPosition[] {
    const ancestors: TFolder[] = [];

    // The vault root is the one folder with no parent, and it is not a position: no query segment can name
    // It, because it contributes nothing to any vault-relative path.
    let current: null | TFolder = abstractFile.parent;
    while (current?.parent) {
      ancestors.unshift(current);
      current = current.parent;
    }

    return ancestors.map((ancestor) => ({ labels: this.labelIndex.getFolderLabels(ancestor) }));
  }

  private buildCandidates(): Candidate[] {
    const candidates: Candidate[] = [];

    // Asked for by type rather than filtered out of `getAllLoadedFiles()`, so neither loop carries a
    // "this is not the other kind" guard that nothing can ever take.
    for (const file of this.app.vault.getFiles()) {
      const candidate = this.buildFileCandidate(file);

      if (candidate) {
        candidates.push(candidate);
      }
    }

    if (this.settings.shouldIncludeFolders) {
      for (const folder of this.app.vault.getAllFolders()) {
        const candidate = this.buildFolderCandidate(folder);

        if (candidate) {
          candidates.push(candidate);
        }
      }
    }

    return candidates;
  }

  private buildFileCandidate(file: TFile): Candidate | null {
    if (this.excludedPaths.isPathIgnored(file.path)) {
      return null;
    }

    if (!this.settings.shouldIncludeNonMarkdownFiles && file.extension !== MARKDOWN_FILE_EXTENSION) {
      return null;
    }

    const positions = [...this.buildAncestorPositions(file), { labels: this.labelIndex.getFileLabels(file) }];
    const plainPath = buildPlainPath(positions);
    return {
      // A note's extension is noise the built-in never shows; any other file's is what tells the user
      // What they are about to open, so it stays. `plainPath` is already the path minus the extension —
      // Its leaf position is the file's basename — which is what makes this a choice rather than a strip.
      displayPath: file.extension === MARKDOWN_FILE_EXTENSION ? plainPath : file.path,
      haystack: buildHaystack(file.path, positions),
      isFolder: false,
      openTarget: file,
      path: file.path,
      plainPath,
      positions
    };
  }

  private buildFolderCandidate(folder: TFolder): Candidate | null {
    if (this.excludedPaths.isPathIgnored(folder.path)) {
      return null;
    }

    const folderNote = this.labelIndex.resolveFolderNote(folder);

    // A folder with no folder note is not offered. Picking it would have nothing to open, and resolving
    // Must never create the note that would give it something.
    if (!folderNote) {
      return null;
    }

    const positions = [...this.buildAncestorPositions(folder), { labels: this.labelIndex.getFolderLabels(folder) }];
    return {
      // A folder has no extension to drop, so the two are the same string.
      displayPath: folder.path,
      haystack: buildHaystack(folder.path, positions),
      isFolder: true,
      openTarget: folderNote,
      path: folder.path,
      plainPath: buildPlainPath(positions),
      positions
    };
  }

  private collectRecentSuggestions(): Suggestion[] {
    const suggestions: Suggestion[] = [];

    const seenPaths = new Set<string>();

    // A map rather than a scan per recent path: the candidate list is the whole vault, and the recent list
    // Is walked on every open. The base class caps what is rendered, so nothing is capped here.
    for (const path of this.app.workspace.recentFileTracker.lastOpenFiles) {
      const candidate = this.candidatesByPath.get(path);

      if (candidate && !seenPaths.has(path)) {
        seenPaths.add(path);
        suggestions.push({ candidate, match: null, path: candidate.path });
      }
    }

    return suggestions;
  }

  private rememberRecentFiles(): void {
    this.lastOpenFileIndexMap.clear();
    const recentPaths = this.app.workspace.recentFileTracker.lastOpenFiles.slice(0, this.settings.recentFilesBoostCount);

    for (const [index, recentPath] of recentPaths.entries()) {
      if (!this.lastOpenFileIndexMap.has(recentPath)) {
        this.lastOpenFileIndexMap.set(recentPath, index);
      }
    }
  }

  /**
   * Renders one row's path, position by position, with the label that satisfied each position in place of
   * its real name and the matched characters highlighted.
   *
   * @param suggestion - The row.
   * @param labelEl - The element to render into.
   * @returns The rendered path, so the caller can tell whether it differs from the real one.
   */
  private renderLabels(suggestion: Suggestion, labelEl: HTMLElement): string {
    const renderedParts: string[] = [];

    // A leaf-only alias hit renders the ALIAS ALONE, which is exactly what the built-in switcher does with
    // The same match. Rendering the whole path there would put `Alpha/Bravo/Echo` over
    // `Alpha/Bravo/Charlie` — two strings one word apart, where the second line earns its space least and
    // Reads as duplication. The full as-matched path is kept for the case that earns it: an ANCESTOR
    // Satisfied by an alias, which is the thing no other switcher can show.
    const firstRenderedIndex = isLeafOnlyAliasMatch(suggestion) ? suggestion.candidate.positions.length - 1 : 0;

    for (const [index, position] of suggestion.candidate.positions.entries()) {
      if (index < firstRenderedIndex) {
        continue;
      }

      if (index > firstRenderedIndex) {
        labelEl.appendText('/');
      }

      const positionMatch = suggestion.match?.positions[index] ?? null;
      const label = positionMatch?.label ?? readRealName(position);
      renderedParts.push(label);

      if (!positionMatch) {
        labelEl.appendText(label);
        continue;
      }

      let renderedUpTo = 0;

      for (const range of positionMatch.ranges) {
        labelEl.appendText(label.slice(renderedUpTo, range.startIndex));
        labelEl.createSpan({ cls: 'suggestion-highlight', text: label.slice(range.startIndex, range.startIndex + range.length) });
        renderedUpTo = range.startIndex + range.length;
      }

      labelEl.appendText(label.slice(renderedUpTo));
    }

    return renderedParts.join('/');
  }
}

function buildHaystack(path: string, positions: readonly PathPosition[]): string {
  const labelTexts = positions.flatMap((position) => position.labels.map((label) => label.text));
  return [path, ...labelTexts].join('\n').toLowerCase();
}

/**
 * Joins everything a candidate answers to into one lower-cased string, so the pre-filter is a handful of
 * substring tests rather than a walk over its positions and labels.
 *
 * @param path - The candidate's vault-relative path.
 * @param positions - Its positions.
 * @returns The haystack.
 */
/**
 * Renders a candidate's path from its real names alone.
 *
 * @param positions - The candidate's positions.
 * @returns The path as the row would render it with nothing matched.
 */
function buildPlainPath(positions: readonly PathPosition[]): string {
  return positions.map((position) => readRealName(position)).join('/');
}

/**
 * Rejects a candidate the query cannot possibly match, before the far more expensive walk runs.
 *
 * Sound rather than merely fast: every query token must be consumed by exactly one position, and a token
 * consumed by a position appears inside one of that position's labels — which are all in the haystack. So
 * a candidate rejected here could not have matched.
 *
 * @param haystack - The candidate's haystack.
 * @param tokens - The tokenized query.
 * @param mode - The per-segment match rule, which decides what "appears inside" means.
 * @returns `true` when the candidate is worth walking.
 */
function checkHaystack(haystack: string, tokens: readonly QueryToken[], mode: SegmentMatchMode): boolean {
  return tokens.every((token) => mode === SegmentMatchMode.Fuzzy ? checkSubsequence(haystack, token.text) : haystack.includes(token.text));
}

function checkSubsequence(haystack: string, token: string): boolean {
  let haystackIndex = 0;

  for (const character of token) {
    haystackIndex = haystack.indexOf(character, haystackIndex) + 1;

    if (haystackIndex === 0) {
      return false;
    }
  }

  return true;
}

/**
 * Drops rows that would open a file an earlier row already opens.
 *
 * A folder note is reachable twice on purpose — as a file by its own name, and as its folder by the
 * folder's name — so that both `Alpha/Bravo/Bravo` and `Delta` keep working. Only the ROWS are collapsed,
 * and the better-ranked of the two survives because the list is already sorted.
 *
 * @param suggestions - The matched rows, best first.
 * @returns The rows with duplicates of an already-offered target removed.
 */
function deduplicateByOpenTarget(suggestions: readonly MatchedSuggestion[]): Suggestion[] {
  const seenPaths = new Set<string>();
  const result: Suggestion[] = [];

  for (const suggestion of suggestions) {
    if (seenPaths.has(suggestion.candidate.openTarget.path)) {
      continue;
    }

    seenPaths.add(suggestion.candidate.openTarget.path);
    result.push(suggestion);
  }

  return result;
}

/**
 * Whether the ONLY position the query reached is the leaf, and an alias is what satisfied it — the exact
 * match the built-in switcher already makes, and renders as the alias alone.
 *
 * @param suggestion - The suggestion being rendered.
 * @returns Whether it is a leaf-only alias hit.
 */
function isLeafOnlyAliasMatch(suggestion: Suggestion): boolean {
  if (!suggestion.match) {
    return false;
  }

  const leafIndex = suggestion.candidate.positions.length - 1;

  // Read off `match.positions` rather than the candidate's, so a leaf satisfied by its REAL name — where
  // The rendering is already the plain path and there is nothing to explain — is not caught by this.
  if (!suggestion.match.positions[leafIndex]?.isAlias) {
    return false;
  }

  return suggestion.match.positions.every((positionMatch, index) => index === leafIndex || positionMatch === null);
}

/**
 * Reads a position's real name — always its first label, by construction.
 *
 * @param position - The position.
 * @returns Its real name.
 */
function readRealName(position: PathPosition): string {
  return ensureNonNullable(position.labels[0], 'Every position is built with its real name first').text;
}

/**
 * Whether any position was satisfied by an alias rather than by its real name. The condition the built-in
 * puts its flair on.
 *
 * @param suggestion - The suggestion being rendered.
 * @returns Whether an alias was used.
 */
function wasAliasUsed(suggestion: Suggestion): boolean {
  return suggestion.match?.positions.some((positionMatch) => positionMatch?.isAlias ?? false) ?? false;
}
