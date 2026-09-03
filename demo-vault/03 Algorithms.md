# Algorithms

Two parts of the matching are yours to choose, because the sensible answers disagree about something real rather than cosmetic. Both live in **Settings -> Community plugins -> Alias Quick Switcher**, and the buttons below set them for you.

## Segment matching

`segmentMatchMode` decides how one segment of your query is tested against one name.

- `Substring` — the typed text has to appear inside the name as one unbroken run. `Alph/Brav/Charl` finds `Alpha/Bravo/Charlie`; `Brv` finds nothing. This is the rule [Link Picker](https://github.com/mnaoumov/obsidian-link-picker) uses, and it is the default: it is predictable, and it is cheap enough to run against a whole vault on every key press.
- `Fuzzy` — the typed characters only have to appear in order, the way Obsidian's own search works. `Brv` now finds `Bravo`. You find more, including things you did not mean, and every extra weak match has to be pushed back down by the ranking.

```code-button
---
caption: Use substring matching
---
await require('/demoSetup.ts').setSetting(app, 'segmentMatchMode', 'Substring');
```

```code-button
---
caption: Use fuzzy matching
---
await require('/demoSetup.ts').setSetting(app, 'segmentMatchMode', 'Fuzzy');
```

Try `Brv/Chrl` under each. A contiguous match still scores above a scattered one under `Fuzzy`, so turning it on never demotes a result you already had.

## Ranking

`rankingMode` decides what order the results come back in.

- `Tiered` — real names first. A result matched entirely by real names ranks above one that needed an alias, which is what guarantees this switcher never reshuffles the results Obsidian's own already gives you. The default.
- `LinkPicker` — how well the query matched decides everything, and an alias is just another name. This is the order Link Picker sorts by. Alias hits surface sooner, and the guarantee above is deliberately given up.

```code-button
---
caption: Use tiered ranking
---
await require('/demoSetup.ts').setSetting(app, 'rankingMode', 'Tiered');
```

```code-button
---
caption: Use link picker ranking
---
await require('/demoSetup.ts').setSetting(app, 'rankingMode', 'LinkPicker');
```

Type `Bravo` under each and watch where `Alpha/Bravo/Bravo` sits relative to the folder row that answers to `Delta`.

## Why they are settings at all

Neither pair has a right answer that holds for every vault. A vault where aliases are the real names — every folder note called `!`, say — is better served by ranking that treats an alias as an equal; a vault where aliases are occasional nicknames is better served by keeping them behind real names. Rather than pick one and defend it, the plugin ships both and lets the vault decide.
