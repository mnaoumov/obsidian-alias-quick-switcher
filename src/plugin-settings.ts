export class PluginSettings {
  /**
   * Paths matching any of these are never offered as results. Matched against the whole vault-relative
   * path, so a pattern can exclude a folder or a single note.
   */
  public excludedPathPatterns: readonly string[] = [];

  /**
   * An extra frontmatter property whose value is treated as a label alongside `aliases`, so a note or a
   * folder note can be reached by a display title that is not an alias.
   *
   * Empty means only `aliases` is consulted, which is what Obsidian itself considers an alias.
   */
  public extraLabelPropertyName = '';

  /**
   * How many recently-opened files rank above the rest when scores are otherwise tied. Zero turns the
   * recency tiebreak off entirely.
   */
  /* eslint-disable-next-line no-magic-numbers -- In plugin settings magic numbers are allowed. */
  public recentFilesBoostCount = 10;

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
