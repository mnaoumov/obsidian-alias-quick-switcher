# Properties

A code such as a language's ISO code is a property of a note, not a name for it. Turning it into an alias just to find the note clutters every place that shows aliases. This switcher can find a note by a property instead, using core Search's own property syntax.

## The fixture

The `Reference/` folder holds two notes:

- `Reference/Ukrainian.md`, with `isoCode: uk`.
- `Reference/English.md`, with `isoCode: en`.

## Find a note by its code

```code-button
---
caption: Search [isoCode:uk]
---
require('/demoSetup.ts').openSwitcherWithQuery(app, '[isoCode:uk]');
```

One row comes back: `Reference/Ukrainian`, the one note whose `isoCode` holds `uk`. Path text beside the term narrows the list further, as in `[isoCode:uk] Reference`.

Delete `uk` and type `u` instead. While you type a value, the values `isoCode` already holds across the vault are offered above the notes. Pick one to complete the term.

## Every note that has the property

```code-button
---
caption: Search [isoCode]
---
require('/demoSetup.ts').openSwitcherWithQuery(app, '[isoCode]');
```

Both notes come back, because a term with no value asks only that the property is there.

## Either value

```code-button
---
caption: Search [isoCode:uk OR en]
---
require('/demoSetup.ts').openSwitcherWithQuery(app, '[isoCode:uk OR en]');
```

`OR`, parentheses, double quotes for a whole word or a value with spaces (`[city:"San Miguel de Allende"]`), and `/regex/` all work the way they do in core Search.

## In a link

In any note, type `[[` and then the term, as in `[[[isoCode:uk]`, and pick `Ukrainian`. An ordinary link, `[[Ukrainian]]`, is inserted in your usual link format. The term itself never reaches the note, so the link keeps working in a vault without this plugin.
