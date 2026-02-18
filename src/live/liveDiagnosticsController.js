export function createLiveDiagnosticsController({
  app,
  liveDebug,
  liveDebugDiagnostics,
  liveDebugKeylogKeys,
  liveDebugDomSelectionThrottleMs,
  normalizeLogString,
  normalizePointerTarget,
  readPointerCoordinates,
  describeElementForLog,
  recordInputSignal,
  moveLiveCursorVertically,
  scheduleCursorVisibilityProbe,
  readDomSelectionForLog,
  windowObject = window,
  documentObject = document,
  performanceObserverClass = typeof PerformanceObserver === 'function' ? PerformanceObserver : null,
  elementConstructor = typeof Element === 'function' ? Element : null,
  nodeConstructor = typeof Node === 'function' ? Node : null
} = {}) {
  function installRuntimeDiagnostics() {
    liveDebug.info('diagnostics.runtime.installed', {
      hasPerformanceObserver: typeof performanceObserverClass === 'function'
    });

    windowObject.addEventListener('error', (event) => {
      liveDebug.error('window.error', {
        message:
          event.error instanceof Error
            ? event.error.message
            : typeof event.message === 'string'
              ? event.message
              : 'unknown-error',
        filename: event.filename || '',
        line: Number.isFinite(event.lineno) ? event.lineno : null,
        column: Number.isFinite(event.colno) ? event.colno : null
      });
    });

    windowObject.addEventListener('unhandledrejection', (event) => {
      const reason =
        event?.reason instanceof Error
          ? event.reason.message
          : typeof event?.reason === 'string'
            ? event.reason
            : '';
      liveDebug.error('window.unhandledrejection', {
        reason: normalizeLogString(reason, 200)
      });
    });

    if (typeof performanceObserverClass !== 'function') {
      return;
    }

    const supportedEntryTypes = Array.isArray(performanceObserverClass.supportedEntryTypes)
      ? performanceObserverClass.supportedEntryTypes
      : [];
    if (!supportedEntryTypes.includes('longtask')) {
      return;
    }

    try {
      const observer = new performanceObserverClass((entryList) => {
        for (const entry of entryList.getEntries()) {
          liveDebug.warn('perf.longtask', {
            name: entry.name || '',
            duration: Number(entry.duration.toFixed(2)),
            startTime: Number(entry.startTime.toFixed(2))
          });
        }
      });
      observer.observe({
        entryTypes: ['longtask']
      });
      liveDebugDiagnostics.longTaskObserver = observer;
      liveDebug.info('perf.longtask.enabled', {});
    } catch (error) {
      liveDebug.warn('perf.longtask.failed', {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  function installEditorInputDiagnostics(view) {
    if (!view?.dom) {
      return;
    }

    const onPointerDown = (event) => {
      if (app.viewMode !== 'live') {
        return;
      }

      const targetElement = normalizePointerTarget(event.target);
      const coordinates = readPointerCoordinates(event);
      const targetSummary = describeElementForLog(targetElement);
      const pointerSignal = recordInputSignal('pointer', {
        trigger: `root-${event.type}`,
        x: coordinates?.x ?? null,
        y: coordinates?.y ?? null,
        targetTag: targetSummary?.tagName ?? null,
        targetClassName: targetSummary?.className ?? null,
        sourceFrom: targetSummary?.sourceFrom ?? null
      });

      liveDebug.trace('input.pointer.root', {
        ...pointerSignal,
        target: targetSummary
      });

      const gutterElement = targetElement?.closest?.('.cm-gutterElement');
      if (gutterElement) {
        liveDebug.trace('input.gutter.pointer', {
          lineLabel: normalizeLogString(gutterElement.textContent ?? '', 24),
          target: targetSummary
        });
      }
    };

    const onKeyDown = (event) => {
      if (app.viewMode !== 'live' && !liveDebugKeylogKeys.has(event.key)) {
        return;
      }

      const targetElement = normalizePointerTarget(event.target);
      const targetSummary = describeElementForLog(targetElement);
      const activeElementRaw = documentObject.activeElement;
      const activeElement =
        elementConstructor && activeElementRaw instanceof elementConstructor
          ? describeElementForLog(activeElementRaw)
          : null;
      const signal = recordInputSignal('keyboard', {
        trigger: 'root-keydown',
        key: event.key,
        altKey: Boolean(event.altKey),
        ctrlKey: Boolean(event.ctrlKey),
        metaKey: Boolean(event.metaKey),
        shiftKey: Boolean(event.shiftKey),
        repeat: Boolean(event.repeat),
        targetTag: targetSummary?.tagName ?? null,
        targetClassName: targetSummary?.className ?? null
      });

      liveDebug.trace('input.keydown.root', {
        ...signal,
        mode: app.viewMode,
        selectionHead: view.state.selection.main.head,
        defaultPrevented: Boolean(event.defaultPrevented),
        eventPhase: event.eventPhase,
        isTrusted: Boolean(event.isTrusted),
        target: targetSummary,
        activeElement
      });

      const shouldInterceptVertical =
        app.viewMode === 'live' &&
        (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey;
      if (!shouldInterceptVertical) {
        return;
      }

      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const beforeHead = view.state.selection.main.head;
      const handled = moveLiveCursorVertically(
        view,
        direction,
        `root-keydown-${event.key}`
      );
      const afterHead = view.state.selection.main.head;

      liveDebug.trace('input.keydown.vertical-intercept', {
        key: event.key,
        direction,
        handled,
        beforeHead,
        afterHead,
        selectionChanged: beforeHead !== afterHead
      });

      if (handled) {
        event.preventDefault();
        event.stopPropagation();
        liveDebug.trace('input.keydown.vertical-intercept.applied', {
          key: event.key,
          afterHead
        });
        scheduleCursorVisibilityProbe(view, 'vertical-intercept-applied');
      }
    };

    const onDocumentSelectionChange = () => {
      if (app.viewMode !== 'live') {
        return;
      }

      const now = Date.now();
      if (
        now - liveDebugDiagnostics.lastDomSelectionChangeLoggedAt <
        liveDebugDomSelectionThrottleMs
      ) {
        return;
      }
      liveDebugDiagnostics.lastDomSelectionChangeLoggedAt = now;

      const domSelection = readDomSelectionForLog();
      const activeElement = documentObject.activeElement;
      const anchorNode = windowObject.getSelection?.()?.anchorNode ?? null;
      const relatedToEditor =
        (nodeConstructor && activeElement instanceof nodeConstructor && view.dom.contains(activeElement)) ||
        (nodeConstructor && anchorNode instanceof nodeConstructor && view.dom.contains(anchorNode));

      if (!relatedToEditor) {
        return;
      }

      liveDebug.trace('dom.selectionchange', {
        mode: app.viewMode,
        selectionHead: view.state.selection.main.head,
        viewHasFocus: view.hasFocus,
        domSelection
      });
      scheduleCursorVisibilityProbe(view, 'dom-selectionchange');
    };

    view.dom.addEventListener('mousedown', onPointerDown, true);
    view.dom.addEventListener('touchstart', onPointerDown, true);
    view.dom.addEventListener('keydown', onKeyDown, true);
    documentObject.addEventListener('selectionchange', onDocumentSelectionChange, true);

    liveDebug.info('diagnostics.editor-input.installed', {});
  }

  return {
    installRuntimeDiagnostics,
    installEditorInputDiagnostics
  };
}
