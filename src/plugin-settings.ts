import { RankingMode } from './ranking.ts';
import { SegmentMatchMode } from './segment-matcher.ts';

export class PluginSettings {
  /**
   * Paths matching any of these are never offered as results. Matched against the whole vault-relative
   * path, so a pattern can exclude a folder or a single note. An entry wrapped in `/` is a regular
   * expression; every other entry is a plain path.
   */
  public excludedPathPatterns: string[] = [];

  /**
   * The extra label property a user configured before Advanced Metadata Cache took the setting over, waiting to
   * be proposed to it.
   *
   * Not a setting anyone edits: it is filled once, from the retired `extraLabelPropertyName`, and cleared only
   * when the user applies the migration in that plugin's dialog. `null` means there is nothing to hand over.
   */
  public proposedTitlePropertyName: null | string = null;

  /**
   * Which order matching results are shown in.
   *
   * @default {@link RankingMode.Tiered}
   */
  public rankingMode: RankingMode = RankingMode.Tiered;

  /**
   * How many recently-opened files rank above the rest when scores are otherwise tied. Zero turns the
   * recency tiebreak off entirely.
   */
  /* eslint-disable-next-line no-magic-numbers -- In plugin settings magic numbers are allowed. */
  public recentFilesBoostCount = 10;

  /**
   * How one segment of the query is tested against one name.
   *
   * @default {@link SegmentMatchMode.Substring}
   */
  public segmentMatchMode: SegmentMatchMode = SegmentMatchMode.Substring;

  /**
   * Whether folders themselves appear as results, opening their folder note when picked.
   *
   * On by default: in a vault whose folder notes all share one name, the folder note is unreachable by
   * name and its folder's alias is the only handle on it.
   */
  public shouldIncludeFolders = true;

  /**
   * Whether non-markdown files are offered too, the way Obsidian's own switcher does when asked.
   */
  public shouldIncludeNonMarkdownFiles = false;
}
