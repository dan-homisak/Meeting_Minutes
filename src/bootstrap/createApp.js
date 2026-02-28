import { EditorSelection, Transaction } from '@codemirror/state';
import {
  findNearestBlockForPosition,
  resolveActivationBlockBounds,
} from '../core/selection/LiveActivationHelpers.js';
import { findBlockContainingPosition } from '../core/render/LiveBlockIndex.js';
import { annotateMarkdownTokensWithSourceRanges } from '../core/mapping/SourceRangeMapper.js';
import { MARKDOWN_ENGINE_OPTIONS, createMarkdownEngine } from '../markdownConfig.js';
import { createDocumentSession } from '../core/document/DocumentSession.js';
import { createLiveLineMappingHelpers } from '../live/liveLineMappingHelpers.js';
import { createLivePreviewBridge } from '../live/livePreviewBridge.js';
import { createLiveDiagnosticsLogHelpers } from '../live/liveDiagnosticsLogHelpers.js';
import { createPointerInputHelpers } from '../live/pointerInputHelpers.js';
import { normalizeLogString } from '../live/logString.js';
import { createLiveControllers } from './createLiveControllers.js';
import { slashCommandCompletion } from '../editor/slashCommands.js';
import { createMarkdownRenderer } from '../core/render/MarkdownRenderer.js';
import { createThemeController } from '../ui/themeController.js';
import { createWorkspaceView } from '../ui/workspaceView.js';
import { ensureReadWritePermission, isMarkdownFile, walkDirectory } from '../workspace/fileSystem.js';
import { readWorkspaceFromDb, writeWorkspaceToDb } from '../workspace/workspaceDb.js';
import { createEditor } from './createEditor.js';
import { startAppLifecycle } from './startAppLifecycle.js';
import { createLiveRuntimeHelpers } from './createLiveRuntimeHelpers.js';
import { createAppControllers } from './createAppControllers.js';
import { createTelemetryBootstrap } from './createTelemetryBootstrap.js';
import { createEditorDocumentAdapter } from './createEditorDocumentAdapter.js';
import { createAppShellContext } from './createAppShellContext.js';
import { createLiveDebugBootstrap } from './createLiveDebugBootstrap.js';
import { createLiveControllerOptions } from './createLiveControllerOptions.js';
import { createExtensions } from './createExtensions.js';
import {
  LAUNCHER_HEARTBEAT_MS,
  LIVE_DEBUG_CURSOR_ACTIVE_LINE_MISSING_THROTTLE_MS,
  LIVE_DEBUG_CURSOR_MAX_EXPECTED_HEIGHT_PX,
  LIVE_DEBUG_CURSOR_MAX_EXPECTED_WIDTH_PX,
  LIVE_DEBUG_CURSOR_PROBE_THROTTLE_MS,
  LIVE_DEBUG_CURSOR_RECOVERY_COOLDOWN_MS,
  LIVE_DEBUG_CURSOR_RIGHT_DRIFT_PX,
  LIVE_DEBUG_CURSOR_TRANSIENT_DRIFT_DELTA_PX,
  LIVE_DEBUG_DOM_SELECTION_THROTTLE_MS,
  LIVE_DEBUG_GUTTER_PROBE_THROTTLE_MS,
  LIVE_DEBUG_INPUT_TTL_MS,
  LIVE_DEBUG_KEYLOG_KEYS,
  LIVE_DEBUG_SELECTION_JUMP_SUPPRESS_AFTER_PROGRAMMATIC_MS,
  LIVE_DEBUG_SELECTION_JUMP_WARN_LINE_DELTA,
  LIVE_DEBUG_SELECTION_JUMP_WARN_POS_DELTA,
  LIVE_DEBUG_UPLOAD_DEBOUNCE_MS,
  LIVE_DEBUG_UPLOAD_MAX_BATCH,
  LIVE_DEBUG_UPLOAD_MAX_QUEUE
} from './liveConstants.js';


