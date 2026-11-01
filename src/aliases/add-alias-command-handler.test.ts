import type { PromptParams } from '@mnaoumov/obsidian-lib/modals/prompt';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App as AppOriginal,
  MarkdownFileInfo,
  TFile
} from 'obsidian';

import { addAlias } from '@mnaoumov/obsidian-lib/file-manager';
import { prompt } from '@mnaoumov/obsidian-lib/modals/prompt';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { AddAliasCommandHandler } from './add-alias-command-handler.ts';

vi.mock('@mnaoumov/obsidian-lib/modals/prompt', () => ({
  prompt: vi.fn()
}));

vi.mock('@mnaoumov/obsidian-lib/file-manager', () => ({
  addAlias: vi.fn()
}));

// `canExecuteFile`, `canExecuteFiles` and `executeFile` are protected on the base, so a test reaches them through a probe.
interface AddAliasCommandHandlerProbe {
  readonly canExecuteFile: (file: TFile) => boolean;
  readonly canExecuteFiles: (files: TFile[]) => boolean;
  readonly executeFile: (file: TFile) => Promise<void>;
}

const resourceLockComponent = castTo<ResourceLockComponent>({});

let app: AppOriginal;
let handler: AddAliasCommandHandlerProbe;

function getFile(path: string): TFile {
  const file = app.vault.getFileByPath(path);
  if (!file) {
    throw new Error(`No file at ${path}.`);
  }

  return file;
}

function getPromptParams(): PromptParams {
  const params = vi.mocked(prompt).mock.calls[0]?.[0];
  if (!params) {
    throw new Error('prompt was not called.');
  }

  return params;
}

function setActiveEditor(activeEditor: MarkdownFileInfo | null): void {
  Object.defineProperty(app.workspace, 'activeEditor', { configurable: true, value: activeEditor });
}

function validate(value: string): unknown {
  return getPromptParams().valueValidator?.(value);
}

beforeEach(() => {
  vi.clearAllMocks();
  app = App.createConfigured__({
    files: {
      'Alpha/Bravo/Charlie.md': '---\naliases:\n  - Echo\n---\n',
      'Delta.md': '',
      'Foxtrot.canvas': '{}'
    }
  }).asOriginalType__();
  setActiveEditor(null);
  handler = castTo<AddAliasCommandHandlerProbe>(new AddAliasCommandHandler({ app, resourceLockComponent }));
});

describe('AddAliasCommandHandler', () => {
  it('should offer itself for a markdown note only', () => {
    expect(handler.canExecuteFile(getFile('Delta.md'))).toBe(true);
    expect(handler.canExecuteFile(getFile('Foxtrot.canvas'))).toBe(false);
  });

  it('should stay out of the multi-file menu, where it would prompt once per note', () => {
    expect(handler.canExecuteFiles([getFile('Delta.md')])).toBe(false);
  });

  it('should add the trimmed alias the user enters', async () => {
    vi.mocked(prompt).mockResolvedValue('  Golf  ');
    const file = getFile('Delta.md');

    await handler.executeFile(file);

    expect(getPromptParams().defaultValue).toBe('');
    expect(addAlias).toHaveBeenCalledWith({ alias: 'Golf', app, pathOrFile: file, resourceLockComponent });
  });

  it('should add nothing when the prompt is cancelled', async () => {
    vi.mocked(prompt).mockResolvedValue(null);

    await handler.executeFile(getFile('Delta.md'));

    expect(addAlias).not.toHaveBeenCalled();
  });

  it('should refuse an empty value, the note\'s own name and an alias the note already has', async () => {
    vi.mocked(prompt).mockResolvedValue(null);

    await handler.executeFile(getFile('Alpha/Bravo/Charlie.md'));

    expect(validate(' \t ')).toBe('Enter an alias.');
    expect(validate('Charlie')).toBe('That is the note\'s own name.');
    expect(validate(' Echo ')).toBe('The note already has that alias.');
    expect(validate('Hotel')).toBeUndefined();
  });

  it('should accept any non-empty value for a note with no frontmatter', async () => {
    vi.mocked(prompt).mockResolvedValue(null);

    await handler.executeFile(getFile('Delta.md'));

    expect(validate('Echo')).toBeUndefined();
  });

  it('should seed the prompt with the selection of the editor showing the note, folded onto one line', async () => {
    vi.mocked(prompt).mockResolvedValue(null);
    const file = getFile('Delta.md');
    setActiveEditor(castTo<MarkdownFileInfo>({ editor: { getSelection: (): string => ' India\n\tJuliett\n' }, file }));

    await handler.executeFile(file);

    expect(getPromptParams().defaultValue).toBe('India Juliett');
  });

  it('should not seed the prompt from an editor showing another note', async () => {
    vi.mocked(prompt).mockResolvedValue(null);
    setActiveEditor(castTo<MarkdownFileInfo>({ editor: { getSelection: (): string => 'India' }, file: getFile('Alpha/Bravo/Charlie.md') }));

    await handler.executeFile(getFile('Delta.md'));

    expect(getPromptParams().defaultValue).toBe('');
  });

  it('should not seed the prompt from an active note with no editor', async () => {
    vi.mocked(prompt).mockResolvedValue(null);
    const file = getFile('Delta.md');
    setActiveEditor(castTo<MarkdownFileInfo>({ file }));

    await handler.executeFile(file);

    expect(getPromptParams().defaultValue).toBe('');
  });
});
