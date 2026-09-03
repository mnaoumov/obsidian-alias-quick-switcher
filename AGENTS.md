# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Alias Quick Switcher matches a path-shaped query segment by segment, where each segment may be satisfied by a real name **or** by an alias — the note's own aliases for the leaf, and the alias on a folder's folder note for an ancestor. Obsidian's built-in switcher scores a candidate as `max(fuzzy(query, path), fuzzy(query, alias))`, so path and aliases are separate match targets that are never combined; that is precisely the gap this plugin closes.

Measured against a real Obsidian 1.13.7 over CDP before any code was written: `Alpha/Bravo/Charlie`, `Alpha Bravo Charlie`, `Bravo Charlie` and `Echo` all match `Alpha/Bravo/Charlie.md`; `Alpha/Bravo/Echo`, `Alpha/Delta/Charlie` and `Alpha/Delta/Echo` return an empty list.

## Architecture

Two headless layers, an index component, and a modal. The headless layers carry all the correctness risk and are unit-testable with no DOM and no `App`.

- `src/segment-matcher.ts` — a DP over (query token × path position). `/` is a hard segment boundary, whitespace a soft one; a position may absorb several whitespace-joined tokens, and positions may be skipped so a partial path matches. Returns a score **and** which label satisfied each position.
- `src/ranking.ts` — the comparator that orders matched candidates, in either of the two `RankingMode`s.
- `src/label-index.ts` — `folderPath → labels` and `filePath → labels`, memoized on first use.
- `src/label-index-component.ts` — the index's lifecycle: it invalidates on `metadataCache` `changed` and the vault's create/rename/delete, and re-resolves the folder-note setup once per switcher open.
- `src/alias-quick-switcher-modal.ts` — `extends SuggestModal`, following `obsidian-link-picker`'s `LinkPickerModal`.

### Why the DP carries four things in its state, not two

Two of the ranking keys are not decided at the cell where the choice is made: whether a skipped position counts as a GAP depends on whether anything is consumed after it, and the tier depends on the leaf and the ancestors together. So the state is `(tokenIndex, positionIndex, pendingSkipCount, wasAncestorAliasUsed, leafKind)`. With those in the state every remaining key is additive or prefix-monotone, which is what makes keeping only the best prefix per state safe. Collapsing the state back to `(tokenIndex, positionIndex)` silently returns a worse match rather than failing.

## Invariants that are easy to break

- **Never patch the built-in switcher.** A separate command is the whole interaction contract with the user (decision recorded 2026-08-30). Registering a second entry point, rebinding `Ctrl+O`, or monkey-patching `switcher.instance.onOpen` is a takeover by the back door.
- **The folder-note answer comes from ODU, live.** `FolderNoteLocation.Auto` reads the installed `folder-notes` plugin's own settings at every use, and `LabelIndexComponent.refresh()` re-resolves it on every switcher open. Do not copy those values into this plugin's settings — a copy goes stale the moment that plugin is reconfigured, and it would need a migration to seed.
- **Real names outrank aliases — under the DEFAULT ranking.** `RankingMode.Tiered` is what makes the plugin never reorder the matches the built-in already produces, and it is the default for that reason. `RankingMode.LinkPicker` deliberately trades that guarantee for surfacing alias hits sooner. Changing which one is the default changes a promise the README makes.
- **Show which label satisfied each segment.** A row matched via `Alpha/Delta/Echo` displays that rendering, with the real path beneath it. The second line is compared against the candidate's PLAIN rendering, not against its path: the path carries an extension and the rendering never does, so comparing the two puts a redundant second line under every row.
- **Resolving a folder note never creates one.** A folder with no folder note is simply not offered.
- **A folder note is reachable twice on purpose** — as a file by its own name, and as its folder by the folder's name — so that both `Alpha/Bravo/Bravo` and `Delta` keep working. Only the ROWS are collapsed, by open target, after sorting.

## Performance, and why it is a first-class constraint

Measured on the vault this plugin was written for: 36,315 notes, 18,763 folders, 15,085 notes carrying `aliases`, and only 1,715 folders with a folder note. Three consequences the implementation must not undo:

