import type {
  App as AppOriginal,
  EditorSuggest
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { LabelIndexComponent } from '../label-index/label-index-component.ts';
import { PropertyLinkSuggestComponent } from './property-link-suggest-component.ts';
import { PropertyLinkSuggest } from './property-link-suggest.ts';

interface EditorSuggestManagerLike {
  readonly suggests: EditorSuggest<unknown>[];
}

interface WorkspaceWithEditorSuggest {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup installs the manager the mock lacks.
  editorSuggest: EditorSuggestManagerLike;
}

let app: AppOriginal;
let builtInSuggest: EditorSuggest<unknown>;
let suggests: EditorSuggest<unknown>[];

beforeEach(async () => {
  const { App: AppMock } = await import('obsidian-test-mocks/obsidian');
  app = AppMock.createConfigured__({ files: { 'Note.md': '---\nisoCode: uk\n---\n' } }).asOriginalType__();
  builtInSuggest = castTo<EditorSuggest<unknown>>({ name: 'built-in' });
  suggests = [builtInSuggest];
  castTo<WorkspaceWithEditorSuggest>(app.workspace).editorSuggest = { suggests };
});

describe('PropertyLinkSuggestComponent', () => {
  it('should put its suggester in front of the built-in one, which the manager would otherwise ask first', () => {
    createComponent().load();
    expect(suggests).toHaveLength(2);
    expect(suggests[0]).toBeInstanceOf(PropertyLinkSuggest);
    expect(suggests[1]).toBe(builtInSuggest);
  });

  it('should take its suggester out again, and close it, on unload', () => {
    const closeSpy = vi.spyOn(PropertyLinkSuggest.prototype, 'close');
    const component = createComponent();
    component.load();
    component.unload();
    expect(suggests).toStrictEqual([builtInSuggest]);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('should refresh the label index when a suggester session starts', () => {
    const labelIndexComponent = new LabelIndexComponent({ app });
    const refreshSpy = vi.spyOn(labelIndexComponent, 'refresh');
    new PropertyLinkSuggestComponent({ app, labelIndexComponent }).load();
    const suggest = castTo<PropertyLinkSuggest>(suggests[0]);
    const editor = { getLine: (): string => '[[[isoCode:u' };
    suggest.onTrigger({ ch: 12, line: 0 }, castTo<Parameters<PropertyLinkSuggest['onTrigger']>[1]>(editor));
    expect(refreshSpy).toHaveBeenCalledOnce();
  });
});

function createComponent(): PropertyLinkSuggestComponent {
  return new PropertyLinkSuggestComponent({ app, labelIndexComponent: new LabelIndexComponent({ app }) });
}
