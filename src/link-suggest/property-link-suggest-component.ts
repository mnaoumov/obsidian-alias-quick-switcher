import type {
  App,
  EditorSuggest
} from 'obsidian';

import { ComponentEx } from '@mnaoumov/obsidian-lib/components/component-ex';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';

import type { LabelIndexComponent } from '../label-index/label-index-component.ts';

import { PropertyLinkSuggest } from './property-link-suggest.ts';

/**
 * Obsidian's editor-suggest manager, which the public API does not type. Measured on a real Obsidian 1.14:
 * `addSuggest` APPENDS to `suggests`, and the manager offers each keystroke to the suggesters in order and
 * stops at the first that triggers.
 */
interface EditorSuggestManager {
  readonly suggests: EditorSuggest<unknown>[];
}

interface PropertyLinkSuggestComponentConstructorParams {
  readonly app: App;
  readonly labelIndexComponent: LabelIndexComponent;
}

interface WorkspaceWithEditorSuggest {
  readonly editorSuggest: EditorSuggestManager;
}

/**
 * Puts {@link PropertyLinkSuggest} in front of the built-in `[[` suggester.
 *
 * `Plugin.registerEditorSuggest` would append it, behind the built-in one that triggers on every `[[`, so it
 * would never be asked. It goes FIRST instead, which takes nothing from the built-in: it declines every link
 * text that does not open with a property term, and the manager then asks the built-in as before.
 */
export class PropertyLinkSuggestComponent extends ComponentEx {
  private readonly app: App;
  private readonly labelIndexComponent: LabelIndexComponent;

  public constructor(params: PropertyLinkSuggestComponentConstructorParams) {
    super();
    this.app = params.app;
    this.labelIndexComponent = params.labelIndexComponent;
  }

  public override onload(): void {
    super.onload();

    const suggest = new PropertyLinkSuggest({
      app: this.app,
      labelIndex: this.labelIndexComponent.labelIndex,
      // The same once-per-session re-read the switcher does on opening, so a link target's title properties
      // are the ones `Advanced Metadata Cache` holds now.
      onSessionStart: (): void => {
        this.labelIndexComponent.refresh();
      }
    });
    const { suggests } = castTo<WorkspaceWithEditorSuggest>(this.app.workspace).editorSuggest;
    suggests.unshift(castTo<EditorSuggest<unknown>>(suggest));

    this.register(() => {
      suggest.close();
      suggests.remove(castTo<EditorSuggest<unknown>>(suggest));
    });
  }
}
