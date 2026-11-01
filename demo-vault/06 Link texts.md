# Link texts

A note is often called something other than its name in the links that point at it, and nobody ever adds that name to its `aliases`. This switcher finds a note by those link texts too. An attachment has no frontmatter at all, so the text of the embeds that show it is the only other name it can have.

## The fixture

This very note holds the links:

- [Kilo](<Alpha/Bravo/Charlie.md>), a markdown link to `Alpha/Bravo/Charlie.md` written as `Kilo`.
- An embed of `Materials/Sketch.png` with the caption `Whiteboard`:

![Whiteboard](<Materials/Sketch.png>)

Neither `Kilo` nor `Whiteboard` is an alias, a title or a file name.

## Find a note by a link text

```code-button
---
caption: Search Kilo
---
require('/demoSetup.ts').openSwitcherWithQuery(app, 'Kilo');
```

One row comes back: **Kilo** over `Alpha/Bravo/Charlie`. The marker on its right is a **link**, and its tooltip says `Link text`, so the row tells you it was found through a link rather than through a name the note was given.

A link text ranks below an alias or a title. If one note is aliased `Kilo` and another is only linked as `Kilo`, the aliased note comes first.

## Find an attachment by its caption

Attachments are offered only while non-markdown files are, which is off by default:

```code-button
---
caption: Offer non-markdown files
---
await require('/demoSetup.ts').setSetting(app, 'shouldIncludeNonMarkdownFiles', true);
```

```code-button
---
caption: Search Whiteboard
---
require('/demoSetup.ts').openSwitcherWithQuery(app, 'Whiteboard');
```

One row comes back: **Whiteboard** over `Materials/Sketch.png`.

## Turn it off

```code-button
---
caption: Stop matching link texts
---
await require('/demoSetup.ts').setSetting(app, 'shouldMatchLinkTexts', false);
```

Now neither `Kilo` nor `Whiteboard` finds anything. Put both settings back:

```code-button
---
caption: Restore the defaults
---
await require('/demoSetup.ts').setSetting(app, 'shouldMatchLinkTexts', true);
await require('/demoSetup.ts').setSetting(app, 'shouldIncludeNonMarkdownFiles', false);
```

The texts come from the **Link texts** module of **`Advanced Metadata Cache`**. It is on by default; while it is off, this switcher finds nothing by link texts whatever its own setting says.
