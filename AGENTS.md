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
- **The row is the BUILT-IN switcher's shape, measured off it rather than guessed at.** Obsidian already renders a leaf-alias hit, and `src/builtin-comparison.desktop-capture.integration.test.ts` puts the two side by side. Its markup is `suggestion-item mod-complex` > `suggestion-content` > `suggestion-title` + `suggestion-note`, with `suggestion-aux` > `suggestion-flair[aria-label="Alias"]` carrying a `lucide-forward` icon; the note line drops the markdown extension. This plugin uses all of it. Do not reintroduce private class names for these: Obsidian and every community theme style the built-in's classes, and a private copy gets no theme support at all — the stylesheet is 336 bytes because of this, and the only rule left in it is the folder icon, which the built-in has no equivalent of.
- **A leaf-only alias hit renders the alias ALONE.** That is the one match the built-in also makes, and rendering the whole path there would put `Alpha/Bravo/Echo` over `Alpha/Bravo/Charlie` — two strings one word apart, where the second line earns its space least. The full as-matched path is reserved for a hit that reached an ANCESTOR, which is the thing no other switcher can show. `isLeafOnlyAliasMatch` reads `match.positions`, not the candidate's, so a leaf satisfied by its real name is not caught by it.
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
- **A stale AVD boot snapshot kills the device mid-session, and the harness resumes one on every launch.** It passes `-no-snapshot-save` but never `-no-snapshot-load`, so `default_boot` is restored every time; when that snapshot has rotted the emulator boots, serves adb, accepts a uiautomator2 session, and then goes `offline` about a minute later. Because the error reported depends on which call was in flight, the same fault appears as a `POST /session` timeout, a `device offline`, or `Device ... was not in the list of connected devices` — which reads like four different problems. Proof is one A/B: resumed dies ~90 s in, `-no-snapshot-load` survives 240 s+. Fix it at the machine level, not in this repo — cold-boot the AVD, confirm it is healthy, then `adb -s emulator-5554 emu avd snapshot save default_boot`. Tracked as `T956`.
- **A zombie `qemu-system-x86_64-headless` is the first thing to check when the Android leg will not start.** The harness launches with `-no-window`, whose backend process is `qemu-system-x86_64-**headless**.exe`; its teardown kills the launcher, logs `Killed auto-started emulator`, and leaves that backend alive holding TCP 5554/5555 and the AVD's `multiinstance.lock`. Every later run then refuses with `FATAL | Running multiple emulators with the same AVD` — on the emulator's own stdout, which the harness discards — and reports a `POST /session` timeout instead. Self-perpetuating, since each failure leaves another zombie. Confirm with `Get-Process | Where-Object { $_.ProcessName -like 'qemu*' }` (note that filtering on `qemu-system-x86_64` alone does NOT match it), recover with `Stop-Process -Force`, `adb kill-server`, and deleting `~/.android/avd/obsidian_test.avd/multiinstance.lock` — but not `hardware-qemu.ini.lock`, which is a directory healthy AVDs have too. Then **let the harness boot its own emulator: do NOT pre-boot one**. A hand-started device is not adopted — the transport starts a second instance for the same AVD and collides with itself, failing with `Android emulator exited prematurely with code 1`. Tracked upstream as `T956` against `obsidian-integration-testing`.
- **`IntegrationSetupFailedError` is not a test failure and not a wedge — it is the Appium session never being created.** Every suite in the project fails in ~2 ms, the smoke test that only loads the plugin included, and the real error is one `WebDriverError: The operation was aborted due to timeout ... POST /session` far below the nine `FAIL` lines. If the smoke test is among the failures, read the setup error before reading anything else: no test ran, so nothing about the code is implicated. Seen when a capture run was still finishing on the same machine — a device leg and anything else heavy do not overlap.
- **`npm run test:integration` aborts at the first failing project, and the projects after it produce NO result.** The order is `no-app`, `demo-vault`, `android`, `desktop`, so an Android setup failure means the desktop suites never ran at all — their absence from the output is silence, not a pass. Count the `Test Files` blocks: four projects, four blocks. When the device leg is unreliable, run `test:integration:desktop` and `test:integration:android` separately so neither can hide the other.
