import { EditorState } from '@codemirror/state';
import { autocompletion } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { markdown, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';

export const DEFAULT_EDITOR_DOC =
  '# Welcome\n\nChoose a folder and start editing markdown files.\n\nType `/` for quick markdown snippets.\n';

export function createEditor({
  parent,
  livePreviewStateField,
  livePreviewAtomicRanges,
  livePreviewPointerHandlers,
  slashCommandCompletion,
  moveLiveCursorVertically,
  handleEditorUpdate,
  initialDoc = DEFAULT_EDITOR_DOC,
  factories = {}
} = {}) {
  const createEditorView = factories.createEditorView ?? ((config) => new EditorView(config));
  const createEditorState = factories.createEditorState ?? ((config) => EditorState.create(config));
  const createMarkdownExtension = factories.createMarkdownExtension ?? (() => markdown());
  const createKeymapExtension = factories.createKeymapExtension ?? ((bindings) => keymap.of(bindings));
  const createDecorationsExtension =
    factories.createDecorationsExtension ??
    ((stateField, mapDecorations) => EditorView.decorations.from(stateField, mapDecorations));
  const createAutocompletionExtension =
    factories.createAutocompletionExtension ?? ((config) => autocompletion(config));
  const createUpdateListenerExtension =
    factories.createUpdateListenerExtension ??
    ((listener) => EditorView.updateListener.of(listener));
  const lineWrappingExtension = factories.lineWrappingExtension ?? EditorView.lineWrapping;
  const indentWithTabCommand = factories.indentWithTabCommand ?? indentWithTab;
  const insertNewlineCommand = factories.insertNewlineCommand ?? insertNewlineContinueMarkup;
  const basicSetupExtension = factories.basicSetupExtension ?? basicSetup;

  const keyBindings = [
    indentWithTabCommand,
    {
      key: 'ArrowDown',
      run: (view) => moveLiveCursorVertically?.(view, 1, 'ArrowDown') ?? false
    },
    {
      key: 'ArrowUp',
      run: (view) => moveLiveCursorVertically?.(view, -1, 'ArrowUp') ?? false
    },
    {
      key: 'Enter',
      run: insertNewlineCommand
    }
  ];

  const state = createEditorState({
    doc: initialDoc,
    selection: { anchor: 0 },
    extensions: [
      basicSetupExtension,
      createMarkdownExtension(),
      lineWrappingExtension,
      createKeymapExtension(keyBindings),
      livePreviewStateField,
      createDecorationsExtension(livePreviewStateField, (stateValue) => stateValue.decorations),
      livePreviewAtomicRanges,
      livePreviewPointerHandlers,
      createAutocompletionExtension({
        activateOnTyping: true,
        override: [slashCommandCompletion]
      }),
      createUpdateListenerExtension((update) => {
        handleEditorUpdate?.(update);
      })
    ]
  });

  return createEditorView({
    state,
    parent
  });
}
