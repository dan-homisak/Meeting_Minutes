import { Decoration, EditorView } from '@codemirror/view';
import { createMarkdownEngine } from '../markdownConfig.js';
import { createObsidianCoreParser } from './parser/ObsidianCoreParser.js';
import { createMarkdownRenderer } from './render/MarkdownRenderer.js';
import { annotateMarkdownTokensWithSourceRanges } from './render/SourceRangeMapper.js';
import { createLiveRenderer } from './LiveRenderer.js';
import { createLiveStateField } from './LiveStateField.js';
import { createPointerController } from './PointerController.js';
import { createCursorController } from './CursorController.js';

export function createLiveRuntime({
  app,
  liveDebug
} = {}) {
  const markdownEngine = createMarkdownEngine();

  const markdownRenderer = createMarkdownRenderer({
    markdownEngine,
    annotateMarkdownTokensWithSourceRanges
  });

  const parser = createObsidianCoreParser({
    markdownEngine
  });

  const renderer = createLiveRenderer({
    liveDebug,
    renderMarkdownHtml: markdownRenderer.renderMarkdownHtml
  });

  const {
    liveStateField,
    requestRefresh,
    readLiveState,
    readInteractionMapForView
  } = createLiveStateField({
    parser,
    renderer,
    liveDebug
  });

  const pointerController = createPointerController({
    liveDebug,
    readInteractionMapForView
  });

  const cursorController = createCursorController({
    liveDebug
  });

  const livePointerHandlers = EditorView.domEventHandlers({
    mousedown(event, view) {
      return pointerController.handlePointer(view, event, 'mousedown');
    },
    touchstart(event, view) {
      return pointerController.handlePointer(view, event, 'touchstart');
    }
  });

  const liveAtomicRanges = EditorView.atomicRanges.of((view) => {
    try {
      const liveState = readLiveState(view.state);
      return liveState?.decorations ?? Decoration.none;
    } catch {
      return Decoration.none;
    }
  });

  return {
    app,
    parser,
    renderer,
    liveStateField,
    livePointerHandlers,
    liveAtomicRanges,
    requestRefresh,
    readLiveState,
    moveCursorVertically: (view, direction, trigger) =>
      cursorController.moveCursorVertically(view, direction, trigger)
  };
}
