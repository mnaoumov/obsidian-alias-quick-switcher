import type { MarkdownlintCli2ConfigurationSchema } from 'obsidian-dev-utils/script-utils/linters/markdownlint-types/@types/markdownlint-cli2-config-schema';

import { obsidianDevUtilsConfig } from 'obsidian-dev-utils/script-utils/linters/markdownlint-cli2-config';

export const config: MarkdownlintCli2ConfigurationSchema = {
  ...obsidianDevUtilsConfig,
  config: {
    ...obsidianDevUtilsConfig.config,
    'MD025': {
      // `MD025` counts a frontmatter `title` as the document's top-level heading, so a note carrying both
      // that property and an `# H1` is reported as having two. In an Obsidian vault that is simply wrong:
      // Obsidian titles a note by its FILENAME and does nothing at all with a `title` property - which is
      // exactly why this plugin can be pointed at one. The demo vault's fixture note therefore ships both,
      // deliberately, and the shared rule cannot tell that from a mistake.
      //
      // Emptying `front_matter_title` disables only the frontmatter half of the rule. Two `# H1`s in one
      // document are still reported, which is the half worth keeping.
      // eslint-disable-next-line camelcase -- That is how the option is spelled in markdownlint's own schema.
      front_matter_title: ''
    },
    // Turned on here, against the shared default of off: every paragraph in this repo's markdown is one
    // physical line, and this is what stops hard wrapping from coming back. The key has to live inside
    // `config` - the spread above replaces the whole object, so a key beside it would be silently ignored.
    'no-soft-break-in-paragraph': true
  }
};
