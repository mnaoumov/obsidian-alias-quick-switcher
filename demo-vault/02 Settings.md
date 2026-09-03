# Settings

Open **Settings -> Community plugins -> Alias Quick Switcher** to see the settings tab. Each option below lists the setting key stored in the plugin's `data.json`.

## What is matched

- `shouldIncludeFolders`
  - offer folders as results too, opening the folder note when one is picked. On by default: if your folder notes all share one name, the built-in switcher cannot reach any of them by name, and their aliases are the only handle you have. A folder with no folder note is never offered.
- `shouldIncludeNonMarkdownFiles`
  - offer files that are not markdown notes, the way Obsidian's own switcher does when asked.
- `excludedPathPatterns`
  - paths matching any of these are never offered. Matched against the whole vault-relative path, so a pattern can exclude a folder or a single note.

## What counts as a name

- `extraLabelPropertyName`
  - an extra frontmatter property treated as a label alongside `aliases`, so a note or a folder note can be reached by a display title that is not an alias. Leave it empty to consult only `aliases`, which is what Obsidian itself considers an alias.

## Algorithms

Both of these are explained, and demonstrated, in [03 Algorithms](<./03 Algorithms.md>).

- `segmentMatchMode`
  - how one segment of your query is tested against one name. `Substring` needs the typed text to appear as one unbroken run; `Fuzzy` only needs the characters in order, the way Obsidian's own search works.
- `rankingMode`
  - which order results come back in. `Tiered` puts real names before aliases; `LinkPicker` ranks purely by how well the query matched and treats an alias as just another name.

## Ranking

- `recentFilesBoostCount`
  - how many recently-opened files rank above the rest when scores are otherwise tied. Set it to zero to turn the recency tiebreak off entirely.

Under the default `Tiered` ranking, real names always outrank aliases — that is what keeps this switcher from reordering the results you already get from the built-in one. `LinkPicker` deliberately trades that guarantee away; see [03 Algorithms](<./03 Algorithms.md>).