- "Only scan aliased notes" is **not** a useful prefilter — 42% of notes are aliased.
- 91% of ancestor positions have exactly one label, so the segment walk usually has no branching. Anything that makes every position do folder-note work per keystroke throws that away.
- The label index memoizes lazily and is invalidated by events, so `resolveFolderNote` is called once per folder per switcher session — never per candidate per keystroke. `label-index.test.ts` asserts this by counting `resolveName` calls, and `switcher-latency.desktop-performance.integration.test.ts` measures the result at scale.

## Deviations from the standard plugin architecture

The workspace convention is that all plugins share the same architecture; intentional deviations are documented here.

- **None.**

## Testing notes

- The published `obsidian-test-mocks` has no `plugins` member on its strict `App`, and `resolveFolderNoteConfig` reads it. Tests assign one before use, the same way `obsidian-link-picker` does.
- `MetadataCache.setCache__` fires a `changed` event carrying **no file**, an event shape the real `MetadataCache` never emits. Tests write into `metadataCache.cache__` directly and then trigger the event they are actually about, with the arguments Obsidian really passes.
- The mock's `MetadataCache` re-parses a file's content on the vault's `create` event, so a hand-written cache entry is overwritten by it. A test about creation creates a real file instead.

### The screenshot capture suites

`npm run capture:screenshots` drives the switcher in a real Obsidian and writes
`images/screenshots/screenshot-desktop-N.png` (five frames) and `screenshot-mobile-N.png` (four), desktop
leg first because both legs share one machine. They exist because the two-line row is the one thing no
assertion can settle — whether it READS as an explanation — and they double as the community-store
listing shots.

- The suites are named `*.desktop-capture.` / `*.android-capture.` so they match **none** of the standard
  project globs: capturing opens a window and leaves a modal on screen to photograph it, which is not
  something `npm run test:integration` should ever do.
- The mobile leg runs on the **`obsidian_screenshots`** AVD, 900x1600 at density 320 — exactly the size the
  store asks for, so no crop or rescale. The shared `obsidian_test` AVD cannot stand in: it is 1344x2992,
  and resizing it at runtime recreates the activity and with it the WebView the session is attached to.
- **`labelScreenshot` needs `sharp`**, an optional peer of `obsidian-integration-testing`. Without it every
  frame fails at the caption step with `Cannot find package 'sharp'` — after the capture itself succeeded,
  so the failure looks unrelated to what actually went wrong.
- **A query that matches every segment whole highlights the entire first line**, which makes the highlight
  indistinguishable from its absence. Frame 5 uses `Alp/Del/Ech` for that reason: partial runs put
  highlighted and plain text side by side in the same word.
- **`labelScreenshot` draws its band across the bottom of the frame**, which on desktop is Obsidian's
  status bar but on a phone is the switcher's own search field — so the typed query is the one thing a
  mobile frame does not show in full. The rows above it are what the frame is evidence for; do not caption
  a mobile frame with something only the query could prove.

### Writing a `*.cross-platform.*` suite here

Both constraints below were found the hard way, by every one of the eight suites failing on the first Android run after all eight passed on desktop.

- **One `evalInObsidian` call is one `execute/sync`, and WebDriver caps a single script at 30 seconds.** A create-wait-open-type-assert flow fits inside that on a desktop and does not on a phone. Split the suite into several short calls and compute the stamp in the TEST, passing it in, so each call re-derives the same paths instead of carrying state across the boundary.
- **The harness's trusted-input helpers are Electron-only.** `pressKey` reaches for `remote` and throws on Android. The `no-untrusted-input-events` rule pushes towards it, which is right for a desktop-only suite and unusable for a cross-platform one. Dismiss a modal by clicking `.modal-bg` instead — a plain click is the one gesture that works on both.
- **A timed-out closure wedges the shared WebDriver session**, so every suite after it fails in ~45 ms with no useful error. When a run collapses like that, re-run the first failing file alone before believing anything about the ones behind it.
