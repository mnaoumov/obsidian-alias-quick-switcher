import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  TFile
} from 'obsidian';

import { FileCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/file-command-handler';
import { addAlias } from '@mnaoumov/obsidian-lib/file-manager';
import { isMarkdownFile } from '@mnaoumov/obsidian-lib/file-system';
import { prompt } from '@mnaoumov/obsidian-lib/modals/prompt';
import { parseFrontMatterAliases } from 'obsidian';

interface AddAliasCommandHandlerConstructorParams {
  readonly app: App;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Prompts for an alias and adds it to a note's `aliases` frontmatter.
 *
 * A file command rather than an editor one, so it is in the palette for any active markdown note, Reading view
 * included. When the active editor shows that same note, its selection seeds the prompt.
 */
export class AddAliasCommandHandler extends FileCommandHandler {
  private readonly app: App;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: AddAliasCommandHandlerConstructorParams) {
    super({
      icon: 'forward',
      id: 'add-alias',
      name: 'Add alias...'
    });
    this.app = params.app;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteFile(file: TFile): boolean {
    return isMarkdownFile(file);
  }

  // One prompt per note would be the multi-file answer, which nobody wants from a context menu.
  protected override canExecuteFiles(): boolean {
    return false;
  }

  protected override async executeFile(file: TFile): Promise<void> {
    const existingAliases = parseFrontMatterAliases(this.app.metadataCache.getFileCache(file)?.frontmatter) ?? [];

    const value = await prompt({
      app: this.app,
      defaultValue: this.getSelection(file),
      okButtonText: 'Add',
      placeholder: 'Alias',
      title: `Add alias to ${file.basename}`,
      valueValidator: (rawValue: string): string | undefined => {
        const alias = rawValue.trim();
        if (!alias) {
          return 'Enter an alias.';
        }

        if (alias === file.basename) {
          return 'That is the note\'s own name.';
        }

        return existingAliases.includes(alias) ? 'The note already has that alias.' : undefined;
      }
    });

    if (value === null) {
      return;
    }

    await addAlias({
      alias: value.trim(),
      app: this.app,
      pathOrFile: file,
      resourceLockComponent: this.resourceLockComponent
    });
  }

  private getSelection(file: TFile): string {
    const activeEditor = this.app.workspace.activeEditor;
    // An alias is one line, so a selection spanning several is folded into one.
    return activeEditor?.file === file && activeEditor.editor
      ? activeEditor.editor.getSelection().replaceAll(/\s+/g, ' ').trim()
      : '';
  }
}
