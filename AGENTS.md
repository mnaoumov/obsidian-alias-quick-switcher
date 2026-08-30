# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Alias Quick Switcher matches a path-shaped query segment by segment, where each segment may be satisfied by a real name **or** by an alias — the note's own aliases for the leaf, and the alias on a folder's folder note for an ancestor. Obsidian's built-in switcher scores a candidate as `max(fuzzy(query, path), fuzzy(query, alias))`, so path and aliases are separate match targets that are never combined; that is precisely the gap this plugin closes.

Measured against a real Obsidian 1.13.7 over CDP before any code was written: `Alpha/Bravo/Charlie`, `Alpha Bravo Charlie`, `Bravo Charlie` and `Echo` all match `Alpha/Bravo/Charlie.md`; `Alpha/Bravo/Echo`, `Alpha/Delta/Charlie` and `Alpha/Delta/Echo` return an empty list.

## Current state

**Scaffold only.** The command is registered and shows a notice; the matcher, the index and the modal are not written yet. `README.md` and the demo vault describe the plugin as it is being built to be, which is the same state `advanced-markdown-export` shipped its scaffold in — do not treat their claims as implemented behavior, and do not release until they are.

## Architecture

Two headless layers plus a modal. The bottom two carry all the correctness risk and are unit-testable with no DOM and no `App`.

- `src/label-index.ts` — `folderPath → labels[]` and `filePath → labels[]`, maintained incrementally off `metadataCache.on('changed')` and the vault's create/rename/delete events. Resolve the folder-note configuration **once** via ODU's `resolveFolderNoteConfig({ app })` and reuse it; never call `resolveFolderNote` per candidate per keystroke.
- `src/segment-matcher.ts` — a DP over (query token × path position). `/` is a hard segment boundary, whitespace a soft one; a position may absorb several whitespace-joined tokens, and positions may be skipped so a partial path matches. Returns a score **and** which label satisfied each position.
- `src/alias-quick-switcher-modal.ts` — `extends SuggestModal`, following `obsidian-link-picker`'s `LinkPickerModal`.

## Invariants that are easy to break

- **Never patch the built-in switcher.** A separate command is the whole interaction contract with the user (decision recorded 2026-08-30). Registering a second entry point, rebinding `Ctrl+O`, or monkey-patching `switcher.instance.onOpen` is a takeover by the back door.
- **The folder-note answer comes from ODU, live.** `FolderNoteLocation.Auto` reads the installed `folder-notes` plugin's own settings at every use. Do not copy those values into this plugin's settings — a copy goes stale the moment that plugin is reconfigured, and it would need a migration to seed.
- **Real names outrank aliases.** A result matched entirely by real names ranks above one that needed an alias, so the plugin never reorders the matches the built-in already produces.
- **Show which label satisfied each segment.** A row matched via `Alpha/Delta/Echo` must display that rendering with the real path beside it; without it the user cannot tell why a row matched.
- **Resolving a folder note never creates one.** A folder with no folder note is simply not offered.

## Performance, and why it is a first-class constraint

Measured on the vault this plugin was written for: 36,315 notes, 18,763 folders, 15,085 notes carrying `aliases`, and only 1,715 folders with a folder note. Two consequences that the implementation must not undo:

- "Only scan aliased notes" is **not** a useful prefilter — 42% of notes are aliased.
- 91% of ancestor positions have exactly one label, so the segment walk usually has no branching. Anything that makes every position do folder-note work per keystroke throws that away.

## Deviations from the standard plugin architecture

The workspace convention is that all plugins share the same architecture; intentional deviations are documented here.

- **None yet.**

## Traps to clear before the first release

- `dist/build/styles.css` currently builds to **0 bytes** (the scss holds only comments and an empty rule). A 0-byte asset makes `gh release create` fail with `HTTP 400: Bad Content-Length`, rolling the whole release back **after** the tag has been pushed. The modal will bring real CSS and fix this incidentally; if a release is ever cut before it, put a real rule in `src/styles/main.scss` first.
