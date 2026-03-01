import { EditorSelection, EditorState } from '@codemirror/state';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, insertTab } from '@codemirror/commands';
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

function insertSoftTabFallback(view, tabText = '  ') {
  if (!view?.state) {
    return false;
  }

  const transaction = view.state.changeByRange((range) => {
    const nextPosition = range.from + tabText.length;
    return {
      changes: {
        from: range.from,
        to: range.to,
        insert: tabText
      },
      range: EditorSelection.cursor(nextPosition, -1)
    };
  });

  view.dispatch(
    view.state.update(transaction, {
      scrollIntoView: true,
      userEvent: 'input'
    })
  );
  return true;
}

function snapshotSelectionState(view) {
  const selection = view?.state?.selection?.main;
  return {
    length: view?.state?.doc?.length ?? null,
    head: selection?.head ?? null,
    anchor: selection?.anchor ?? null
  };
}

function didSelectionStateChange(before, after) {
  if (!before || !after) {
    return false;
  }
  return (
    before.length !== after.length ||
    before.head !== after.head ||
    before.anchor !== after.anchor
  );
}

export function runTabIndentCommand(view, adjustLiveListIndent) {
  const adjustedListIndent = adjustLiveListIndent?.(view, 1, 'Tab') ?? false;
  if (adjustedListIndent) {
    return true;
  }

  const beforeInsert = snapshotSelectionState(view);
  const insertedTab = insertTab(view);
  const afterInsert = snapshotSelectionState(view);
  if (insertedTab && didSelectionStateChange(beforeInsert, afterInsert)) {
    return true;
  }

  const beforeIndent = snapshotSelectionState(view);
  const indented = indentMore(view);
  const afterIndent = snapshotSelectionState(view);
  if (indented && didSelectionStateChange(beforeIndent, afterIndent)) {
    return true;
  }
  return insertSoftTabFallback(view);
}

export function runShiftTabIndentCommand(view, adjustLiveListIndent) {
  const adjustedListIndent = adjustLiveListIndent?.(view, -1, 'Shift-Tab') ?? false;
  if (adjustedListIndent) {
    return true;
  }
  if (indentLess(view)) {
    return true;
  }
  // Returning true keeps tab focus from escaping to browser/UI even when no unindent applies.
  return true;
}

export function buildCodeFenceAutoCloseSpec(state, {
  from,
  to,
  text
} = {}) {
  if (!state?.doc || typeof text !== 'string' || text.length === 0) {
    return null;
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || from !== to) {
    return null;
  }
  if (text !== '`' && text !== '```') {
    return null;
  }

  const line = state.doc.lineAt(from);
  const lineText = state.doc.sliceString(line.from, line.to);
  const cursorColumn = from - line.from;
  const before = lineText.slice(0, cursorColumn);
  const after = lineText.slice(cursorColumn);
  if (after.trim().length > 0) {
    return null;
  }

  const prospectiveLine = `${before}${text}`;
  const indentMatch = prospectiveLine.match(/^(\s*)/);
  const indentation = indentMatch?.[1] ?? '';
  const markerCandidate = prospectiveLine.slice(indentation.length);
  if (markerCandidate !== '```') {
    return null;
  }

  const hasNextLine = line.number < state.doc.lines;
  const nextLineStart = hasNextLine ? line.to + 1 : line.to;
  const closingFenceInsert = hasNextLine
    ? `${indentation}\`\`\`\n`
    : `\n${indentation}\`\`\``;

  return {
    changes: [
      { from, to, insert: text },
      { from: nextLineStart, to: nextLineStart, insert: closingFenceInsert }
    ],
    selection: { anchor: from + text.length, head: from + text.length }
  };
}

export function createEditor({
  parent,
  livePreviewStateField,
  livePreviewAtomicRanges,
  livePreviewPointerHandlers,
  slashCommandCompletion,
  moveLiveCursorVertically,
  moveLiveCursorHorizontally,
  adjustLiveListIndent,
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
  const createInputHandlerExtension =
    factories.createInputHandlerExtension ??
    ((handler) => EditorView.inputHandler.of(handler));

  function handleCodeFenceAutoClose(view, from, to, text) {
    const autoCloseSpec = buildCodeFenceAutoCloseSpec(view?.state, { from, to, text });
    if (!autoCloseSpec) {
      return false;
    }

    view.dispatch({
      ...autoCloseSpec,
      scrollIntoView: true,
      userEvent: 'input.type'
    });
    return true;
  }

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
      key: 'ArrowRight',
      run: (view) => moveLiveCursorHorizontally?.(view, 1, 'ArrowRight') ?? false
    },
    {
      key: 'ArrowLeft',
      run: (view) => moveLiveCursorHorizontally?.(view, -1, 'ArrowLeft') ?? false
    },
    {
      key: 'Tab',
      run: (view) => runTabIndentCommand(view, adjustLiveListIndent)
    },
    {
      key: 'Shift-Tab',
      run: (view) => runShiftTabIndentCommand(view, adjustLiveListIndent)
    },
    {
      key: 'Backspace',
      run: (view) => adjustLiveListIndent?.(view, -1, 'Backspace') ?? false
    },
    {
      key: 'Enter',
      run: insertNewlineContinueMarkup
    },
    ...defaultKeymap,
    ...historyKeymap,
    ...completionKeymap
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
      createInputHandlerExtension((view, from, to, text) => (
        handleCodeFenceAutoClose(view, from, to, text)
      )),
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
