# Matching

The fixture in this vault is one note in one folder:

- `Alpha/Bravo/Charlie.md`
  - aliased **Echo**.
- `Alpha/Bravo/Bravo.md`
  - the folder note for `Alpha/Bravo`, aliased **Delta**.

That gives the folder `Bravo` a second name, **Delta**, and the note `Charlie` a second name, **Echo**.

## What Obsidian already does

Open Obsidian's own quick switcher (`Ctrl/Cmd + O`) and try these. All four find the note:

- `Alpha/Bravo/Charlie`
- `Alpha Bravo Charlie`
- `Bravo Charlie`
- `Echo`

Now try these three. All three find **nothing**:

- `Alpha/Bravo/Echo`
- `Alpha/Delta/Charlie`
- `Alpha/Delta/Echo`

The built-in matches your query against the path **or** against an alias, and never against a mixture of the two. So the moment a query carries both path context and an alias, the match is lost — and a folder's alias is never consulted at all, because a folder is not something the built-in can match.

## What this plugin does

Run the command below and try the same seven queries. All seven find the note.

```code-button
---
caption: Open quick switcher
---
require('/demoSetup.ts').runCommand(app, 'open');
```

Manual equivalent: run the Command Palette entry **Alias Quick Switcher: Open quick switcher**, or give it a hotkey of your own.

Each segment of your query is matched against the real name **or** any alias of whatever sits at that position — the folder's folder note for an ancestor, the note itself for the last segment. Segments are separated by `/` or by spaces, and a partial path is enough, so `Delta/Echo` works too.

## Ranking

A result matched entirely by real names ranks above one that needed an alias. Type `Alpha/Bravo/Charlie` and the plain path match still comes first; the alias renderings only ever appear below it. So turning this switcher on never reshuffles the results you are already used to.

## Obsidian's own switcher is left alone

This plugin registers one command and patches nothing. `Ctrl/Cmd + O` keeps opening Obsidian's built-in switcher, so you can hold both and decide which one your hotkey opens.

## Folder notes

A folder has no frontmatter of its own, so its aliases live on its **folder note** — the note that describes the folder. This vault uses the default convention, `Alpha/Bravo/Bravo.md`, but the plugin does not assume it: if the [Folder notes](https://github.com/LostPaul/obsidian-folder-notes) plugin is installed, its live configuration decides which note belongs to a folder, including a custom name and whether the note sits inside the folder or beside it. Nothing is copied into this plugin's settings, so reconfiguring that plugin needs no migration here.
