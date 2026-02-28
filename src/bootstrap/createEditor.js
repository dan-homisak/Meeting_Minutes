import { EditorState } from '@codemirror/state';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import {
  EditorView,
  drawSelection,
  dropCursor,
  keymap,
  lineNumbers
} from '@codemirror/view';

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

  const keyBindings = [
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
      run: insertNewlineContinueMarkup
    },
    ...defaultKeymap,
    ...historyKeymap,
    ...completionKeymap,
    indentWithTab
  ];

  const state = createEditorState({
    doc: initialDoc,
    selection: { anchor: 0 },
    extensions: [
      drawSelection(),
      dropCursor(),
      history(),
      createMarkdownExtension(),
      lineNumbers(),
      EditorView.lineWrapping,
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
