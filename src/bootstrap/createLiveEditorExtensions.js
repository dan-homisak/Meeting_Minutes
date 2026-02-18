import { Decoration, EditorView } from '@codemirror/view';

export function createLiveEditorExtensions({
  app,
  liveDebug,
  liveDebugKeylogKeys,
  liveRuntimeHelpers,
  factories = {}
} = {}) {
  const createDomEventHandlers =
    factories.createDomEventHandlers ?? ((handlers) => EditorView.domEventHandlers(handlers));
  const createAtomicRanges =
    factories.createAtomicRanges ??
    ((provider) => EditorView.atomicRanges.of(provider));
  const decorationNone = factories.decorationNone ?? Decoration.none;

  const livePreviewPointerHandlers = createDomEventHandlers({
    mousedown(event, view) {
      return liveRuntimeHelpers.handleLivePointerActivation(view, event, 'mousedown');
    },
    touchstart(event, view) {
      return liveRuntimeHelpers.handleLivePointerActivation(view, event, 'touchstart');
    },
    keydown(event, view) {
      if (!liveDebugKeylogKeys.has(event.key) && app.viewMode !== 'live') {
        return false;
      }

      const signal = liveRuntimeHelpers.recordInputSignal('keyboard', {
        trigger: 'keydown',
        key: event.key,
        altKey: Boolean(event.altKey),
        ctrlKey: Boolean(event.ctrlKey),
        metaKey: Boolean(event.metaKey),
        shiftKey: Boolean(event.shiftKey),
        repeat: Boolean(event.repeat)
      });
      liveDebug.trace('input.keydown', {
        ...signal,
        mode: app.viewMode,
        selectionAnchor: view.state.selection.main.anchor,
        selectionHead: view.state.selection.main.head
      });
      return false;
    },
    focus(_event, view) {
      liveDebug.trace('editor.focus', {
        mode: app.viewMode,
        selectionHead: view.state.selection.main.head
      });
      liveRuntimeHelpers.scheduleCursorVisibilityProbe(view, 'editor-focus');
      return false;
    },
    blur(_event, view) {
      liveDebug.trace('editor.blur', {
        mode: app.viewMode,
        selectionHead: view.state.selection.main.head
      });
      return false;
    }
  });

  const livePreviewAtomicRanges = createAtomicRanges(() => decorationNone);

  return {
    livePreviewPointerHandlers,
    livePreviewAtomicRanges
  };
}
