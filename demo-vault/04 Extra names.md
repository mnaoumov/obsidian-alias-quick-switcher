# Extra names

An alias is not the only place a note keeps a name. Plenty of vaults carry a display title in a frontmatter property — `title`, most often, written there by a template or by another plugin — and that name is invisible to every switcher, including this one, until you say which property to read.

`extraLabelPropertyName` is where you say it. Point it at a property and its value becomes another name the note answers to, in every segment of a path, ranked and rendered exactly as an alias is. Leave it empty and only `aliases` is consulted, which is what Obsidian itself considers an alias.

## The fixture already carries one

`Alpha/Bravo/Charlie.md` has both kinds of extra name on it:

- `aliases: [Echo]` — the alias the rest of this vault uses.
- `title: India` — an ordinary property, which nothing reads as a name yet.

So `Alpha/Delta/Echo` finds the note today and `Alpha/Delta/India` finds nothing, even though both are names the note is carrying.

## Turn it on

```code-button
---
caption: Read the title property as a name
---
await require('/demoSetup.ts').setSetting(app, 'extraLabelPropertyName', 'title');
```

Manual equivalent: set **Extra label property** to `title` in **Settings -> Community plugins -> Alias Quick Switcher**.

Now try the query the note was unreachable by:

```code-button
---
caption: Search Alpha/Delta/India
---
require('/demoSetup.ts').openSwitcherWithQuery(app, 'Alpha/Delta/India');
```

One row comes back: **Alpha/Delta/India** over `Alpha/Bravo/Charlie`. Two different kinds of name got it there — `Delta` is the folder's alias, `India` is the note's `title` — and the row says so.

## What the markers tell you

The row carries two markers on its right, in the order the names appear in the path:

- an **arrow**, Obsidian's own icon for the `aliases` property, for `Delta`;
- a **text glyph**, Obsidian's icon for a text property, for `India`.

Hover a marker on the desktop, or touch and hold it for a second on a phone, and the tooltip names what matched: `Alias` for the first, and the property's own key — `title` — for the second. One glyph stands for every property you could configure, so the tooltip is what tells you which one answered.

That distinction is the only thing separating a property from an alias. Everything else about the match is identical: `Alpha/Delta/India` ranks where `Alpha/Delta/Echo` ranks, and under the default `Tiered` ranking both still sit below a result matched by real names alone. Type `Alpha/Bravo/Charlie` and watch the plain path row keep its place.

## Turn it back off

```code-button
---
caption: Consult aliases only
---
await require('/demoSetup.ts').setSetting(app, 'extraLabelPropertyName', '');
```

`Alpha/Delta/India` stops finding anything and `Alpha/Delta/Echo` goes on working — the property is a name only while you are pointing at it.

One property at a time, and it applies to folder notes as well as notes: a folder whose folder note carries a `title` answers to it the same way `Alpha/Bravo` answers to `Delta`.
