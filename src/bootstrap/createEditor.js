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

const INLINE_MARKER_PAIRS = Object.freeze({
  '*': { open: '*', close: '*' },
  _: { open: '_', close: '_' },
  '~': { open: '~', close: '~' },
  '`': { open: '`', close: '`' },
  '[': { open: '[', close: ']' },
  '=': { open: '=', close: '=' }
});

const INLINE_WRAP_MARKERS = new Set(Object.keys(INLINE_MARKER_PAIRS));
const INLINE_LATCH_MODES = new Set(['wrap', 'unwrap']);
const SHIFT_LATCH_DOMAIN_BY_CODE = Object.freeze({
  BracketLeft: ['['],
  Equal: ['='],
  Backquote: ['~', '`']
});

function resolveInlineMarkerPair(text) {
  if (typeof text !== 'string' || text.length !== 1) {
    return null;
  }
  return INLINE_MARKER_PAIRS[text] ?? null;
}

function normalizeInlineMarkerDomain(domain = []) {
  const markers = [];
  for (const marker of Array.isArray(domain) ? domain : []) {
    if (typeof marker !== 'string' || marker.length !== 1 || !INLINE_WRAP_MARKERS.has(marker)) {
      continue;
    }
    if (!markers.includes(marker)) {
      markers.push(marker);
    }
  }
  return markers;
}

export function resolveInlineShiftLatchBindingFromKeyboardEvent(event) {
  if (!event || !event.shiftKey) {
    return null;
  }

  const code = typeof event.code === 'string' ? event.code : '';
  const codeDomain = normalizeInlineMarkerDomain(SHIFT_LATCH_DOMAIN_BY_CODE[code]);
  if (codeDomain.length > 0) {
    return {
      id: `shift:${code}`,
      domain: codeDomain
    };
  }

  const marker = typeof event.key === 'string' && event.key.length === 1 && INLINE_WRAP_MARKERS.has(event.key)
    ? event.key
    : null;
  if (!marker) {
    return null;
  }

  return {
    id: `shift:${code || marker}`,
    domain: [marker]
  };
}

function countPrefixRepeats(text, endIndex, token) {
  if (typeof text !== 'string' || typeof token !== 'string' || token.length === 0) {
    return 0;
  }
  let count = 0;
  let cursor = Math.max(0, Math.trunc(endIndex));
  const tokenLength = token.length;
  while (cursor - tokenLength >= 0 && text.slice(cursor - tokenLength, cursor) === token) {
    count += 1;
    cursor -= tokenLength;
  }
  return count;
}

function countSuffixRepeats(text, startIndex, token) {
  if (typeof text !== 'string' || typeof token !== 'string' || token.length === 0) {
    return 0;
  }
  let count = 0;
  let cursor = Math.max(0, Math.trunc(startIndex));
  const tokenLength = token.length;
  while (cursor + tokenLength <= text.length && text.slice(cursor, cursor + tokenLength) === token) {
    count += 1;
    cursor += tokenLength;
  }
  return count;
}

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