export function createApp({
  windowObject,
  documentObject,
  navigatorObject,
  fetchImpl,
  isDevBuild = false
} = {}) {
  const window = windowObject;
  const document = documentObject;
  const navigator = navigatorObject;
  const fetch = fetchImpl;
  const {
    app,
    openFolderButton,
    newNoteButton,
    saveNowButton,
    rawModeButton,
    liveModeButton,
    previewModeButton,
    themeToggleButton,
    statusElement,
    fileCountElement,
    fileListElement,
    editorElement,
    previewElement,
    appShellElement,
    rootElement
  } = createAppShellContext({
    documentObject: document
  });
  
  const urlParams = new URLSearchParams(window.location.search);
  const launcherToken = urlParams.get('launcherToken');
  
  const markdownEngine = createMarkdownEngine();
  const documentSession = createDocumentSession({
    markdownEngine
  });
  const markdownRenderer = createMarkdownRenderer({
    markdownEngine,
    previewElement,
    annotateMarkdownTokensWithSourceRanges
  });
  const { renderPreview } = markdownRenderer;
  const workspaceView = createWorkspaceView({
    statusElement,
    fileCountElement,
    fileListElement,
    newNoteButton,
    saveNowButton
  });
  const themeController = createThemeController({
    rootElement,
    themeToggleButton,
    storage: window.localStorage,
    prefersDarkColorSchemeQuery: window.matchMedia?.('(prefers-color-scheme: dark)') ?? null
  });
  
  const { liveDebug, setLiveDebugLevel } = createLiveDebugBootstrap({
    windowObject: window,
    isDevBuild,
    markdownEngineOptions: MARKDOWN_ENGINE_OPTIONS
  });
  
  const liveDebugDiagnostics = {
    lastInputSignal: null,
    longTaskObserver: null,
    lastSelectionJumpLoggedAt: 0,
    lastProgrammaticSelectionAt: 0,
    lastDomSelectionChangeLoggedAt: 0,
    lastCursorProbeAt: 0,
    lastCursorActiveLineMissingLoggedAt: 0,
    lastGutterProbeAt: 0,
    lastCursorRecoveryAt: 0,
    cursorRecoveryInFlight: false
  };
  let livePreviewController = null;
  let livePreviewStateField = null;
  let refreshLivePreviewEffect = null;
  let livePreviewPointerHandlers = null;
  let livePreviewAtomicRanges = null;
  let pointerActivationController = null;
  let liveViewportProbe = null;
  let cursorVisibilityController = null;
  let cursorNavigationController = null;
  let liveDiagnosticsController = null;
  let selectionDiagnosticsController = null;
  let liveSnapshotController = null;
  let liveDiagnosticsLogHelpers = null;
  let liveLineMappingHelpers = null;
  let pointerInputHelpers = null;
  let livePreviewBridge = null;
  let editorUpdateController = null;
  let editorView = null;
  
  liveDiagnosticsLogHelpers = createLiveDiagnosticsLogHelpers({
    normalizeLogString,
    windowObject: window,
    elementConstructor: typeof Element === 'function' ? Element : null,
    nodeConstructor: typeof Node === 'function' ? Node : null
  });
  liveLineMappingHelpers = createLiveLineMappingHelpers({
    normalizeLogString
  });
  pointerInputHelpers = createPointerInputHelpers({
    elementConstructor: typeof Element === 'function' ? Element : null,
    nodeConstructor: typeof Node === 'function' ? Node : null
  });
  livePreviewBridge = createLivePreviewBridge({
    getLivePreviewController: () => livePreviewController,
    getEditorView: () => editorView
  });
  
  const liveRuntimeHelpers = createLiveRuntimeHelpers({
    liveDebugInputTtlMs: LIVE_DEBUG_INPUT_TTL_MS,
    windowObject: window,
    nowFn: () => Date.now(),
    liveDiagnosticsLogHelpers,
    liveLineMappingHelpers,
    pointerInputHelpers,
    getLiveViewportProbe: () => liveViewportProbe,
    getLivePreviewBridge: () => livePreviewBridge,
    getLiveSnapshotController: () => liveSnapshotController,
    getCursorVisibilityController: () => cursorVisibilityController,
    getCursorNavigationController: () => cursorNavigationController,
    getPointerActivationController: () => pointerActivationController
  });
  
  const { getEditorText, setEditorText } = createEditorDocumentAdapter({
    app,
    liveDebug,
    liveDebugDiagnostics,
    getEditorView: () => editorView,
    nowFn: () => Date.now()
  });
  
  const {
    setStatus,
    updateActionButtons,
    setViewMode,
    saveCurrentFile,
    scheduleAutosave,
    restoreWorkspaceState,
    pickFolder,
    createNewNote
  } = createAppControllers({
    app,
    workspaceView,
    windowObject: window,
    walkDirectory,
    ensureReadWritePermission,
    isMarkdownFile,
    readWorkspaceFromDb,
    writeWorkspaceToDb,
    getEditorText,
    setEditorText,
    readDocumentModel: () => documentSession.getModel(),
    renderPreview,
    liveDebug,
    editorElement,
    previewElement,
    rawModeButton,
    liveModeButton,
    previewModeButton,
    requestLivePreviewRefresh: liveRuntimeHelpers.requestLivePreviewRefresh,
    getEditorView: () => editorView,
    emitFenceVisibilityState: liveRuntimeHelpers.emitFenceVisibilityState,
    requestAnimationFrameFn: (callback) => window.requestAnimationFrame(callback)
  });
  
  const {
    liveSnapshotController: resolvedLiveSnapshotController,
    liveDebugPanelController,
    startLauncherHeartbeat
  } = createTelemetryBootstrap({
    app,
    launcherToken,
    liveDebug,
    liveDebugDiagnostics,
    liveDebugInputTtlMs: LIVE_DEBUG_INPUT_TTL_MS,
    heartbeatMs: LAUNCHER_HEARTBEAT_MS,
    uploadDebounceMs: LIVE_DEBUG_UPLOAD_DEBOUNCE_MS,
    uploadMaxBatch: LIVE_DEBUG_UPLOAD_MAX_BATCH,
    uploadMaxQueue: LIVE_DEBUG_UPLOAD_MAX_QUEUE,
    findBlockContainingPosition,
    findNearestBlockForPosition,
    readLivePreviewState: liveRuntimeHelpers.readLivePreviewState,
    readDomSelectionForLog: liveRuntimeHelpers.readDomSelectionForLog,
    appShellElement,
    statusElement,
    isDevBuild,
    setLiveDebugLevel,
    setStatus,
    captureLiveDebugSnapshot: liveRuntimeHelpers.captureLiveDebugSnapshot,
    getEditorView: () => editorView,
    nowFn: () => Date.now(),
    windowObject: window,
    navigatorObject: navigator,
    fetchImpl: fetch,
    documentObject: document
  });
  liveSnapshotController = resolvedLiveSnapshotController;
  
  ({
    refreshLivePreviewEffect,
    livePreviewController,
    livePreviewStateField,
    livePreviewPointerHandlers,
    livePreviewAtomicRanges
  } = createExtensions({
    app,
    liveDebug,
    markdownEngine,
    documentSession,
    renderMarkdownHtml: markdownRenderer.renderMarkdownHtml,
    liveDebugKeylogKeys: LIVE_DEBUG_KEYLOG_KEYS,
    liveRuntimeHelpers
  }));
  
  const liveControllerConfig = {
    liveDebugCursorMaxExpectedHeightPx: LIVE_DEBUG_CURSOR_MAX_EXPECTED_HEIGHT_PX,
    liveDebugCursorMaxExpectedWidthPx: LIVE_DEBUG_CURSOR_MAX_EXPECTED_WIDTH_PX,
    liveDebugCursorRightDriftPx: LIVE_DEBUG_CURSOR_RIGHT_DRIFT_PX,
    liveDebugCursorTransientDriftDeltaPx: LIVE_DEBUG_CURSOR_TRANSIENT_DRIFT_DELTA_PX,
    liveDebugCursorProbeThrottleMs: LIVE_DEBUG_CURSOR_PROBE_THROTTLE_MS,
    liveDebugCursorActiveLineMissingThrottleMs: LIVE_DEBUG_CURSOR_ACTIVE_LINE_MISSING_THROTTLE_MS,
    liveDebugGutterProbeThrottleMs: LIVE_DEBUG_GUTTER_PROBE_THROTTLE_MS,
    liveDebugCursorRecoveryCooldownMs: LIVE_DEBUG_CURSOR_RECOVERY_COOLDOWN_MS,
    liveDebugSelectionJumpWarnLineDelta: LIVE_DEBUG_SELECTION_JUMP_WARN_LINE_DELTA,
    liveDebugSelectionJumpWarnPosDelta: LIVE_DEBUG_SELECTION_JUMP_WARN_POS_DELTA,
    liveDebugSelectionJumpSuppressAfterProgrammaticMs:
      LIVE_DEBUG_SELECTION_JUMP_SUPPRESS_AFTER_PROGRAMMATIC_MS,
    liveDebugDomSelectionThrottleMs: LIVE_DEBUG_DOM_SELECTION_THROTTLE_MS,
    liveDebugKeylogKeys: LIVE_DEBUG_KEYLOG_KEYS
  };
  
  const liveControllerOptions = createLiveControllerOptions({
    app,
    liveDebug,
    liveDebugDiagnostics,
    config: liveControllerConfig,
    normalizeLogString,
    liveRuntimeHelpers,
    resolveActivationBlockBounds,
    isRefreshEffect: (effect) => effect?.is(refreshLivePreviewEffect),
    renderPreview,
    updateActionButtons,
    setStatus,
    scheduleAutosave,
    readDocumentModel: () => documentSession.getModel(),
    windowObject: window,
    documentObject: document,
    requestAnimationFrameFn: (callback) => window.requestAnimationFrame(callback),
    createCursorSelection: (position, assoc) => EditorSelection.cursor(position, assoc),
    transactionUserEventAnnotation: Transaction.userEvent,
    performanceObserverClass: typeof PerformanceObserver === 'function' ? PerformanceObserver : null,
    elementConstructor: typeof Element === 'function' ? Element : null,
    nodeConstructor: typeof Node === 'function' ? Node : null,
    nowFn: () => Date.now()
  });
  
  ({
    liveViewportProbe,
    pointerActivationController,
    cursorVisibilityController,
    cursorNavigationController,
    liveDiagnosticsController,
    selectionDiagnosticsController,
    editorUpdateController
  } = createLiveControllers(liveControllerOptions));
  
  editorView = createEditor({
    parent: editorElement,
    livePreviewStateField,
    livePreviewAtomicRanges,
    livePreviewPointerHandlers,
    slashCommandCompletion,
    moveLiveCursorVertically: liveRuntimeHelpers.moveLiveCursorVertically,
    handleEditorUpdate: (update) => {
      editorUpdateController?.handleEditorUpdate(update);
    }
  });
  
  startAppLifecycle({
    app,
    editorView,
    openFolderButton,
    newNoteButton,
    saveNowButton,
    rawModeButton,
    liveModeButton,
    previewModeButton,
    windowObject: window,
    installEditorInputDiagnostics: (view) => {
      liveDiagnosticsController.installEditorInputDiagnostics(view);
    },
    installRuntimeDiagnostics: () => {
      liveDiagnosticsController.installRuntimeDiagnostics();
    },
    mountLiveDebugPanel: () => liveDebugPanelController.mountLiveDebugPanel(),
    initTheme: () => themeController.initTheme(),
    renderPreview,
    setViewMode,
    updateActionButtons,
    pickFolder,
    createNewNote,
    saveCurrentFile,
    setStatus,
    restoreWorkspaceState,
    startLauncherHeartbeat
  });
}
