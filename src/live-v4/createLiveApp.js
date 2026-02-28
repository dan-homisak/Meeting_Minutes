import { slashCommandCompletion } from '../editor/slashCommands.js';
import { createEditor } from '../bootstrap/createEditor.js';
import { createEditorDocumentAdapter } from '../bootstrap/createEditorDocumentAdapter.js';
import { createLiveDebugBootstrap } from '../bootstrap/createLiveDebugBootstrap.js';
import { LIVE_CONSTANTS } from '../bootstrap/liveConstants.js';
import { createWorkspaceView } from '../ui/workspaceView.js';
import { createWorkspaceController } from '../workspace/workspaceController.js';
import {
  ensureReadWritePermission,
  isMarkdownFile,
  walkDirectory
} from '../workspace/fileSystem.js';
import { readWorkspaceFromDb, writeWorkspaceToDb } from '../workspace/workspaceDb.js';
import { createLiveRuntime } from './LiveRuntime.js';
import { LIVE_PROBE_FIXTURES, readProbeFixture } from './probeFixtures.js';

export function createLiveApp({
  windowObject,
  documentObject,
  isDevBuild = false
} = {}) {
  const window = windowObject;
  const document = documentObject;

  const openFolderButton = document.querySelector('#open-folder');
  const newNoteButton = document.querySelector('#new-note');
  const saveNowButton = document.querySelector('#save-now');
  const statusElement = document.querySelector('#status');
  const fileCountElement = document.querySelector('#file-count');
  const fileListElement = document.querySelector('#file-list');
  const editorElement = document.querySelector('#editor');

  const app = {
    folderHandle: null,
    fileHandles: new Map(),
    currentPath: null,
    currentFileHandle: null,
    lastSavedText: '',
    hasUnsavedChanges: false,
    isLoadingFile: false,
    autosaveTimer: null
  };
  const probeApiKey = '__MM_LIVE_V4_PROBE__';

  const workspaceView = createWorkspaceView({
    statusElement,
    fileCountElement,
    fileListElement,
    newNoteButton,
    saveNowButton
  });

  const { liveDebug, launcherDebugBridge } = createLiveDebugBootstrap({
    windowObject: window,
    isDevBuild,
    markdownEngineOptions: {
      dialect: 'obsidian-core',
      runtime: 'live-v4'
    },
    scope: 'live-v4'
  });

  const liveDebugDiagnostics = {
    lastProgrammaticSelectionAt: 0,
    previousSelectionHead: null,
    previousSelectionLine: null,
    lastLayoutProbeAt: 0
  };

  function setStatus(message, asError = false) {
    workspaceView.setStatus(message, asError);
  }

  function updateActionButtons() {
    workspaceView.updateActionButtons({
      folderHandle: app.folderHandle,
      currentFileHandle: app.currentFileHandle
    });
  }

  function readSelectionSnapshot(view) {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    return {
      head,
      lineNumber: line.number,
      lineFrom: line.from,
      lineTo: line.to,
      lineLength: Math.max(0, line.to - line.from)
    };
  }

  function readLiveStateSnapshot(view) {
    const liveState = runtime.readLiveState(view.state);
    const blocks = Array.isArray(liveState?.model?.blocks) ? liveState.model.blocks : [];
    const renderedCount = Number.isFinite(liveState?.metrics?.renderedBlockCount)
      ? liveState.metrics.renderedBlockCount
      : 0;
    const activeBlockId = liveState?.activeBlockId ?? null;
    const activeBlock = blocks.find((block) => block.id === activeBlockId) ?? null;
    const activeBlockLength = activeBlock ? Math.max(0, activeBlock.to - activeBlock.from) : 0;

    return {
      activeBlockId,
      activeBlockFrom: activeBlock?.from ?? null,
      activeBlockTo: activeBlock?.to ?? null,
      activeBlockType: activeBlock?.type ?? null,
      activeBlockLength,
      blockCount: blocks.length,
      renderedBlockCount: renderedCount,
      virtualizedBlockCount: Number.isFinite(liveState?.metrics?.virtualizedBlockCount)
        ? liveState.metrics.virtualizedBlockCount
        : 0,
      budgetTruncated: Boolean(liveState?.metrics?.budgetTruncated)
    };
  }

  function clampPositionToDoc(view, value) {
    if (!view?.state?.doc || !Number.isFinite(value)) {
      return null;
    }

    const max = Math.max(0, Math.trunc(view.state.doc.length));
    return Math.max(0, Math.min(max, Math.trunc(value)));
  }

  function toSerializableRect(rect) {
    if (!rect) {
      return null;
    }

    return {
      left: Number(rect.left.toFixed(2)),
      top: Number(rect.top.toFixed(2)),
      right: Number(rect.right.toFixed(2)),
      bottom: Number(rect.bottom.toFixed(2)),
      width: Number(rect.width.toFixed(2)),
      height: Number(rect.height.toFixed(2))
    };
  }

  function readProbeLines(view, maxLines = 80) {
    if (!view?.state?.doc) {
      return [];
    }

    const lineCount = Math.max(1, Math.min(view.state.doc.lines, Math.max(1, Math.trunc(maxLines))));
    const lines = [];
    for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
      const line = view.state.doc.line(lineNumber);
      lines.push({
        number: line.number,
        from: line.from,
        to: line.to,
        text: view.state.doc.sliceString(line.from, line.to)
      });
    }
    return lines;
  }

  function readProbeWidgets(view) {
    if (!view?.dom?.querySelectorAll) {
      return [];
    }

    return [...view.dom.querySelectorAll('.mm-live-v4-block-widget')].map((element, index) => ({
      index,
      fragmentId: element.getAttribute('data-fragment-id'),
      blockId: element.getAttribute('data-block-id'),
      sourceFrom: Number(element.getAttribute('data-src-from')),
      sourceTo: Number(element.getAttribute('data-src-to')),
      rect: toSerializableRect(element.getBoundingClientRect())
    }));
  }

  function readProbeDomLines(view, maxLines = 80) {
    if (!view?.dom?.querySelectorAll) {
      return [];
    }

    const allLines = [...view.dom.querySelectorAll('.cm-line')];
    return allLines.slice(0, Math.max(1, Math.trunc(maxLines))).map((lineElement, index) => {
      const sourceContent = lineElement.querySelector('.mm-live-v4-source-content');
      const inlinePrefix = lineElement.querySelector(
        '.mm-live-v4-inline-list-prefix, .mm-live-v4-inline-task-prefix, .mm-live-v4-inline-quote-prefix'
      );

      return {
        index,
        text: lineElement.innerText,
        className: lineElement.className,
        html: lineElement.innerHTML,
        hasWidget: Boolean(lineElement.querySelector('.mm-live-v4-block-widget')),
        lineListDepth: lineElement.getAttribute('data-mm-list-depth'),
        lineMarkerChars: lineElement.getAttribute('data-mm-marker-chars'),
        sourceContentRect: toSerializableRect(sourceContent?.getBoundingClientRect?.() ?? null),
        sourceContentText: sourceContent?.innerText ?? null,
        inlinePrefixClass: inlinePrefix?.className ?? null,
        inlinePrefixRect: toSerializableRect(inlinePrefix?.getBoundingClientRect?.() ?? null),
        rect: toSerializableRect(lineElement.getBoundingClientRect())
      };
    });
  }

  function readProbeGutterLines(view, maxLines = 80) {
    if (!view?.dom?.querySelectorAll) {
      return [];
    }

    const allLines = [...view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')];
    return allLines.slice(0, Math.max(1, Math.trunc(maxLines))).map((lineElement, index) => ({
      index,
      text: lineElement.innerText,
      className: lineElement.className,
      rect: toSerializableRect(lineElement.getBoundingClientRect())
    }));
  }

  function readTypographyMetrics(view) {
    if (!view?.dom || typeof window?.getComputedStyle !== 'function') {
      return {
        ready: false
      };
    }

    const scroller = view.dom.querySelector('.cm-scroller');
    const content = view.dom.querySelector('.cm-content');
    const firstLine = view.dom.querySelector('.cm-line');
    const firstWidget = view.dom.querySelector('.mm-live-v4-block-widget');
    const gutters = view.dom.querySelector('.cm-gutters');
    const firstGutterElement = view.dom.querySelector('.cm-lineNumbers .cm-gutterElement');

    const scrollerStyle = scroller ? window.getComputedStyle(scroller) : null;
    const contentStyle = content ? window.getComputedStyle(content) : null;
    const lineStyle = firstLine ? window.getComputedStyle(firstLine) : null;
    const widgetStyle = firstWidget ? window.getComputedStyle(firstWidget) : null;
    const gutterStyle = gutters ? window.getComputedStyle(gutters) : null;
    const gutterElementStyle = firstGutterElement ? window.getComputedStyle(firstGutterElement) : null;

    return {
      ready: true,
      scroller: {
        fontFamily: scrollerStyle?.fontFamily ?? null,
        fontSize: scrollerStyle?.fontSize ?? null,
        lineHeight: scrollerStyle?.lineHeight ?? null
      },
      content: {
        fontFamily: contentStyle?.fontFamily ?? null,
        fontSize: contentStyle?.fontSize ?? null,
        lineHeight: contentStyle?.lineHeight ?? null
      },
      firstLine: {
        fontFamily: lineStyle?.fontFamily ?? null,
        fontSize: lineStyle?.fontSize ?? null,
        lineHeight: lineStyle?.lineHeight ?? null,
        rect: toSerializableRect(firstLine?.getBoundingClientRect?.() ?? null)
      },
      firstWidget: {
        fontFamily: widgetStyle?.fontFamily ?? null,
        fontSize: widgetStyle?.fontSize ?? null,
        lineHeight: widgetStyle?.lineHeight ?? null,
        rect: toSerializableRect(firstWidget?.getBoundingClientRect?.() ?? null)
      },
      gutters: {
        display: gutterStyle?.display ?? null,
        width: gutterStyle?.width ?? null,
        lineHeight: gutterElementStyle?.lineHeight ?? null,
        fontFamily: gutterElementStyle?.fontFamily ?? null,
        fontSize: gutterElementStyle?.fontSize ?? null,
        visibleLineNumberCount: view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement').length
      }
    };
  }

  function createProbeApi() {
    return {
      version: 'live-v4-probe-v1',
      getDocText() {
        return editorView?.state?.doc?.toString?.() ?? '';
      },
      listFixtures() {
        return Object.keys(LIVE_PROBE_FIXTURES);
      },
      getStateSnapshot({ maxLines = 80 } = {}) {
        if (!editorView) {
          return {
            ready: false
          };
        }

        const cursorElement = editorView.dom.querySelector('.cm-cursor');

        return {
          ready: true,
          selection: readSelectionSnapshot(editorView),
          liveState: readLiveStateSnapshot(editorView),
          hasFocus: editorView.hasFocus,
          lines: readProbeLines(editorView, maxLines),
          domLines: readProbeDomLines(editorView, maxLines),
          gutterLines: readProbeGutterLines(editorView, maxLines),
          widgets: readProbeWidgets(editorView),
          cursorRect: toSerializableRect(cursorElement?.getBoundingClientRect?.() ?? null),
          typography: readTypographyMetrics(editorView)
        };
      },
      setDocText(text, { anchor = 0 } = {}) {
        if (!editorView?.state?.doc) {
          return {
            ok: false,
            reason: 'editor-not-ready'
          };
        }

        const nextText = typeof text === 'string' ? text : '';
        editorView.dispatch({
          changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: nextText
          }
        });

        const clampedAnchor = clampPositionToDoc(editorView, anchor) ?? 0;
        editorView.dispatch({
          selection: {
            anchor: clampedAnchor,
            head: clampedAnchor
          },
          scrollIntoView: true
        });
        editorView.focus();

        return {
          ok: true,
          length: nextText.length,
          snapshot: this.getStateSnapshot({ maxLines: 140 })
        };
      },
      loadFixture(name, options = {}) {
        const fixtureName = typeof name === 'string' ? name.trim() : '';
        const fixtureText = readProbeFixture(fixtureName);
        if (typeof fixtureText !== 'string') {
          return {
            ok: false,
            reason: 'fixture-not-found',
            fixtureName,
            availableFixtures: this.listFixtures()
          };
        }

        const result = this.setDocText(fixtureText, options);
        return {
          ...result,
          fixtureName
        };
      },
      getTypographyMetrics() {
        if (!editorView) {
          return {
            ready: false
          };
        }
        return readTypographyMetrics(editorView);
      },
      setCursor(position) {
        if (!editorView) {
          return {
            ok: false,
            reason: 'editor-not-ready'
          };
        }

        const target = clampPositionToDoc(editorView, position);
        if (!Number.isFinite(target)) {
          return {
            ok: false,
            reason: 'invalid-position'
          };
        }

        editorView.dispatch({
          selection: {
            anchor: target,
            head: target
          },
          scrollIntoView: true
        });
        editorView.focus();

        return {
          ok: true,
          position: target,
          snapshot: this.getStateSnapshot({ maxLines: 120 })
        };
      },
      setCursorByLineColumn(lineNumber, column = 0) {
        if (!editorView?.state?.doc) {
          return {
            ok: false,
            reason: 'editor-not-ready'
          };
        }

        const normalizedLine = Math.max(1, Math.min(editorView.state.doc.lines, Math.trunc(lineNumber)));
        const normalizedColumn = Math.max(0, Math.trunc(column));
        const line = editorView.state.doc.line(normalizedLine);
        const position = Math.min(line.to, line.from + normalizedColumn);
        return this.setCursor(position);
      },
      moveCursorHorizontal(direction, repeat = 1) {
        if (!editorView || !runtime?.moveCursorHorizontally) {
          return {
            ok: false,
            reason: 'editor-not-ready'
          };
        }

        const normalizedDirection = Number.isFinite(direction) ? Math.trunc(direction) : 0;
        if (normalizedDirection !== -1 && normalizedDirection !== 1) {
          return {
            ok: false,
            reason: 'invalid-direction',
            direction
          };
        }

        const iterations = Math.max(1, Math.min(10, Math.trunc(repeat)));
        let movedCount = 0;
        for (let index = 0; index < iterations; index += 1) {
          const moved = runtime.moveCursorHorizontally(
            editorView,
            normalizedDirection,
            'probe-horizontal'
          );
          if (!moved) {
            break;
          }
          movedCount += 1;
        }

        return {
          ok: true,
          movedCount,
          snapshot: this.getStateSnapshot({ maxLines: 120 })
        };
      }
    };
  }

  function installProbeApi() {
    if (!window || typeof window !== 'object') {
      return;
    }
    window[probeApiKey] = createProbeApi();
  }

  function uninstallProbeApi() {
    if (!window || typeof window !== 'object') {
      return;
    }

    if (window[probeApiKey]) {
      delete window[probeApiKey];
    }
  }

  function probeLayoutMetrics(view, reason = 'update') {
    const now = Date.now();
    if (now - liveDebugDiagnostics.lastLayoutProbeAt < LIVE_CONSTANTS.LIVE_DEBUG_CURSOR_PROBE_THROTTLE_MS) {
      return;
    }
    liveDebugDiagnostics.lastLayoutProbeAt = now;

    const lineElement = view.dom.querySelector('.cm-line');
    const cursorElement = view.dom.querySelector('.cm-cursor');
    const widgetElement = view.dom.querySelector('.mm-live-v4-block-widget');
    const guttersElement = view.dom.querySelector('.cm-gutters');

    const lineRect = lineElement?.getBoundingClientRect?.() ?? null;
    const cursorRect = cursorElement?.getBoundingClientRect?.() ?? null;
    const widgetStyle = widgetElement ? window.getComputedStyle(widgetElement) : null;
    const gutterStyle = guttersElement ? window.getComputedStyle(guttersElement) : null;

    liveDebug.trace('cursor.visibility.probe', {
      reason,
      hasFocus: view.hasFocus,
      selectionHead: view.state.selection.main.head,
      cursorState: {
        cursorHeight: cursorRect ? Number(cursorRect.height.toFixed(2)) : null,
        cursorWidth: cursorRect ? Number(cursorRect.width.toFixed(2)) : null
      },
      lineState: {
        lineHeight: lineRect ? Number(lineRect.height.toFixed(2)) : null
      }
    });

    liveDebug.trace('gutter.visibility.probe', {
      reason,
      gutterState: {
        display: gutterStyle?.display ?? null,
        visibility: gutterStyle?.visibility ?? null,
        visibleLineNumberCount: view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement').length,
        totalLineNumberCount: view.state.doc.lines
      }
    });

    liveDebug.trace('live-v4.layout.metrics', {
      reason,
      lineHeightPx: lineRect ? Number(lineRect.height.toFixed(2)) : null,
      cursorHeightPx: cursorRect ? Number(cursorRect.height.toFixed(2)) : null,
      widgetMarginTopPx: widgetStyle ? widgetStyle.marginTop : null,
      widgetMarginBottomPx: widgetStyle ? widgetStyle.marginBottom : null,
      widgetPaddingTopPx: widgetStyle ? widgetStyle.paddingTop : null,
      widgetPaddingBottomPx: widgetStyle ? widgetStyle.paddingBottom : null
    });
  }

  function traceSelectionAndSnapshot(view, update) {
    const selection = readSelectionSnapshot(view);
    const previousHead = liveDebugDiagnostics.previousSelectionHead;
    const previousLine = liveDebugDiagnostics.previousSelectionLine;

    const positionDelta = Number.isFinite(previousHead)
      ? Math.abs(selection.head - previousHead)
      : 0;
    const lineDelta = Number.isFinite(previousLine)
      ? Math.abs(selection.lineNumber - previousLine)
      : 0;

    liveDebug.trace('selection.changed', {
      head: selection.head,
      previousHead,
      lineNumber: selection.lineNumber,
      previousLineNumber: previousLine,
      lineFrom: selection.lineFrom,
      lineTo: selection.lineTo,
      lineLength: selection.lineLength,
      positionDelta,
      lineDelta,
      docChanged: Boolean(update.docChanged),
      selectionSet: Boolean(update.selectionSet),
      viewportChanged: Boolean(update.viewportChanged)
    });

    const snapshot = readLiveStateSnapshot(view);
    liveDebug.trace('snapshot.editor', {
      reason: update.docChanged ? 'doc-changed' : update.selectionSet ? 'selection-change' : 'update',
      selectionHead: selection.head,
      selectionLineNumber: selection.lineNumber,
      ...snapshot
    });

    if (snapshot.activeBlockLength > 360) {
      liveDebug.warn('live-v4.active-block.large', {
        activeBlockId: snapshot.activeBlockId,
        activeBlockType: snapshot.activeBlockType,
        activeBlockLength: snapshot.activeBlockLength
      });
    }

    liveDebugDiagnostics.previousSelectionHead = selection.head;
    liveDebugDiagnostics.previousSelectionLine = selection.lineNumber;
  }

  let editorView = null;

  const runtime = createLiveRuntime({
    app,
    liveDebug
  });

  const { getEditorText, setEditorText } = createEditorDocumentAdapter({
    app,
    liveDebug,
    liveDebugDiagnostics,
    getEditorView: () => editorView,
    nowFn: () => Date.now()
  });

  function renderFileList() {
    workspaceView.renderFileList({
      fileHandles: app.fileHandles,
      currentPath: app.currentPath,
      onOpenFile: (path) => workspaceController.openFile(path)
    });
  }

  const workspaceController = createWorkspaceController({
    app,
    windowObject: window,
    walkDirectory,
    ensureReadWritePermission,
    isMarkdownFile,
    readWorkspaceFromDb,
    writeWorkspaceToDb,
    setStatus,
    updateActionButtons,
    renderFileList,
    getEditorText,
    setEditorText,
    liveDebug
  });

  editorView = createEditor({
    parent: editorElement,
    livePreviewStateField: runtime.liveStateField,
    livePreviewAtomicRanges: runtime.liveAtomicRanges,
    livePreviewPointerHandlers: runtime.livePointerHandlers,
    slashCommandCompletion,
    moveLiveCursorVertically: runtime.moveCursorVertically,
    moveLiveCursorHorizontally: runtime.moveCursorHorizontally,
    adjustLiveListIndent: runtime.adjustListIndent,
    handleEditorUpdate(update) {
      liveDebug.trace('plugin.update', {
        docChanged: Boolean(update.docChanged),
        selectionSet: Boolean(update.selectionSet),
        viewportChanged: Boolean(update.viewportChanged),
        focusChanged: Boolean(update.focusChanged)
      });

      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        traceSelectionAndSnapshot(update.view, update);
        probeLayoutMetrics(update.view, update.docChanged ? 'doc-changed' : 'update');
      }

      if (update.viewportChanged) {
        const viewportWindow = (
          Number.isFinite(update?.view?.viewport?.from) &&
          Number.isFinite(update?.view?.viewport?.to)
        )
          ? {
            from: Math.trunc(update.view.viewport.from),
            to: Math.trunc(update.view.viewport.to)
          }
          : null;
        runtime.requestRefresh(update.view, 'viewport-change', viewportWindow);
      }

      if (!update.docChanged) {
        return;
      }

      const markdownText = getEditorText();
      liveDebug.trace('live-v4.document.changed', {
        length: markdownText.length
      });

      if (app.isLoadingFile) {
        return;
      }

      app.hasUnsavedChanges = markdownText !== app.lastSavedText;
      updateActionButtons();

      if (!app.hasUnsavedChanges) {
        return;
      }

      setStatus(`Unsaved changes in ${app.currentPath ?? 'scratch buffer'}...`);
      workspaceController.scheduleAutosave();
    }
  });
  installProbeApi();

  const trackableKeys = LIVE_CONSTANTS.LIVE_DEBUG_KEYLOG_KEYS;
  const onKeydownRoot = (event) => {
    if (!trackableKeys.has(event.key)) {
      return;
    }

    const selection = readSelectionSnapshot(editorView);
    liveDebug.trace('input.keydown.root', {
      key: event.key,
      selectionHead: selection.head,
      selectionLineNumber: selection.lineNumber
    });
  };

  editorView.dom.addEventListener('keydown', onKeydownRoot, true);

  runtime.requestRefresh(editorView, 'startup');
  traceSelectionAndSnapshot(editorView, {
    docChanged: false,
    selectionSet: false,
    viewportChanged: false
  });
  probeLayoutMetrics(editorView, 'startup');
  updateActionButtons();
  setStatus('Choose a vault folder with markdown files to start editing.');

  openFolderButton?.addEventListener('click', () => {
    void workspaceController.pickFolder();
  });

  newNoteButton?.addEventListener('click', () => {
    void workspaceController.createNewNote();
  });

  saveNowButton?.addEventListener('click', () => {
    void workspaceController.saveCurrentFile(true).catch((error) => {
      setStatus(`Save failed: ${error.message}`, true);
    });
  });

  let diagnosticsShutdown = false;
  const shutdownDiagnostics = () => {
    if (diagnosticsShutdown) {
      return;
    }
    diagnosticsShutdown = true;
    editorView?.dom?.removeEventListener?.('keydown', onKeydownRoot, true);
    uninstallProbeApi();
    launcherDebugBridge?.shutdown?.();
  };

  window.addEventListener('beforeunload', (event) => {
    shutdownDiagnostics();
    if (!app.hasUnsavedChanges) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  });
  window.addEventListener('pagehide', shutdownDiagnostics);

  void workspaceController.restoreWorkspaceState();
}