export function buildInlineWrapSpec(state, {
  from,
  to,
  text
} = {}) {
  if (!state?.doc || typeof text !== 'string' || text.length !== 1) {
    return null;
  }
  if (!INLINE_WRAP_MARKERS.has(text)) {
    return null;
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  const rangeFrom = Math.max(0, Math.trunc(from));
  const rangeTo = Math.max(rangeFrom, Math.trunc(to));
  if (rangeTo <= rangeFrom) {
    return null;
  }

  const selectedText = state.doc.sliceString(rangeFrom, rangeTo);
  if (selectedText.length === 0 || selectedText.includes('\n')) {
    return null;
  }

  const markerPair = resolveInlineMarkerPair(text);
  if (!markerPair) {
    return null;
  }

  const open = markerPair.open;
  const close = markerPair.close;
  const wrappedText = `${open}${selectedText}${close}`;
  const anchor = rangeFrom + open.length;
  const head = anchor + selectedText.length;

  return {
    changes: {
      from: rangeFrom,
      to: rangeTo,
      insert: wrappedText
    },
    selection: {
      anchor,
      head
    }
  };
}

export function buildInlineUnwrapSpec(state, {
  from,
  to,
  text
} = {}) {
  if (!state?.doc || typeof text !== 'string' || text.length !== 1) {
    return null;
  }
  if (!INLINE_WRAP_MARKERS.has(text)) {
    return null;
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  const rangeFrom = Math.max(0, Math.trunc(from));
  const rangeTo = Math.max(rangeFrom, Math.trunc(to));
  if (rangeTo <= rangeFrom) {
    return null;
  }

  const selectedText = state.doc.sliceString(rangeFrom, rangeTo);
  if (selectedText.length === 0 || selectedText.includes('\n')) {
    return null;
  }

  const markerPair = resolveInlineMarkerPair(text);
  if (!markerPair) {
    return null;
  }

  const open = markerPair.open;
  const close = markerPair.close;
  const minWrappedLength = open.length + close.length;
  if (selectedText.length < minWrappedLength) {
    return null;
  }
  if (!selectedText.startsWith(open) || !selectedText.endsWith(close)) {
    return null;
  }

  const unwrappedText = selectedText.slice(open.length, selectedText.length - close.length);
  const head = rangeFrom + unwrappedText.length;
  return {
    changes: {
      from: rangeFrom,
      to: rangeTo,
      insert: unwrappedText
    },
    selection: {
      anchor: rangeFrom,
      head
    }
  };
}

export function countSurroundingInlineMarkerPairs(state, {
  from,
  to,
  text
} = {}) {
  if (!state?.doc || typeof text !== 'string' || text.length !== 1) {
    return 0;
  }
  if (!INLINE_WRAP_MARKERS.has(text)) {
    return 0;
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return 0;
  }

  const rangeFrom = Math.max(0, Math.trunc(from));
  const rangeTo = Math.max(rangeFrom, Math.trunc(to));
  if (rangeTo <= rangeFrom) {
    return 0;
  }

  const selectedText = state.doc.sliceString(rangeFrom, rangeTo);
  if (selectedText.length === 0 || selectedText.includes('\n')) {
    return 0;
  }

  const markerPair = resolveInlineMarkerPair(text);
  if (!markerPair) {
    return 0;
  }

  const source = state.doc.toString();
  const leftRepeats = countPrefixRepeats(source, rangeFrom, markerPair.open);
  const rightRepeats = countSuffixRepeats(source, rangeTo, markerPair.close);
  return Math.max(0, Math.min(leftRepeats, rightRepeats));
}

export function buildInlineSurroundingUnwrapSpec(state, {
  from,
  to,
  text
} = {}) {
  const markerPairCount = countSurroundingInlineMarkerPairs(state, {
    from,
    to,
    text
  });
  if (markerPairCount <= 0) {
    return null;
  }

  const markerPair = resolveInlineMarkerPair(text);
  if (!markerPair || !Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  const rangeFrom = Math.max(0, Math.trunc(from));
  const rangeTo = Math.max(rangeFrom, Math.trunc(to));
  const openLength = markerPair.open.length;
  const closeLength = markerPair.close.length;

  return {
    changes: [
      {
        from: rangeFrom - openLength,
        to: rangeFrom,
        insert: ''
      },
      {
        from: rangeTo,
        to: rangeTo + closeLength,
        insert: ''
      }
    ],
    selection: {
      anchor: rangeFrom - openLength,
      head: rangeTo - openLength
    }
  };
}

export function buildInlineShiftLatchToggleSpec(state, {
  from,
  to,
  text,
  mode = null
} = {}) {
  if (!state?.doc || typeof text !== 'string' || text.length !== 1) {
    return null;
  }
  if (!INLINE_WRAP_MARKERS.has(text)) {
    return null;
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  const rangeFrom = Math.max(0, Math.trunc(from));
  const rangeTo = Math.max(rangeFrom, Math.trunc(to));
  if (rangeTo <= rangeFrom) {
    return null;
  }

  const selectedText = state.doc.sliceString(rangeFrom, rangeTo);
  if (selectedText.length === 0 || selectedText.includes('\n')) {
    return null;
  }

  const unwrapSpec = (
    buildInlineSurroundingUnwrapSpec(state, { from: rangeFrom, to: rangeTo, text }) ??
    buildInlineUnwrapSpec(state, { from: rangeFrom, to: rangeTo, text })
  );
  let nextMode = INLINE_LATCH_MODES.has(mode) ? mode : (unwrapSpec ? 'unwrap' : 'wrap');
  let spec = null;

  if (nextMode === 'unwrap') {
    spec = unwrapSpec;
    if (!spec) {
      nextMode = 'wrap';
      spec = buildInlineWrapSpec(state, { from: rangeFrom, to: rangeTo, text });
    }
  } else {
    spec = buildInlineWrapSpec(state, { from: rangeFrom, to: rangeTo, text });
  }

  if (!spec) {
    return null;
  }

  return {
    spec,
    mode: nextMode
  };
}

export function resolveInlineShiftLatchMarker(state, {
  from,
  to,
  domain = [],
  typedText = '',
  currentMarker = null
} = {}) {
  const normalizedDomain = normalizeInlineMarkerDomain(domain);
  if (normalizedDomain.length === 0) {
    return null;
  }

  if (typeof currentMarker === 'string' && normalizedDomain.includes(currentMarker)) {
    return currentMarker;
  }

  const rangeFrom = Number.isFinite(from) ? Math.max(0, Math.trunc(from)) : null;
  const rangeTo = Number.isFinite(to) && Number.isFinite(rangeFrom)
    ? Math.max(rangeFrom, Math.trunc(to))
    : null;

  let bestMarker = null;
  let bestDepth = 0;
  if (state?.doc && Number.isFinite(rangeFrom) && Number.isFinite(rangeTo) && rangeTo > rangeFrom) {
    for (const marker of normalizedDomain) {
      const depth = countSurroundingInlineMarkerPairs(state, {
        from: rangeFrom,
        to: rangeTo,
        text: marker
      });
      if (depth > bestDepth) {
        bestDepth = depth;
        bestMarker = marker;
      }
    }
  }
  if (bestDepth > 0 && bestMarker) {
    return bestMarker;
  }

  if (typeof typedText === 'string' && normalizedDomain.includes(typedText)) {
    return typedText;
  }

  return normalizedDomain[0] ?? null;
}

export function runInlineLinkWrapCommand(view) {
  if (!view?.state?.doc?.length) {
    return false;
  }

  const selection = view.state.selection.main;
  if (!selection || selection.empty) {
    return false;
  }

  const from = Math.max(0, Math.trunc(selection.from));
  const to = Math.max(from, Math.trunc(selection.to));
  if (to <= from) {
    return false;
  }

  const selectedText = view.state.doc.sliceString(from, to);
  if (selectedText.length === 0 || selectedText.includes('\n')) {
    return false;
  }

  const insert = `[${selectedText}]()`;
  const urlCursorPosition = from + selectedText.length + 3;
  view.dispatch({
    changes: {
      from,
      to,
      insert
    },
    selection: {
      anchor: urlCursorPosition,
      head: urlCursorPosition
    },
    scrollIntoView: true,
    userEvent: 'input.type'
  });
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
  const createDomEventHandlersExtension =
    factories.createDomEventHandlersExtension ??
    ((handlers) => EditorView.domEventHandlers(handlers));
  const inlineShiftLatchState = {
    active: false,
    marker: null,
    mode: null,
    bindingId: null,
    bindingDomain: []
  };

  function resetInlineShiftLatchState() {
    inlineShiftLatchState.active = false;
    inlineShiftLatchState.marker = null;
    inlineShiftLatchState.mode = null;
    inlineShiftLatchState.bindingId = null;
    inlineShiftLatchState.bindingDomain = [];
  }

  function setInlineShiftLatchBinding(binding) {
    const bindingId = typeof binding?.id === 'string' ? binding.id : null;
    const bindingDomain = normalizeInlineMarkerDomain(binding?.domain);
    if (!bindingId || bindingDomain.length === 0) {
      inlineShiftLatchState.bindingId = null;
      inlineShiftLatchState.bindingDomain = [];
      inlineShiftLatchState.marker = null;
      inlineShiftLatchState.mode = null;
      return;
    }

    const sameBinding = inlineShiftLatchState.bindingId === bindingId;
    inlineShiftLatchState.bindingId = bindingId;
    inlineShiftLatchState.bindingDomain = bindingDomain;
    if (!sameBinding || !bindingDomain.includes(inlineShiftLatchState.marker)) {
      inlineShiftLatchState.marker = null;
      inlineShiftLatchState.mode = null;
    }
  }

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

  function handleInlineWrap(view, from, to, text) {
    const hasSelection = Number.isFinite(from) && Number.isFinite(to) && to > from;
    const shiftLatchMarker = (
      hasSelection &&
      inlineShiftLatchState.active
    )
      ? resolveInlineShiftLatchMarker(view?.state, {
        from,
        to,
        domain: inlineShiftLatchState.bindingDomain,
        typedText: text,
        currentMarker: inlineShiftLatchState.marker
      })
      : null;

    if (shiftLatchMarker && hasSelection && inlineShiftLatchState.active) {
      inlineShiftLatchState.marker = shiftLatchMarker;
      const toggleResult = buildInlineShiftLatchToggleSpec(view?.state, {
        from,
        to,
        text: shiftLatchMarker,
        mode: inlineShiftLatchState.mode
      });
      if (!toggleResult?.spec) {
        return false;
      }

      inlineShiftLatchState.mode = toggleResult.mode;
      view.dispatch({
        ...toggleResult.spec,
        scrollIntoView: true,
        userEvent: 'input.type'
      });
      return true;
    }

    const unwrapSpec = buildInlineUnwrapSpec(view?.state, { from, to, text });
    if (unwrapSpec) {
      view.dispatch({
        ...unwrapSpec,
        scrollIntoView: true,
        userEvent: 'input.type'
      });
      return true;
    }

    const wrapSpec = buildInlineWrapSpec(view?.state, { from, to, text });
    if (!wrapSpec) {
      return false;
    }

    view.dispatch({
      ...wrapSpec,
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
      key: 'Mod-k',
      run: (view) => runInlineLinkWrapCommand(view)
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
        handleInlineWrap(view, from, to, text) ||
        handleCodeFenceAutoClose(view, from, to, text)
      )),
      createDomEventHandlersExtension({
        keydown(event) {
          if (!event) {
            return false;
          }
          if (event.key === 'Shift') {
            inlineShiftLatchState.active = true;
            inlineShiftLatchState.marker = null;
            inlineShiftLatchState.mode = null;
            inlineShiftLatchState.bindingId = null;
            inlineShiftLatchState.bindingDomain = [];
            return false;
          }
          if (!event.shiftKey) {
            return false;
          }
          const binding = resolveInlineShiftLatchBindingFromKeyboardEvent(event);
          if (!binding) {
            return false;
          }
          inlineShiftLatchState.active = true;
          setInlineShiftLatchBinding(binding);
          return false;
        },
        keyup(event) {
          if (!event) {
            return false;
          }
          if (event.key === 'Shift') {
            resetInlineShiftLatchState();
          }
          return false;
        },
        blur() {
          resetInlineShiftLatchState();
          return false;
        }
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
