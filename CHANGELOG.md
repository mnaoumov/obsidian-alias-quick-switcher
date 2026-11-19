# CHANGELOG

## 2.2.1

This release has 4 documentation changes. 7 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Documentation

- **changelog:** rewrite the 2.1.0 release notes for readers
- **changelog:** regroup the published release notes for readers
- make issue attachments optional and strongly encouraged
- link to the Obsidian resources page

## 2.2.0

This release has 4 new features and 4 documentation changes. 9 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- add an Add alias command, seeded with the editor selection
- find a file by the link texts that point at it
- add a Report a bug command
- find notes by property in the switcher and the [[ link suggester

### Documentation

- **readme:** point bug reports at the Report a bug command
- add issue-filing instructions for AI agents
- **readme:** combine related resources and plugin comparisons
- **readme:** list similar plugins

## 2.1.2

This release has 1 fix and 2 documentation changes. 4 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- **demo-vault:** load the demo setup helpers from @mnaoumov/obsidian-lib

### Documentation

- shorten the debugging section
- **readme:** lead the Debugging section with `Advanced Debug Mode`

## 2.1.1

This release has 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Documentation

- **changelog:** add the 2.1.0 excluded paths migration note

## 2.1.0

This release has 1 new feature, 1 fix and 3 documentation changes. 7 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

Migration: excluded-path entries now match case-insensitively in every form. An unescaped `*`, `?` or `[` makes an entry a glob (`*.pdf`, `Archive/**/Draft*`, `tmp*/`), so a plain path that contains one of those characters literally must escape it (`Notes \[old\]`). An entry shaped `/pattern/flags` is a regular expression whose flags are honoured, and a folder-only glob (ending in `/`) hides the folder row itself as well as its contents.

### New

- match excluded paths case-insensitively, with globs and regex flags

### Fixed

- **settings:** mark plugin names as code in the settings tab

### Documentation

- mark plugin names as code
- **readme:** point the install line at the community directory listing
- **agents:** restate the registry invariant now that 2.0.0 carries the dependency

## 2.0.0

This release has 1 breaking change, 1 new feature, 3 fixes and 8 documentation changes. 23 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Breaking changes

- merge taking the title properties from `Advanced Metadata Cache`

### New

- say which kind of name matched, with the property's own marker

### Fixed

- **test:** merge the headless demo-vault toolkit install
- **deps:** restore the lockfile's missing resolved and integrity fields
- **deps:** float devalue to 5.9.4, clearing GHSA-9rgm-9g3h-6x36

### Documentation

- **test:** merge pointing the dead TARGET_FOLDER link at TARGET_FOLDER_NAME
- **demo-vault:** demonstrate the extra label property, and frame its marker
- **test:** replace the withdrawn Electron-only premise on the query typing
- replace the private rule-id citations with what they assert
- name the library and the sibling plugins so a reader can resolve them
- bring the README onto the standard plugin README layout
- **readme:** add the Coverage 100% badge
- **readme:** add the screenshot block, and put the demo vault first

## 1.0.0

This release has 3 new features and 3 fixes. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- the built-in switcher's row, on `obsidian-dev-utils` 100, ready for 1.0.0
- match aliases in every path segment, and show which one matched
- scaffold `Alias Quick Switcher`

### Fixed

- **build:** wire build:compile to buildCompile and drop the duplicate leaf script
- **deps:** move to `obsidian-integration-testing` 11 and `obsidian-dev-utils` 96.5.2
- **deps:** drop the brace-expansion file: override that breaks a clean install
