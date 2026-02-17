import './style.css';
import { EditorSelection, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, keymap, WidgetType } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { markdown, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { basicSetup } from 'codemirror';
import DOMPurify from 'dompurify';
import {
  annotateMarkdownTokensWithSourceRanges,
  blockContainsLine,
  collectTopLevelBlocks,
  findBlockContainingPosition,
  findNearestBlockForPosition,
  isFencedCodeBlock,
  parseSourceFromAttribute,
  resolveActivationBlockBounds,
  resolveLiveBlockSelection,
  shouldPreferRenderedDomAnchorPosition,
  shouldPreferSourceFromForRenderedBoundaryClick,
  shouldPreferSourceFromForRenderedFencedClick,
  shouldSkipEmptyTrailingBoundaryBlock,
  splitBlockAroundActiveLine
} from './livePreviewCore.js';
import {
  attachLiveDebugToWindow,
  createLiveDebugLogger,
  persistLiveDebugLevel,
  readStoredLiveDebugLevel,
  resolveLiveDebugLevel
} from './liveDebugLogger.js';
import { MARKDOWN_ENGINE_OPTIONS, createMarkdownEngine } from './markdownConfig.js';

const DB_NAME = 'meeting-minutes-mvp';
const DB_VERSION = 1;
const DB_STORE = 'workspace';
const WORKSPACE_KEY = 'active-workspace';
const LAUNCHER_HEARTBEAT_MS = 4000;
const LIVE_DEBUG_UPLOAD_DEBOUNCE_MS = 900;
const LIVE_DEBUG_UPLOAD_MAX_BATCH = 200;
const LIVE_DEBUG_UPLOAD_MAX_QUEUE = 4000;
const LIVE_PREVIEW_FRAGMENT_CACHE_MAX = 2500;
const LIVE_PREVIEW_SLOW_BUILD_WARN_MS = 12;
const LIVE_DEBUG_INPUT_TTL_MS = 900;
const LIVE_DEBUG_SELECTION_JUMP_WARN_LINE_DELTA = 20;
const LIVE_DEBUG_SELECTION_JUMP_WARN_POS_DELTA = 80;
const LIVE_DEBUG_SELECTION_JUMP_SUPPRESS_AFTER_PROGRAMMATIC_MS = 900;
const LIVE_DEBUG_DOM_SELECTION_THROTTLE_MS = 120;
const LIVE_DEBUG_CURSOR_PROBE_THROTTLE_MS = 100;
const LIVE_DEBUG_GUTTER_PROBE_THROTTLE_MS = 220;
const LIVE_DEBUG_CURSOR_ACTIVE_LINE_MISSING_THROTTLE_MS = 220;
const LIVE_DEBUG_CURSOR_RECOVERY_COOLDOWN_MS = 260;
const LIVE_DEBUG_CURSOR_MAX_EXPECTED_HEIGHT_PX = 42;
const LIVE_DEBUG_CURSOR_MAX_EXPECTED_WIDTH_PX = 6;
const LIVE_DEBUG_CURSOR_RIGHT_DRIFT_PX = 12;
const LIVE_DEBUG_CURSOR_TRANSIENT_DRIFT_DELTA_PX = 80;
const LIVE_DEBUG_BLOCK_MAP_LARGE_DELTA_POS = 20;
const LIVE_DEBUG_BLOCK_MAP_LARGE_DELTA_LINES = 2;
const LIVE_PREVIEW_RENDERED_FENCED_STICKY_MAX_POS_DELTA = 12;
const LIVE_PREVIEW_RENDERED_FENCED_STICKY_MAX_LINE_DELTA = 2;
const LIVE_PREVIEW_RENDERED_BOUNDARY_STICKY_MAX_POS_DELTA = 30;
const LIVE_PREVIEW_RENDERED_BOUNDARY_STICKY_MAX_LINE_DELTA = 3;
const LIVE_PREVIEW_RENDERED_BOUNDARY_STICKY_MAX_DISTANCE_FROM_BOTTOM_PX = 14;
const LIVE_PREVIEW_RENDERED_BOUNDARY_STICKY_MIN_RATIO_Y = 0.3;
const LIVE_PREVIEW_RENDERED_DOM_ANCHOR_STICKY_MAX_POS_DELTA = 40;

const openFolderButton = document.querySelector('#open-folder');
const newNoteButton = document.querySelector('#new-note');
const saveNowButton = document.querySelector('#save-now');
const rawModeButton = document.querySelector('#mode-raw');
const liveModeButton = document.querySelector('#mode-live');
const previewModeButton = document.querySelector('#mode-preview');
const themeToggleButton = document.querySelector('#theme-toggle');
const statusElement = document.querySelector('#status');
const fileCountElement = document.querySelector('#file-count');
const fileListElement = document.querySelector('#file-list');
const editorElement = document.querySelector('#editor');
const previewElement = document.querySelector('#preview');
const appShellElement = document.querySelector('.app-shell');
const rootElement = document.documentElement;

const app = {
  folderHandle: null,
  fileHandles: new Map(),
  currentPath: null,
  currentFileHandle: null,
  lastSavedText: '',
  hasUnsavedChanges: false,
  isLoadingFile: false,
  autosaveTimer: null,
  viewMode: 'raw'
};
const THEME_STORAGE_KEY = 'meeting-minutes-theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';
const prefersDarkColorSchemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
let activeTheme = THEME_LIGHT;

const NAVIGATION_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown'
]);
const LIVE_DEBUG_KEYLOG_KEYS = new Set([
  ...NAVIGATION_KEYS,
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Escape'
]);

const launcherToken = new URLSearchParams(window.location.search).get('launcherToken');
let launcherHeartbeatTimer = null;

const markdownEngine = createMarkdownEngine();

function readStoredTheme(storage) {
  if (!storage) {
    return null;
  }

  try {
    const theme = storage.getItem(THEME_STORAGE_KEY);
    return theme === THEME_LIGHT || theme === THEME_DARK ? theme : null;
  } catch {
    return null;
  }
}

function persistTheme(storage, theme) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage errors to keep theming functional without persistence.
  }
}

function resolveInitialTheme() {
  const storedTheme = readStoredTheme(window.localStorage);
  if (storedTheme) {
    return storedTheme;
  }

  return prefersDarkColorSchemeQuery?.matches ? THEME_DARK : THEME_LIGHT;
}

function applyTheme(nextTheme, options = {}) {
  const persist = options.persist !== false;
  const theme = nextTheme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
  activeTheme = theme;

  rootElement.dataset.theme = theme;
  rootElement.style.colorScheme = theme;

  if (themeToggleButton) {
    const isDark = theme === THEME_DARK;
    themeToggleButton.textContent = isDark ? 'Light mode' : 'Dark mode';
    themeToggleButton.setAttribute('aria-pressed', String(isDark));
    themeToggleButton.setAttribute(
      'aria-label',
      isDark ? 'Switch to light mode' : 'Switch to dark mode'
    );
  }

  if (persist) {
    persistTheme(window.localStorage, theme);
  }
}

function toggleTheme() {
  applyTheme(activeTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK);
}

function initTheme() {
  applyTheme(resolveInitialTheme(), { persist: false });

  if (themeToggleButton) {
    themeToggleButton.addEventListener('click', toggleTheme);
  }

  prefersDarkColorSchemeQuery?.addEventListener?.('change', (event) => {
    if (readStoredTheme(window.localStorage)) {
      return;
    }
    applyTheme(event.matches ? THEME_DARK : THEME_LIGHT, { persist: false });
  });
}

const markdownCommands = [
  {
    label: 'h1',
    type: 'keyword',
    detail: 'Heading 1',
    apply: '# '
  },
  {
    label: 'h2',
    type: 'keyword',
    detail: 'Heading 2',
    apply: '## '
  },
  {
    label: 'h3',
    type: 'keyword',
    detail: 'Heading 3',
    apply: '### '
  },
  {
    label: 'bullet',
    type: 'keyword',
    detail: 'Bullet list',
    apply: '- '
  },
  {
    label: 'numbered',
    type: 'keyword',
    detail: 'Numbered list',
    apply: '1. '
  },
  {
    label: 'task',
    type: 'keyword',
    detail: 'Task checkbox',
    apply: '- [ ] '
  },
  {
    label: 'quote',
    type: 'keyword',
    detail: 'Blockquote',
    apply: '> '
  },
  {
    label: 'code',
    type: 'keyword',
    detail: 'Code fence',
    apply: '```\n\n```'
  },
  {
    label: 'link',
    type: 'keyword',
    detail: 'Markdown link',
    apply: '[label](https://example.com)'
  },
  {
    label: 'image',
    type: 'keyword',
    detail: 'Markdown image',
    apply: '![alt text](image-path.png)'
  },
  {
    label: 'table',
    type: 'keyword',
    detail: 'Basic table',
    apply: '| Column | Value |\n| --- | --- |\n| Item | Detail |'
  }
];

const refreshLivePreviewEffect = StateEffect.define();
const isDevBuild = Boolean(import.meta.env?.DEV);
const configuredLiveDebugLevel = resolveLiveDebugLevel({
  search: window.location.search,
  storedValue: readStoredLiveDebugLevel(window.localStorage)
});
const initialLiveDebugLevel = configuredLiveDebugLevel === 'off' && isDevBuild ? 'trace' : configuredLiveDebugLevel;
const liveDebug = createLiveDebugLogger({
  scope: 'live-preview',
  level: initialLiveDebugLevel
});

function setLiveDebugLevel(level) {
  const nextLevel = liveDebug.setLevel(level);
  persistLiveDebugLevel(window.localStorage, nextLevel);
  return nextLevel;
}

setLiveDebugLevel(liveDebug.getLevel());
attachLiveDebugToWindow(window, liveDebug, setLiveDebugLevel);
liveDebug.info('markdown.engine.config', MARKDOWN_ENGINE_OPTIONS);

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

function normalizeLogString(value, maxLength = 120) {
  if (typeof value !== 'string') {
    return '';
  }

  const compact = value.trim().replace(/\s+/g, ' ');
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength)}...`;
}

function describeElementForLog(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  return {
    tagName: element.tagName,
    id: element.id || '',
    className:
      typeof element.className === 'string' ? normalizeLogString(element.className, 140) : '',
    sourceFrom: element.getAttribute('data-source-from') ?? null,
    fragmentFrom: element.getAttribute('data-fragment-from') ?? null,
    textPreview: normalizeLogString(element.textContent ?? '', 90)
  };
}

function describeNodeForLog(node) {
  if (!node) {
    return null;
  }

  if (node instanceof Element) {
    return describeElementForLog(node);
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    return {
      nodeType: 'text',
      textPreview: normalizeLogString(node.textContent ?? '', 60),
      parentTag: parent?.tagName ?? null,
      parentClass:
        typeof parent?.className === 'string' ? normalizeLogString(parent.className, 120) : null
    };
  }

  return {
    nodeType: String(node.nodeType)
  };
}

function readDomSelectionForLog(targetWindow = window) {
  try {
    const domSelection = targetWindow.getSelection?.() ?? null;
    const activeElement =
      targetWindow.document?.activeElement instanceof Element
        ? targetWindow.document.activeElement
        : null;

    if (!domSelection) {
      return {
        hasSelection: false,
        activeElement: describeElementForLog(activeElement)
      };
    }

    return {
      hasSelection: true,
      rangeCount: domSelection.rangeCount,
      isCollapsed: domSelection.isCollapsed,
      anchorOffset: domSelection.anchorOffset,
      focusOffset: domSelection.focusOffset,
      anchorNode: describeNodeForLog(domSelection.anchorNode),
      focusNode: describeNodeForLog(domSelection.focusNode),
      activeElement: describeElementForLog(activeElement)
    };
  } catch (error) {
    return {
      hasSelection: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function summarizeTransactionsForLog(update) {
  if (!Array.isArray(update.transactions) || update.transactions.length === 0) {
    return {
      count: 0,
      selectionTransactions: 0,
      docChangedTransactions: 0,
      refreshEffectTransactions: 0,
      details: []
    };
  }

  const details = update.transactions.slice(0, 4).map((transaction, index) => ({
    index,
    docChanged: Boolean(transaction.docChanged),
    hasSelection: Boolean(transaction.selection),
    effectCount: Array.isArray(transaction.effects) ? transaction.effects.length : 0,
    userEvent: transaction.annotation(Transaction.userEvent) ?? null,
    refreshEffects: Array.isArray(transaction.effects)
      ? transaction.effects.filter((effect) => effect.is(refreshLivePreviewEffect)).length
      : 0
  }));

  return {
    count: update.transactions.length,
    selectionTransactions: details.filter((entry) => entry.hasSelection).length,
    docChangedTransactions: details.filter((entry) => entry.docChanged).length,
    refreshEffectTransactions: details.reduce(
      (sum, entry) => sum + entry.refreshEffects,
      0
    ),
    details
  };
}

function parsePositivePixelValue(rawValue) {
  const numeric = Number.parseFloat(String(rawValue ?? ''));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

function resolveCursorLineHeight(view, cursorRect = null) {
  const candidates = [
    ['content-style', window.getComputedStyle(view.contentDOM).lineHeight],
    ['scroller-style', window.getComputedStyle(view.scrollDOM).lineHeight],
    ['editor-style', window.getComputedStyle(view.dom).lineHeight],
    ['cm-default-line-height', view.defaultLineHeight],
    ['cursor-fallback', cursorRect?.height]
  ];

  for (const [source, rawValue] of candidates) {
    const parsed = parsePositivePixelValue(rawValue);
    if (parsed === null) {
      continue;
    }

    // Cursor fallback only helps when cursor geometry already looks plausible.
    if (source === 'cursor-fallback' && parsed > LIVE_DEBUG_CURSOR_MAX_EXPECTED_HEIGHT_PX) {
      continue;
    }

    return {
      lineHeight: Number(parsed.toFixed(2)),
      lineHeightSource: source
    };
  }

  return {
    lineHeight: null,
    lineHeightSource: null
  };
}

function readCursorVisibilityForLog(view, selectionHead = Number.NaN) {
  if (!view?.dom || !view?.scrollDOM) {
    return {
      hasView: false
    };
  }

  const cursorElement = view.dom.querySelector('.cm-cursor');
  const cursorCount = view.dom.querySelectorAll('.cm-cursor').length;
  const cursorRect = cursorElement?.getBoundingClientRect?.() ?? null;
  const scrollerRect = view.scrollDOM.getBoundingClientRect();
  const activeLineElement = view.dom.querySelector('.cm-activeLine');
  const activeLineRect = activeLineElement?.getBoundingClientRect?.() ?? null;
  const headCoords = Number.isFinite(selectionHead) ? view.coordsAtPos(selectionHead) : null;
  const headLineBlock = Number.isFinite(selectionHead) ? view.lineBlockAt(selectionHead) : null;
  const { lineHeight, lineHeightSource } = resolveCursorLineHeight(view, cursorRect);
  const inVerticalViewport = Boolean(
    cursorRect &&
      cursorRect.bottom >= scrollerRect.top &&
      cursorRect.top <= scrollerRect.bottom
  );
  const inHorizontalViewport = Boolean(
    cursorRect &&
      cursorRect.right >= scrollerRect.left &&
      cursorRect.left <= scrollerRect.right
  );
  const farRightFromScroller = Boolean(
    cursorRect &&
      cursorRect.left > scrollerRect.right + LIVE_DEBUG_CURSOR_RIGHT_DRIFT_PX
  );
  const nearRightEdge = Boolean(
    cursorRect &&
      (cursorRect.left >= scrollerRect.right - 4 || farRightFromScroller)
  );
  const oversizedHeightByLineHeight = Boolean(
    cursorRect &&
      Number.isFinite(lineHeight) &&
      lineHeight > 0 &&
      cursorRect.height > lineHeight * 2.5
  );
  const oversizedHeightAbsolute = Boolean(
    cursorRect && cursorRect.height > LIVE_DEBUG_CURSOR_MAX_EXPECTED_HEIGHT_PX
  );
  const oversizedHeight = oversizedHeightByLineHeight || oversizedHeightAbsolute;
  const oversizedWidth = Boolean(
    cursorRect && cursorRect.width > LIVE_DEBUG_CURSOR_MAX_EXPECTED_WIDTH_PX
  );
  const headCoordsDeltaX =
    cursorRect && headCoords
      ? Number((cursorRect.left - headCoords.left).toFixed(2))
      : null;
  const cursorOutOfSyncWithHeadCoords = Boolean(
    Number.isFinite(headCoordsDeltaX) &&
      Math.abs(headCoordsDeltaX) >= LIVE_DEBUG_CURSOR_TRANSIENT_DRIFT_DELTA_PX
  );

  return {
    hasView: true,
    cursorCount,
    hasCursorElement: Boolean(cursorElement),
    cursorHeight: cursorRect ? Number(cursorRect.height.toFixed(2)) : null,
    cursorWidth: cursorRect ? Number(cursorRect.width.toFixed(2)) : null,
    cursorTop: cursorRect ? Number(cursorRect.top.toFixed(2)) : null,
    cursorRight: cursorRect ? Number(cursorRect.right.toFixed(2)) : null,
    cursorBottom: cursorRect ? Number(cursorRect.bottom.toFixed(2)) : null,
    cursorLeft: cursorRect ? Number(cursorRect.left.toFixed(2)) : null,
    headCoordsLeft: headCoords ? Number(headCoords.left.toFixed(2)) : null,
    headCoordsRight: headCoords ? Number(headCoords.right.toFixed(2)) : null,
    headCoordsTop: headCoords ? Number(headCoords.top.toFixed(2)) : null,
    headCoordsBottom: headCoords ? Number(headCoords.bottom.toFixed(2)) : null,
    headCoordsNearRightEdge: Boolean(
      headCoords && headCoords.left >= scrollerRect.right - 4
    ),
    headCoordsDeltaX,
    cursorOutOfSyncWithHeadCoords,
    headLineBlockFrom: headLineBlock?.from ?? null,
    headLineBlockTo: headLineBlock?.to ?? null,
    headLineBlockTop: Number.isFinite(headLineBlock?.top)
      ? Number(headLineBlock.top.toFixed(2))
      : null,
    headLineBlockHeight: Number.isFinite(headLineBlock?.height)
      ? Number(headLineBlock.height.toFixed(2))
      : null,
    activeLineElementPresent: Boolean(activeLineElement),
    activeLineLeft: activeLineRect ? Number(activeLineRect.left.toFixed(2)) : null,
    activeLineRight: activeLineRect ? Number(activeLineRect.right.toFixed(2)) : null,
    activeLineTop: activeLineRect ? Number(activeLineRect.top.toFixed(2)) : null,
    activeLineBottom: activeLineRect ? Number(activeLineRect.bottom.toFixed(2)) : null,
    activeLineTextPreview: activeLineElement
      ? normalizeLogString(activeLineElement.textContent ?? '', 90)
      : null,
    inVerticalViewport,
    inHorizontalViewport,
    nearRightEdge,
    farRightFromScroller,
    oversizedHeight,
    oversizedHeightByLineHeight,
    oversizedHeightAbsolute,
    oversizedWidth,
    lineHeight,
    lineHeightSource,
    scrollerLeft: Number(scrollerRect.left.toFixed(2)),
    scrollerRight: Number(scrollerRect.right.toFixed(2)),
    scrollerTop: Number(scrollerRect.top.toFixed(2)),
    scrollerBottom: Number(scrollerRect.bottom.toFixed(2)),
    scrollTop: Number(view.scrollDOM.scrollTop.toFixed(2)),
    scrollHeight: Number(view.scrollDOM.scrollHeight.toFixed(2)),
    clientHeight: Number(view.scrollDOM.clientHeight.toFixed(2))
  };
}

function readGutterVisibilityForLog(view) {
  if (!view?.dom || !view?.scrollDOM) {
    return {
      hasView: false
    };
  }

  const gutters = view.dom.querySelector('.cm-gutters');
  if (!gutters) {
    return {
      hasView: true,
      hasGutters: false
    };
  }

  const gutterStyle = window.getComputedStyle(gutters);
  const gutterRect = gutters.getBoundingClientRect();
  const scrollerRect = view.scrollDOM.getBoundingClientRect();
  const gutterElements = [...view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')];
  const visibleLineNumberCount = gutterElements.reduce((count, element) => {
    const rect = element.getBoundingClientRect();
    if (rect.height < 0.5) {
      return count;
    }

    const overlapsViewport =
      rect.bottom >= scrollerRect.top && rect.top <= scrollerRect.bottom;
    return overlapsViewport ? count + 1 : count;
  }, 0);

  return {
    hasView: true,
    hasGutters: true,
    display: gutterStyle.display,
    visibility: gutterStyle.visibility,
    width: Number(gutterRect.width.toFixed(2)),
    totalLineNumberCount: gutterElements.length,
    visibleLineNumberCount
  };
}

function isCursorVisibilitySuspect(cursorState, selectionLineLength, domSelectionOnContentContainer) {
  if (!cursorState?.hasView) {
    return true;
  }

  const offToRightOnEmptyLine =
    selectionLineLength === 0 &&
    (cursorState.nearRightEdge || cursorState.farRightFromScroller);
  const oversizedCursorHeight =
    cursorState.oversizedHeight ||
    (Number.isFinite(cursorState.cursorHeight) &&
      cursorState.cursorHeight > LIVE_DEBUG_CURSOR_MAX_EXPECTED_HEIGHT_PX);

  return (
    !cursorState.hasCursorElement ||
    cursorState.cursorHeight === 0 ||
    !cursorState.inVerticalViewport ||
    !cursorState.inHorizontalViewport ||
    cursorState.farRightFromScroller ||
    oversizedCursorHeight ||
    cursorState.oversizedWidth ||
    offToRightOnEmptyLine ||
    (domSelectionOnContentContainer && (oversizedCursorHeight || offToRightOnEmptyLine))
  );
}

function attemptCursorRecovery(
  view,
  reason,
  selectionHead,
  selectionLineNumber,
  selectionLineLength,
  cursorState
) {
  if (app.viewMode !== 'live') {
    return;
  }

  const now = Date.now();
  if (liveDebugDiagnostics.cursorRecoveryInFlight) {
    return;
  }

  if (now - liveDebugDiagnostics.lastCursorRecoveryAt < LIVE_DEBUG_CURSOR_RECOVERY_COOLDOWN_MS) {
    return;
  }

  liveDebugDiagnostics.cursorRecoveryInFlight = true;
  liveDebugDiagnostics.lastCursorRecoveryAt = now;

  const runRecoveryDispatch = (assoc, step) => {
    view.dispatch({
      selection: EditorSelection.cursor(selectionHead, assoc),
      scrollIntoView: true
    });
    view.focus();

    liveDebug.warn('cursor.recover.dispatch', {
      reason,
      step,
      assoc,
      selectionHead,
      selectionLineNumber,
      selectionLineLength,
      cursorState
    });
    scheduleCursorVisibilityProbe(view, `cursor-recover-${step}`);
  };

  try {
    runRecoveryDispatch(-1, 'primary');
    requestLivePreviewRefresh('cursor-recover-primary');
  } catch (error) {
    liveDebugDiagnostics.cursorRecoveryInFlight = false;
    liveDebug.error('cursor.recover.failed', {
      reason,
      step: 'primary',
      selectionHead,
      selectionLineNumber,
      message: error instanceof Error ? error.message : String(error)
    });
    return;
  }

  window.requestAnimationFrame(() => {
    try {
      if (app.viewMode !== 'live') {
        return;
      }

      if (view.state.selection.main.head !== selectionHead) {
        return;
      }

      const nextCursorState = readCursorVisibilityForLog(view, selectionHead);
      const stillSuspect = isCursorVisibilitySuspect(nextCursorState, selectionLineLength, false);
      if (!stillSuspect) {
        return;
      }

      runRecoveryDispatch(1, 'secondary');
      requestLivePreviewRefresh('cursor-recover-secondary');
    } catch (error) {
      liveDebug.error('cursor.recover.failed', {
        reason,
        step: 'secondary',
        selectionHead,
        selectionLineNumber,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      liveDebugDiagnostics.cursorRecoveryInFlight = false;
    }
  });
}

function probeCursorVisibility(view, reason = 'manual') {
  if (app.viewMode !== 'live') {
    return;
  }

  const now = Date.now();
  if (
    reason === 'selection-changed' &&
    now - liveDebugDiagnostics.lastCursorProbeAt < LIVE_DEBUG_CURSOR_PROBE_THROTTLE_MS
  ) {
    return;
  }
  liveDebugDiagnostics.lastCursorProbeAt = now;

  const selection = view.state.selection.main;
  const selectionLine = view.state.doc.lineAt(selection.head);
  const selectionLineLength = Math.max(0, selectionLine.to - selectionLine.from);
  const cursorState = readCursorVisibilityForLog(view, selection.head);
  const domSelection = readDomSelectionForLog();
  const hasFocus = Boolean(view.hasFocus);
  const expectCursor = hasFocus && selection.empty;
  const domSelectionOnContentContainer =
    typeof domSelection?.anchorNode?.className === 'string' &&
    domSelection.anchorNode.className.includes('cm-content');
  const transientCursorDrift =
    expectCursor &&
    cursorState.cursorOutOfSyncWithHeadCoords &&
    !cursorState.nearRightEdge &&
    !cursorState.farRightFromScroller;
  const offToRightOnEmptyLine =
    selectionLineLength === 0 &&
    (cursorState.nearRightEdge || cursorState.farRightFromScroller);
  const missingActiveLineElement =
    expectCursor &&
    selectionLineLength === 0 &&
    !cursorState.activeLineElementPresent;
  const suspectCursorVisibility =
    expectCursor &&
    isCursorVisibilitySuspect(
      cursorState,
      selectionLineLength,
      domSelectionOnContentContainer
    );

  liveDebug.trace('cursor.visibility.probe', {
    reason,
    hasFocus,
    selectionAnchor: selection.anchor,
    selectionHead: selection.head,
    selectionLineNumber: selectionLine.number,
    selectionLineLength,
    domSelectionOnContentContainer,
    expectCursor,
    transientCursorDrift,
    offToRightOnEmptyLine,
    missingActiveLineElement,
    suspectCursorVisibility,
    cursorState,
    domSelection
  });

  if (
    reason === 'selection-changed' &&
    transientCursorDrift
  ) {
    liveDebug.trace('cursor.visibility.defer-transient-drift', {
      reason,
      selectionHead: selection.head,
      selectionLineNumber: selectionLine.number,
      selectionLineLength,
      cursorState
    });
    scheduleCursorVisibilityProbe(view, 'selection-changed-transient-reprobe');
    return;
  }

  if (missingActiveLineElement) {
    const shouldLogActiveLineMissing =
      now - liveDebugDiagnostics.lastCursorActiveLineMissingLoggedAt >=
      LIVE_DEBUG_CURSOR_ACTIVE_LINE_MISSING_THROTTLE_MS;
    if (shouldLogActiveLineMissing) {
      liveDebugDiagnostics.lastCursorActiveLineMissingLoggedAt = now;
      liveDebug.warn('cursor.active-line.missing', {
        reason,
        selectionHead: selection.head,
        selectionLineNumber: selectionLine.number,
        selectionLineLength,
        cursorState
      });
    }
  }

  if (now - liveDebugDiagnostics.lastGutterProbeAt >= LIVE_DEBUG_GUTTER_PROBE_THROTTLE_MS) {
    liveDebugDiagnostics.lastGutterProbeAt = now;
    const gutterState = readGutterVisibilityForLog(view);
    liveDebug.trace('gutter.visibility.probe', {
      reason,
      mode: app.viewMode,
      gutterState
    });

    const gutterHiddenInLiveMode =
      app.viewMode === 'live' &&
      gutterState?.hasGutters &&
      (gutterState.display === 'none' || gutterState.visibility === 'hidden');
    if (gutterHiddenInLiveMode) {
      liveDebug.warn('gutter.visibility.hidden', {
        reason,
        gutterState
      });
    }
  }

  if (suspectCursorVisibility) {
    liveDebug.warn('cursor.visibility.suspect', {
      reason,
      hasFocus,
      selectionAnchor: selection.anchor,
      selectionHead: selection.head,
      cursorState,
      domSelection
    });
    captureLiveDebugSnapshot('cursor-visibility-suspect');
    attemptCursorRecovery(
      view,
      reason,
      selection.head,
      selectionLine.number,
      selectionLineLength,
      cursorState
    );
  }
}

function scheduleCursorVisibilityProbe(view, reason = 'manual') {
  if (!view || app.viewMode !== 'live') {
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      probeCursorVisibility(view, reason);
    });
  });
}

function recordInputSignal(kind, details = {}) {
  const signal = {
    at: Date.now(),
    kind,
    ...details
  };
  liveDebugDiagnostics.lastInputSignal = signal;
  return signal;
}

function readRecentInputSignal(maxAgeMs = LIVE_DEBUG_INPUT_TTL_MS) {
  const signal = liveDebugDiagnostics.lastInputSignal;
  if (!signal) {
    return null;
  }

  const ageMs = Date.now() - signal.at;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) {
    return null;
  }

  return {
    ...signal,
    ageMs
  };
}

function collectTransactionUserEvents(update) {
  if (!Array.isArray(update.transactions) || update.transactions.length === 0) {
    return [];
  }

  const seen = new Set();
  for (const transaction of update.transactions) {
    const userEvent = transaction.annotation(Transaction.userEvent);
    if (typeof userEvent === 'string' && userEvent.trim()) {
      seen.add(userEvent);
    }
  }

  return [...seen];
}

function captureLiveDebugSnapshot(reason = 'manual') {
  if (!editorView?.state) {
    liveDebug.trace('snapshot.unavailable', {
      reason,
      hasEditor: false
    });
    return;
  }

  const state = editorView.state;
  const selection = state.selection.main;
  const selectionLine = state.doc.lineAt(selection.head);
  const livePreviewState = readLivePreviewState(state);
  const blocks = Array.isArray(livePreviewState?.blocks) ? livePreviewState.blocks : [];
  const activeBlock =
    findBlockContainingPosition(blocks, selection.head) ??
    findNearestBlockForPosition(blocks, selection.head, 1);
  const recentInput = readRecentInputSignal();

  liveDebug.info('snapshot.editor', {
    reason,
    mode: app.viewMode,
    currentPath: app.currentPath,
    docLength: state.doc.length,
    lineCount: state.doc.lines,
    selectionAnchor: selection.anchor,
    selectionHead: selection.head,
    selectionLineNumber: selectionLine.number,
    selectionLineFrom: selectionLine.from,
    selectionLineTo: selectionLine.to,
    blockCount: blocks.length,
    activeBlockFrom: activeBlock?.from ?? null,
    activeBlockTo: activeBlock?.to ?? null,
    hasUnsavedChanges: app.hasUnsavedChanges,
    queuedUploadEntries: liveDebugUploadState.queue.length,
    loggerLevel: liveDebug.getLevel(),
    recentInputKind: recentInput?.kind ?? null,
    recentInputTrigger: recentInput?.trigger ?? null,
    recentInputKey: recentInput?.key ?? null,
    recentInputAgeMs: recentInput?.ageMs ?? null,
    domSelection: readDomSelectionForLog()
  });
}

function installRuntimeDiagnostics() {
  liveDebug.info('diagnostics.runtime.installed', {
    hasPerformanceObserver: typeof PerformanceObserver === 'function'
  });

  window.addEventListener('error', (event) => {
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

  window.addEventListener('unhandledrejection', (event) => {
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

  if (typeof PerformanceObserver !== 'function') {
    return;
  }

  const supportedEntryTypes = Array.isArray(PerformanceObserver.supportedEntryTypes)
    ? PerformanceObserver.supportedEntryTypes
    : [];
  if (!supportedEntryTypes.includes('longtask')) {
    return;
  }

  try {
    const observer = new PerformanceObserver((entryList) => {
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

let liveDebugPanelElements = null;

function formatLiveDebugEntry(entry) {
  const data = Object.keys(entry.data ?? {}).length > 0 ? ` ${JSON.stringify(entry.data)}` : '';
  return `${entry.at} ${entry.level.toUpperCase()} ${entry.event}${data}`;
}

function renderLiveDebugPanel() {
  if (!liveDebugPanelElements) {
    return;
  }

  const level = liveDebug.getLevel();
  const entries = liveDebug.getEntries().slice(-80);
  liveDebugPanelElements.levelSelect.value = level;
  liveDebugPanelElements.levelBadge.textContent = level.toUpperCase();
  liveDebugPanelElements.log.textContent =
    entries.length > 0
      ? entries.map(formatLiveDebugEntry).join('\n')
      : 'No live-view events captured yet.';

  const shouldOpen = isDevBuild || level !== 'off' || entries.length > 0;
  if (shouldOpen) {
    liveDebugPanelElements.root.setAttribute('open', 'open');
  }
}

async function copyLiveDebugEntries() {
  const entries = liveDebug.getEntries();
  const payload = JSON.stringify(entries, null, 2);

  try {
    await navigator.clipboard.writeText(payload);
    setStatus(`Copied ${entries.length} live debug entries.`);
  } catch (error) {
    setStatus(`Could not copy live debug entries: ${error.message}`, true);
  }
}

function mountLiveDebugPanel() {
  if (!appShellElement || !statusElement) {
    return;
  }

  const panel = document.createElement('details');
  panel.id = 'live-debug-panel';

  const summary = document.createElement('summary');
  summary.className = 'live-debug-summary';

  const title = document.createElement('strong');
  title.textContent = 'Live Debug';

  const badge = document.createElement('span');
  badge.className = 'live-debug-level-badge';
  badge.textContent = liveDebug.getLevel().toUpperCase();

  summary.append(title, badge);

  const controls = document.createElement('div');
  controls.className = 'live-debug-controls';

  const levelLabel = document.createElement('label');
  levelLabel.setAttribute('for', 'live-debug-level');
  levelLabel.textContent = 'Level';

  const levelSelect = document.createElement('select');
  levelSelect.id = 'live-debug-level';
  levelSelect.className = 'live-debug-level-select';
  for (const level of ['off', 'error', 'warn', 'info', 'trace']) {
    const option = document.createElement('option');
    option.value = level;
    option.textContent = level.toUpperCase();
    levelSelect.append(option);
  }
  levelSelect.value = liveDebug.getLevel();
  levelSelect.addEventListener('change', () => {
    setLiveDebugLevel(levelSelect.value);
    renderLiveDebugPanel();
    setStatus(`Live debug level set to ${liveDebug.getLevel()}.`);
  });

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.textContent = 'Clear';
  clearButton.addEventListener('click', () => {
    liveDebug.clearEntries();
    renderLiveDebugPanel();
  });

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy JSON';
  copyButton.addEventListener('click', () => {
    void copyLiveDebugEntries();
  });

  const snapshotButton = document.createElement('button');
  snapshotButton.type = 'button';
  snapshotButton.textContent = 'Snapshot';
  snapshotButton.addEventListener('click', () => {
    captureLiveDebugSnapshot('manual-panel');
    setStatus('Captured live debug snapshot.');
  });

  controls.append(levelLabel, levelSelect, clearButton, copyButton, snapshotButton);

  const log = document.createElement('pre');
  log.className = 'live-debug-log';

  panel.append(summary, controls, log);
  statusElement.insertAdjacentElement('afterend', panel);

  liveDebugPanelElements = {
    root: panel,
    levelSelect,
    levelBadge: badge,
    log
  };

  liveDebug.subscribe(renderLiveDebugPanel);
  renderLiveDebugPanel();
}

function createLiveDebugSessionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `live-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildLauncherEndpoint(pathname) {
  return `${pathname}?token=${encodeURIComponent(launcherToken)}`;
}

const liveDebugUploadState = {
  enabled: Boolean(launcherToken),
  sessionId: createLiveDebugSessionId(),
  queue: [],
  flushTimer: null,
  inflight: false
};

function scheduleLiveDebugUpload() {
  if (!liveDebugUploadState.enabled || liveDebugUploadState.flushTimer) {
    return;
  }

  liveDebugUploadState.flushTimer = window.setTimeout(() => {
    liveDebugUploadState.flushTimer = null;
    void flushLiveDebugUploads('timer');
  }, LIVE_DEBUG_UPLOAD_DEBOUNCE_MS);
}

function enqueueLiveDebugEntry(entry) {
  if (!liveDebugUploadState.enabled) {
    return;
  }

  liveDebugUploadState.queue.push({
    sessionCapturedAt: new Date().toISOString(),
    currentPath: app.currentPath,
    viewMode: app.viewMode,
    entry
  });

  if (liveDebugUploadState.queue.length > LIVE_DEBUG_UPLOAD_MAX_QUEUE) {
    liveDebugUploadState.queue.splice(0, liveDebugUploadState.queue.length - LIVE_DEBUG_UPLOAD_MAX_QUEUE);
  }

  if (liveDebugUploadState.queue.length >= LIVE_DEBUG_UPLOAD_MAX_BATCH) {
    void flushLiveDebugUploads('batch-threshold');
    return;
  }

  scheduleLiveDebugUpload();
}

function buildLiveDebugPayload(batch, reason) {
  return {
    sessionId: liveDebugUploadState.sessionId,
    reason,
    appPath: window.location.pathname,
    entries: batch
  };
}

async function flushLiveDebugUploads(reason = 'manual') {
  if (!liveDebugUploadState.enabled || liveDebugUploadState.inflight) {
    return;
  }

  if (liveDebugUploadState.flushTimer) {
    window.clearTimeout(liveDebugUploadState.flushTimer);
    liveDebugUploadState.flushTimer = null;
  }

  if (liveDebugUploadState.queue.length === 0) {
    return;
  }

  liveDebugUploadState.inflight = true;

  try {
    while (liveDebugUploadState.queue.length > 0) {
      const batch = liveDebugUploadState.queue.splice(0, LIVE_DEBUG_UPLOAD_MAX_BATCH);
      try {
        const response = await fetch(buildLauncherEndpoint('/__launcher/live-debug'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          keepalive: true,
          body: JSON.stringify(buildLiveDebugPayload(batch, reason))
        });

        if (!response.ok) {
          throw new Error(`launcher-live-debug-${response.status}`);
        }
      } catch (error) {
        liveDebugUploadState.queue.unshift(...batch);
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.warn('Live debug upload failed:', error.message);
    } else {
      console.warn('Live debug upload failed.');
    }
  } finally {
    liveDebugUploadState.inflight = false;
  }
}

function flushLiveDebugUploadsWithBeacon(reason = 'beforeunload') {
  if (!liveDebugUploadState.enabled || liveDebugUploadState.queue.length === 0 || !navigator.sendBeacon) {
    return;
  }

  if (liveDebugUploadState.flushTimer) {
    window.clearTimeout(liveDebugUploadState.flushTimer);
    liveDebugUploadState.flushTimer = null;
  }

  const batch = liveDebugUploadState.queue.splice(0, liveDebugUploadState.queue.length);
  const payload = JSON.stringify(buildLiveDebugPayload(batch, reason));
  const blob = new Blob([payload], {
    type: 'application/json'
  });

  const accepted = navigator.sendBeacon(buildLauncherEndpoint('/__launcher/live-debug'), blob);
  if (!accepted) {
    liveDebugUploadState.queue.unshift(...batch);
  }
}

liveDebug.subscribe((event) => {
  if (!event || event.type !== 'entry') {
    return;
  }

  enqueueLiveDebugEntry(event.entry);
});

if (liveDebugUploadState.enabled) {
  enqueueLiveDebugEntry({
    at: new Date().toISOString(),
    scope: 'launcher',
    level: 'info',
    event: 'live-debug.capture.enabled',
    data: {
      sessionId: liveDebugUploadState.sessionId
    }
  });
  void flushLiveDebugUploads('startup');
}

function setStatus(message, asError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', asError);
}

function updateActionButtons() {
  const hasFolder = Boolean(app.folderHandle);
  newNoteButton.disabled = !hasFolder;
  saveNowButton.disabled = !app.currentFileHandle;
}

function isMarkdownFile(name) {
  return /\.(md|markdown|mkd|mdown)$/i.test(name);
}

function joinPath(basePath, segment) {
  return basePath ? `${basePath}/${segment}` : segment;
}

async function walkDirectory(directoryHandle, currentPath = '') {
  const directories = [];
  const markdownFiles = [];

  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind === 'directory') {
      directories.push([name, handle]);
      continue;
    }

    if (handle.kind === 'file' && isMarkdownFile(name)) {
      markdownFiles.push([name, handle]);
    }
  }

  directories.sort(([a], [b]) => a.localeCompare(b));
  markdownFiles.sort(([a], [b]) => a.localeCompare(b));

  const results = new Map();

  for (const [name, handle] of directories) {
    const nested = await walkDirectory(handle, joinPath(currentPath, name));
    for (const [nestedPath, nestedHandle] of nested.entries()) {
      results.set(nestedPath, nestedHandle);
    }
  }

  for (const [name, handle] of markdownFiles) {
    results.set(joinPath(currentPath, name), handle);
  }

  return results;
}

function renderFileList() {
  fileListElement.innerHTML = '';

  const paths = [...app.fileHandles.keys()];
  fileCountElement.textContent = String(paths.length);

  if (paths.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No markdown files yet.';
    empty.className = 'hint';
    fileListElement.append(empty);
    return;
  }

  for (const path of paths) {
    const item = document.createElement('li');
    const button = document.createElement('button');

    button.type = 'button';
    button.className = 'file-button';
    button.textContent = path;
    button.title = path;
    button.classList.toggle('active', path === app.currentPath);
    button.addEventListener('click', () => {
      void openFile(path);
    });

    item.append(button);
    fileListElement.append(item);
  }
}

function renderMarkdownHtml(markdownText, options = null) {
  const sourceFrom = Number(options?.sourceFrom);
  const sourceTo = Number(options?.sourceTo);
  const shouldAnnotateSourceRanges = Number.isFinite(sourceFrom) && Number.isFinite(sourceTo);

  let rendered = '';
  if (shouldAnnotateSourceRanges) {
    const tokens = markdownEngine.parse(markdownText, {});
    annotateMarkdownTokensWithSourceRanges(tokens, markdownText, sourceFrom, sourceTo);
    rendered = markdownEngine.renderer.render(tokens, markdownEngine.options, {});
  } else {
    rendered = markdownEngine.render(markdownText);
  }

  return DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true }
  });
}

function renderPreview(markdownText) {
  previewElement.innerHTML = renderMarkdownHtml(markdownText);
}

function requestLivePreviewRefresh(reason = 'manual') {
  liveDebug.trace('refresh.requested', {
    mode: app.viewMode,
    reason
  });
  editorView.dispatch({
    effects: refreshLivePreviewEffect.of(reason)
  });
}

function collectTopLevelBlocksSafe(doc) {
  const startedAt = performance.now();
  try {
    const blocks = collectTopLevelBlocks(doc, (source) => markdownEngine.parse(source, {}));
    liveDebug.trace('blocks.collected', {
      blockCount: blocks.length,
      docLength: doc.length,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2))
    });
    return blocks;
  } catch (error) {
    liveDebug.error('blocks.collect.failed', {
      message: error instanceof Error ? error.message : String(error)
    });
    console.warn('Live preview block parser failed. Falling back to raw lines.', error);
    return [];
  }
}

class RenderedMarkdownBlockWidget extends WidgetType {
  constructor(
    html,
    sourceFrom,
    sourceTo = sourceFrom,
    fragmentFrom = sourceFrom,
    fragmentTo = sourceTo
  ) {
    super();
    this.html = html;
    this.sourceFrom = sourceFrom;
    this.sourceTo = sourceTo;
    this.fragmentFrom = fragmentFrom;
    this.fragmentTo = fragmentTo;
  }

  eq(other) {
    return (
      other.html === this.html &&
      other.sourceFrom === this.sourceFrom &&
      other.sourceTo === this.sourceTo &&
      other.fragmentFrom === this.fragmentFrom &&
      other.fragmentTo === this.fragmentTo
    );
  }

  toDOM() {
    const element = document.createElement('div');
    element.className = 'cm-rendered-block';
    element.dataset.sourceFrom = String(this.sourceFrom);
    element.dataset.sourceTo = String(this.sourceTo);
    element.dataset.fragmentFrom = String(this.fragmentFrom);
    element.dataset.fragmentTo = String(this.fragmentTo);
    element.innerHTML = this.html;
    return element;
  }

  ignoreEvent() {
    return false;
  }
}

function buildLivePreviewDecorations(state, blocks, fragmentHtmlCache = null) {
  if (app.viewMode !== 'live') {
    return Decoration.none;
  }

  if (blocks.length === 0) {
    return Decoration.none;
  }

  const startedAt = performance.now();
  const doc = state.doc;
  const activeLine = doc.lineAt(state.selection.main.head);
  const activeLineLength = Math.max(0, activeLine.to - activeLine.from);
  const activeLineIsEmpty = activeLineLength === 0;
  const ranges = [];
  let skippedEmptyActiveLineBlocks = 0;
  let skippedEmptyBoundaryBlocks = 0;
  let skippedActiveFencedCodeBlocks = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  const renderFragmentMarkdown = (source, from, to) => {
    if (!(fragmentHtmlCache instanceof Map)) {
      return renderMarkdownHtml(source, {
        sourceFrom: from,
        sourceTo: to
      });
    }

    const cacheKey = `${from}:${to}`;
    if (fragmentHtmlCache.has(cacheKey)) {
      cacheHits += 1;
      return fragmentHtmlCache.get(cacheKey);
    }

    cacheMisses += 1;
    const html = renderMarkdownHtml(source, {
      sourceFrom: from,
      sourceTo: to
    });
    fragmentHtmlCache.set(cacheKey, html);
    if (fragmentHtmlCache.size > LIVE_PREVIEW_FRAGMENT_CACHE_MAX) {
      fragmentHtmlCache.clear();
      fragmentHtmlCache.set(cacheKey, html);
      liveDebug.trace('decorations.cache.reset', {
        reason: 'size-limit',
        maxEntries: LIVE_PREVIEW_FRAGMENT_CACHE_MAX
      });
    }
    return html;
  };

  for (const block of blocks) {
    const activeLineInsideBlock = blockContainsLine(block, activeLine);
    const blockIsFencedCode = isFencedCodeBlock(doc, block);
    if (activeLineInsideBlock && blockIsFencedCode) {
      const blockStartLine = doc.lineAt(block.from);
      const blockEndLine = doc.lineAt(Math.max(block.from, block.to - 1));
      const activeLineText = doc.sliceString(activeLine.from, activeLine.to);
      const activeLineStartsFence = /^\s*([`~]{3,})/.test(activeLineText);
      const activeLineIsBlockStart = activeLine.from === blockStartLine.from;
      const activeLineIsBlockEnd = activeLine.to === blockEndLine.to;
      skippedActiveFencedCodeBlocks += 1;
      liveDebug.trace('decorations.block.skipped-active-fenced-code', {
        activeLineNumber: activeLine.number,
        activeLineFrom: activeLine.from,
        activeLineTo: activeLine.to,
        activeLineLength,
        activeLineTextPreview: normalizeLogString(activeLineText, 100),
        activeLineStartsFence,
        activeLineIsBlockStart,
        activeLineIsBlockEnd,
        blockStartLineNumber: blockStartLine.number,
        blockEndLineNumber: blockEndLine.number,
        activeLineIndexInBlock: Math.max(0, activeLine.number - blockStartLine.number),
        blockFrom: block.from,
        blockTo: block.to
      });
      continue;
    }

    if (activeLineIsEmpty && activeLineInsideBlock) {
      skippedEmptyActiveLineBlocks += 1;
      liveDebug.trace('decorations.block.skipped-empty-active-line', {
        activeLineNumber: activeLine.number,
        activeLineFrom: activeLine.from,
        activeLineTo: activeLine.to,
        activeLineLength,
        blockFrom: block.from,
        blockTo: block.to
      });
      continue;
    }

    const skipEmptyTrailingBoundary = shouldSkipEmptyTrailingBoundaryBlock(
      activeLine,
      block,
      blockIsFencedCode
    );
    if (skipEmptyTrailingBoundary) {
      skippedEmptyBoundaryBlocks += 1;
      liveDebug.trace('decorations.block.skipped-empty-line-boundary', {
        activeLineNumber: activeLine.number,
        activeLineFrom: activeLine.from,
        activeLineTo: activeLine.to,
        activeLineLength,
        blockIsFencedCode,
        blockFrom: block.from,
        blockTo: block.to
      });
      continue;
    }

    const fragments = splitBlockAroundActiveLine(doc, block, activeLine, renderFragmentMarkdown);
    for (const fragment of fragments) {
      ranges.push(
        Decoration.replace({
          block: true,
          widget: new RenderedMarkdownBlockWidget(
            fragment.html,
            block.from,
            block.to,
            fragment.from,
            fragment.to
          )
        }).range(fragment.from, fragment.to)
      );
    }
  }

  const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
  liveDebug.trace('decorations.built', {
    activeLineNumber: activeLine.number,
    activeLineLength,
    activeLineIsEmpty,
    activeLineFrom: activeLine.from,
    activeLineTo: activeLine.to,
    blockCount: blocks.length,
    skippedEmptyActiveLineBlocks,
    skippedEmptyBoundaryBlocks,
    skippedActiveFencedCodeBlocks,
    decorationCount: ranges.length,
    cacheHits,
    cacheMisses,
    cacheSize: fragmentHtmlCache instanceof Map ? fragmentHtmlCache.size : 0,
    elapsedMs
  });

  if (elapsedMs >= LIVE_PREVIEW_SLOW_BUILD_WARN_MS) {
    liveDebug.warn('decorations.slow', {
      elapsedMs,
      blockCount: blocks.length,
      decorationCount: ranges.length
    });
  }

  return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none;
}

function distanceToBlockBounds(position, blockBounds) {
  if (!Number.isFinite(position) || !blockBounds) {
    return null;
  }

  const from = Math.min(blockBounds.from, blockBounds.to);
  const to = Math.max(blockBounds.from, blockBounds.to);
  const max = to > from ? to - 1 : from;

  if (position < from) {
    return from - position;
  }

  if (position > max) {
    return position - max;
  }

  return 0;
}

function normalizePointerTarget(target) {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

function readPointerCoordinates(event) {
  if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
    return {
      x: event.clientX,
      y: event.clientY
    };
  }

  const touchPoint = event?.touches?.[0] ?? event?.changedTouches?.[0] ?? null;
  if (!touchPoint || !Number.isFinite(touchPoint.clientX) || !Number.isFinite(touchPoint.clientY)) {
    return null;
  }

  return {
    x: touchPoint.clientX,
    y: touchPoint.clientY
  };
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

function summarizeRectForLog(rect) {
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

function readComputedStyleSnapshotForLog(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  try {
    const style = window.getComputedStyle(element);
    return {
      display: style.display,
      position: style.position,
      whiteSpace: style.whiteSpace,
      lineHeight: style.lineHeight,
      fontSize: style.fontSize,
      marginTop: style.marginTop,
      marginBottom: style.marginBottom,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      overflowY: style.overflowY
    };
  } catch {
    return null;
  }
}

function readLineInfoForPosition(doc, position) {
  if (!doc || !Number.isFinite(position)) {
    return null;
  }

  const clampedPos = Math.max(0, Math.min(doc.length, Math.trunc(position)));
  const line = doc.lineAt(clampedPos);
  return {
    position: clampedPos,
    lineNumber: line.number,
    lineFrom: line.from,
    lineTo: line.to,
    lineLength: Math.max(0, line.to - line.from),
    column: Math.max(0, clampedPos - line.from),
    lineTextPreview: normalizeLogString(doc.sliceString(line.from, line.to), 100)
  };
}

function readBlockLineBoundsForLog(doc, blockBounds) {
  if (
    !doc ||
    !blockBounds ||
    !Number.isFinite(blockBounds.from) ||
    !Number.isFinite(blockBounds.to)
  ) {
    return null;
  }

  const from = Math.min(blockBounds.from, blockBounds.to);
  const to = Math.max(blockBounds.from, blockBounds.to);
  if (to <= from) {
    return null;
  }

  const startLine = doc.lineAt(from);
  const endLine = doc.lineAt(Math.max(from, to - 1));
  return {
    startLineNumber: startLine.number,
    startLineFrom: startLine.from,
    endLineNumber: endLine.number,
    endLineTo: endLine.to,
    lineCount: Math.max(1, endLine.number - startLine.number + 1)
  };
}

function resolvePosAtCoordsSafe(view, coordinates) {
  if (!coordinates) {
    return null;
  }

  try {
    const mappedPos = view.posAtCoords(coordinates);
    return Number.isFinite(mappedPos) ? mappedPos : null;
  } catch {
    return null;
  }
}

function buildCoordSamples(view, samples) {
  const doc = view?.state?.doc;
  if (!doc || !Array.isArray(samples) || samples.length === 0) {
    return [];
  }

  const results = [];
  for (const sample of samples) {
    if (!sample || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
      continue;
    }

    const position = resolvePosAtCoordsSafe(view, sample);
    const lineInfo = readLineInfoForPosition(doc, position);
    results.push({
      label: sample.label,
      x: Number(sample.x.toFixed(2)),
      y: Number(sample.y.toFixed(2)),
      position,
      lineNumber: lineInfo?.lineNumber ?? null,
      column: lineInfo?.column ?? null
    });
  }

  return results;
}

function summarizeLineNumbersForCoordSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return [];
  }

  const lineNumbers = [];
  for (const sample of samples) {
    const lineNumber = sample?.lineNumber;
    if (!Number.isFinite(lineNumber) || lineNumbers.includes(lineNumber)) {
      continue;
    }
    lineNumbers.push(lineNumber);
  }

  return lineNumbers;
}

function buildRenderedPointerProbe(
  view,
  renderedBlock,
  targetElement,
  coordinates,
  blockBounds,
  sourcePos,
  sourceFromBlockBounds = null,
  sourcePosBlockBounds = null
) {
  if (
    !view?.state?.doc ||
    !renderedBlock?.getBoundingClientRect ||
    !coordinates ||
    !Number.isFinite(coordinates.x) ||
    !Number.isFinite(coordinates.y)
  ) {
    return null;
  }

  const doc = view.state.doc;
  const blockRect = renderedBlock.getBoundingClientRect();
  const targetRect = targetElement?.getBoundingClientRect?.() ?? null;
  const pointerOffsetY = Number.isFinite(blockRect.top)
    ? Number((coordinates.y - blockRect.top).toFixed(2))
    : null;
  const pointerOffsetX = Number.isFinite(blockRect.left)
    ? Number((coordinates.x - blockRect.left).toFixed(2))
    : null;
  const pointerRatioY =
    Number.isFinite(pointerOffsetY) && blockRect.height > 0
      ? Number((clampNumber(pointerOffsetY / blockRect.height, 0, 1) ?? 0).toFixed(4))
      : null;
  const pointerDistanceToBlockBottom =
    Number.isFinite(blockRect.bottom) ? Number((blockRect.bottom - coordinates.y).toFixed(2)) : null;

  const blockLineBounds = readBlockLineBoundsForLog(doc, blockBounds);
  const sourceFromBlockLineBounds = readBlockLineBoundsForLog(doc, sourceFromBlockBounds);
  const sourcePosBlockLineBounds = readBlockLineBoundsForLog(doc, sourcePosBlockBounds);
  const leftX = Number.isFinite(blockRect.left) ? blockRect.left + 4 : Number.NaN;
  const centerX = Number.isFinite(blockRect.left) && Number.isFinite(blockRect.width)
    ? blockRect.left + blockRect.width / 2
    : Number.NaN;
  const rightX =
    Number.isFinite(blockRect.right) && Number.isFinite(blockRect.left)
      ? Math.max(blockRect.left + 4, blockRect.right - 4)
      : Number.NaN;
  const sampleY = coordinates.y;
  const coordSamples = buildCoordSamples(view, [
    { label: 'click', x: coordinates.x, y: sampleY },
    { label: 'block-left', x: leftX, y: sampleY },
    { label: 'block-center', x: centerX, y: sampleY },
    { label: 'block-right', x: rightX, y: sampleY }
  ]);
  const verticalScanCoordSamples = buildCoordSamples(
    view,
    [-18, -12, -8, -4, 0, 4, 8, 12, 18].map((offset) => ({
      label: `pointer-y${offset >= 0 ? `+${offset}` : offset}`,
      x: coordinates.x,
      y: coordinates.y + offset
    }))
  );
  const edgeCoordSamples = buildCoordSamples(view, [
    { label: 'edge-top-outer', x: coordinates.x, y: blockRect.top - 1 },
    { label: 'edge-top-inner', x: coordinates.x, y: blockRect.top + 1 },
    { label: 'edge-bottom-inner', x: coordinates.x, y: blockRect.bottom - 1 },
    { label: 'edge-bottom-outer', x: coordinates.x, y: blockRect.bottom + 1 }
  ]);

  const sourceLineInfo = readLineInfoForPosition(doc, sourcePos);
  const domBlockPos = resolvePointerPosition(view, renderedBlock, null);
  const domTargetPos = resolvePointerPosition(view, targetElement, null);

  return {
    pointer: {
      x: Number(coordinates.x.toFixed(2)),
      y: Number(coordinates.y.toFixed(2)),
      pointerOffsetX,
      pointerOffsetY,
      pointerRatioY,
      pointerDistanceToBlockBottom
    },
    renderedBlockRect: summarizeRectForLog(blockRect),
    renderedBlockStyle: readComputedStyleSnapshotForLog(renderedBlock),
    targetRect: summarizeRectForLog(targetRect),
    targetStyle: readComputedStyleSnapshotForLog(targetElement),
    targetTagName: targetElement?.tagName ?? null,
    targetClassName:
      typeof targetElement?.className === 'string'
        ? normalizeLogString(targetElement.className, 120)
        : null,
    blockLineBounds,
    sourceFromBlockLineBounds,
    sourcePosBlockLineBounds,
    sourceLineInfo,
    domBlockPos,
    domTargetPos,
    coordSamples,
    verticalScanCoordSamples,
    edgeCoordSamples
  };
}

function buildLineFallbackPointerProbe(
  view,
  lineElement,
  targetElement,
  coordinates,
  blockBounds,
  sourcePos
) {
  if (!view?.state?.doc || !lineElement?.getBoundingClientRect) {
    return null;
  }

  const doc = view.state.doc;
  const lineRect = lineElement.getBoundingClientRect();
  const targetRect = targetElement?.getBoundingClientRect?.() ?? null;
  const pointerOffsetY =
    coordinates && Number.isFinite(lineRect.top) && Number.isFinite(coordinates.y)
      ? Number((coordinates.y - lineRect.top).toFixed(2))
      : null;
  const pointerOffsetX =
    coordinates && Number.isFinite(lineRect.left) && Number.isFinite(coordinates.x)
      ? Number((coordinates.x - lineRect.left).toFixed(2))
      : null;
  const blockLineBounds = readBlockLineBoundsForLog(doc, blockBounds);

  const sampleY = coordinates?.y ?? lineRect.top + Math.max(1, lineRect.height / 2);
  const coordSamples = buildCoordSamples(view, [
    {
      label: 'line-left',
      x: lineRect.left + 4,
      y: sampleY
    },
    {
      label: 'line-center',
      x: lineRect.left + lineRect.width / 2,
      y: sampleY
    },
    {
      label: 'line-right',
      x: Math.max(lineRect.left + 4, lineRect.right - 4),
      y: sampleY
    }
  ]);

  return {
    pointer: coordinates
      ? {
          x: Number(coordinates.x.toFixed(2)),
          y: Number(coordinates.y.toFixed(2)),
          pointerOffsetX,
          pointerOffsetY
        }
      : null,
    lineRect: summarizeRectForLog(lineRect),
    targetRect: summarizeRectForLog(targetRect),
    lineTagName: lineElement?.tagName ?? null,
    targetTagName: targetElement?.tagName ?? null,
    lineTextPreview: normalizeLogString(lineElement?.textContent ?? '', 100),
    sourceLineInfo: readLineInfoForPosition(doc, sourcePos),
    blockLineBounds,
    coordSamples
  };
}

function parseSourceRangeValue(rawValue) {
  if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.trunc(parsed);
}

function readSourceRangeFromElement(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  const from = parseSourceRangeValue(element.getAttribute('data-src-from'));
  const to = parseSourceRangeValue(element.getAttribute('data-src-to'));
  if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
    return {
      from,
      to,
      source: 'token-attrs'
    };
  }

  const fragmentFrom = parseSourceRangeValue(element.getAttribute('data-fragment-from'));
  const fragmentTo = parseSourceRangeValue(element.getAttribute('data-fragment-to'));
  if (Number.isFinite(fragmentFrom) && Number.isFinite(fragmentTo) && fragmentTo > fragmentFrom) {
    return {
      from: fragmentFrom,
      to: fragmentTo,
      source: 'fragment-attrs'
    };
  }

  const sourceFrom = parseSourceRangeValue(element.getAttribute('data-source-from'));
  const sourceTo = parseSourceRangeValue(element.getAttribute('data-source-to'));
  if (Number.isFinite(sourceFrom) && Number.isFinite(sourceTo) && sourceTo > sourceFrom) {
    return {
      from: sourceFrom,
      to: sourceTo,
      source: 'block-attrs'
    };
  }

  return null;
}

function findFirstChildSourceRangeElement(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  const directChildren = Array.from(element.children ?? []);
  for (const child of directChildren) {
    const range = readSourceRangeFromElement(child);
    if (range) {
      return {
        element: child,
        range
      };
    }
  }

  for (const child of directChildren) {
    const nested = child.querySelector('[data-src-from][data-src-to]');
    if (!(nested instanceof Element)) {
      continue;
    }

    const range = readSourceRangeFromElement(nested);
    if (range) {
      return {
        element: nested,
        range
      };
    }
  }

  return null;
}

function findRenderedSourceRangeTarget(targetElement, renderedBlock) {
  if (!(targetElement instanceof Element) || !(renderedBlock instanceof Element)) {
    return null;
  }

  let current = targetElement;
  while (current) {
    const range = readSourceRangeFromElement(current);
    if (range) {
      return {
        element: current,
        range
      };
    }

    if (current === renderedBlock) {
      break;
    }

    current = current.parentElement;
  }

  const childRangeTarget = findFirstChildSourceRangeElement(targetElement);
  if (childRangeTarget) {
    return childRangeTarget;
  }

  const renderedBlockRange = readSourceRangeFromElement(renderedBlock);
  if (renderedBlockRange) {
    return {
      element: renderedBlock,
      range: renderedBlockRange
    };
  }

  return null;
}

function clampToRange(position, from, to) {
  if (!Number.isFinite(position) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return null;
  }

  if (position < from) {
    return from;
  }

  if (position >= to) {
    return Math.max(from, to - 1);
  }

  return Math.trunc(position);
}

function resolvePositionFromRenderedSourceRange(
  doc,
  sourceRange,
  sourceRangeElement,
  coordinates,
  fallbackPosition = null
) {
  if (
    !doc ||
    !sourceRange ||
    !Number.isFinite(sourceRange.from) ||
    !Number.isFinite(sourceRange.to) ||
    sourceRange.to <= sourceRange.from
  ) {
    return null;
  }

  const clampedFallback = clampToRange(fallbackPosition, sourceRange.from, sourceRange.to);
  const startLine = doc.lineAt(sourceRange.from);
  const endLine = doc.lineAt(Math.max(sourceRange.from, sourceRange.to - 1));
  const lineCount = Math.max(1, endLine.number - startLine.number + 1);
  const hasCoords = coordinates && Number.isFinite(coordinates.y);
  const hasRect = sourceRangeElement?.getBoundingClientRect instanceof Function;
  const rect = hasRect ? sourceRangeElement.getBoundingClientRect() : null;
  const canMapByY = Boolean(
    hasCoords &&
    rect &&
    Number.isFinite(rect.height) &&
    rect.height > 0 &&
    lineCount > 1
  );

  if (canMapByY) {
    const ratioY = clampNumber((coordinates.y - rect.top) / rect.height, 0, 0.9999) ?? 0;
    const relativeLineIndex = Math.min(lineCount - 1, Math.max(0, Math.floor(ratioY * lineCount)));
    const targetLineNumber = Math.min(endLine.number, startLine.number + relativeLineIndex);
    const targetLine = doc.line(targetLineNumber);
    const lineFrom = Math.max(sourceRange.from, targetLine.from);
    const lineToExclusive = Math.min(sourceRange.to, targetLine.to + 1);
    const lineTo = Math.max(lineFrom, lineToExclusive - 1);

    if (Number.isFinite(clampedFallback) && clampedFallback >= lineFrom && clampedFallback <= lineTo) {
      return clampedFallback;
    }

    return lineFrom;
  }

  if (Number.isFinite(clampedFallback)) {
    return clampedFallback;
  }

  return sourceRange.from;
}

function resolvePointerPosition(view, targetElement, coordinates = null) {
  if (coordinates) {
    const mappedPos = view.posAtCoords(coordinates);
    if (Number.isFinite(mappedPos)) {
      return mappedPos;
    }
  }

  try {
    const domPos = view.posAtDOM(targetElement, 0);
    if (Number.isFinite(domPos)) {
      return domPos;
    }
  } catch (error) {
    liveDebug.trace('block.activate.dom-pos-failed', {
      message: error instanceof Error ? error.message : String(error)
    });
  }

  return null;
}

const livePreviewStateField = StateField.define({
  create(state) {
    const blocks = collectTopLevelBlocksSafe(state.doc);
    const fragmentHtmlCache = new Map();
    const decorations = buildLivePreviewDecorations(state, blocks, fragmentHtmlCache);
    const lastSelectionLineFrom = state.doc.lineAt(state.selection.main.head).from;
    return {
      blocks,
      decorations,
      fragmentHtmlCache,
      lastSelectionLineFrom
    };
  },
  update(value, transaction) {
    let blocks = value.blocks;
    let fragmentHtmlCache = value.fragmentHtmlCache;

    if (transaction.docChanged) {
      blocks = collectTopLevelBlocksSafe(transaction.state.doc);
      fragmentHtmlCache = new Map();
    }

    const refreshReasons = transaction.effects
      .filter((effect) => effect.is(refreshLivePreviewEffect))
      .map((effect) => effect.value ?? 'manual');
    const refreshRequested = refreshReasons.length > 0;

    const previousSelection = transaction.startState.selection.main;
    const currentSelection = transaction.state.selection.main;
    const selectionSet =
      previousSelection.anchor !== currentSelection.anchor ||
      previousSelection.head !== currentSelection.head;

    const currentSelectionLineFrom = transaction.state.doc.lineAt(currentSelection.head).from;
    const selectionLineChanged =
      selectionSet && currentSelectionLineFrom !== value.lastSelectionLineFrom;
    const shouldRebuildDecorations =
      transaction.docChanged || refreshRequested || selectionLineChanged;

    if (shouldRebuildDecorations) {
      liveDebug.trace('plugin.update', {
        docChanged: transaction.docChanged,
        viewportChanged: false,
        selectionSet,
        selectionLineChanged,
        previousSelectionLineFrom: value.lastSelectionLineFrom,
        currentSelectionLineFrom,
        refreshRequested,
        refreshReasons
      });

      return {
        blocks,
        decorations: buildLivePreviewDecorations(
          transaction.state,
          blocks,
          fragmentHtmlCache
        ),
        fragmentHtmlCache,
        lastSelectionLineFrom: currentSelectionLineFrom
      };
    }

    if (selectionSet) {
      liveDebug.trace('plugin.update.selection-skipped', {
        previousSelectionLineFrom: value.lastSelectionLineFrom,
        currentSelectionLineFrom
      });
    }

    return value;
  }
});

function readLivePreviewState(state) {
  try {
    return state.field(livePreviewStateField);
  } catch {
    return null;
  }
}

function liveBlocksForView(view) {
  const livePreviewState = readLivePreviewState(view.state);
  return Array.isArray(livePreviewState?.blocks) ? livePreviewState.blocks : [];
}

function resolveLiveActivationContext(view, targetElement, coordinates, trigger) {
  const blocks = liveBlocksForView(view);
  const renderedBlock = targetElement.closest('.cm-rendered-block');
  if (renderedBlock) {
    const sourceFrom = parseSourceFromAttribute(renderedBlock.getAttribute('data-source-from'));
    if (sourceFrom === null) {
      liveDebug.warn('block.activate.skipped', {
        trigger,
        reason: 'invalid-source-from'
      });
      return null;
    }

    const sourceRangeTarget = findRenderedSourceRangeTarget(targetElement, renderedBlock);
    const sourcePosByCoordinates = resolvePointerPosition(view, renderedBlock, coordinates);
    const sourcePosBySourceRange = resolvePositionFromRenderedSourceRange(
      view.state.doc,
      sourceRangeTarget?.range ?? null,
      sourceRangeTarget?.element ?? null,
      coordinates,
      sourcePosByCoordinates
    );
    const sourcePosByDomTarget = resolvePointerPosition(view, targetElement, null);
    const sourcePosByDomBlock = resolvePointerPosition(view, renderedBlock, null);
    const blockBoundsBySourceFrom = resolveActivationBlockBounds(
      blocks,
      sourceFrom,
      Number.isFinite(sourcePosBySourceRange) ? sourcePosBySourceRange : sourcePosByCoordinates
    );
    const sourcePosByCoordinatesDistanceToSourceFromBlock =
      Number.isFinite(sourcePosByCoordinates) && blockBoundsBySourceFrom
        ? distanceToBlockBounds(sourcePosByCoordinates, blockBoundsBySourceFrom)
        : null;
    const sourcePosBySourceRangeDistanceToSourceFromBlock =
      Number.isFinite(sourcePosBySourceRange) && blockBoundsBySourceFrom
        ? distanceToBlockBounds(sourcePosBySourceRange, blockBoundsBySourceFrom)
        : null;
    const sourcePosByDomTargetDistanceToSourceFromBlock =
      Number.isFinite(sourcePosByDomTarget) && blockBoundsBySourceFrom
        ? distanceToBlockBounds(sourcePosByDomTarget, blockBoundsBySourceFrom)
        : null;
    const sourcePosByDomBlockDistanceToSourceFromBlock =
      Number.isFinite(sourcePosByDomBlock) && blockBoundsBySourceFrom
        ? distanceToBlockBounds(sourcePosByDomBlock, blockBoundsBySourceFrom)
        : null;
    const allowHeuristicSticky = !Number.isFinite(sourcePosBySourceRange);
    const preferDomAnchorForRenderedClick = allowHeuristicSticky && shouldPreferRenderedDomAnchorPosition({
      sourcePosDistanceToSourceFromBlock: sourcePosByCoordinatesDistanceToSourceFromBlock,
      domTargetDistanceToSourceFromBlock: sourcePosByDomTargetDistanceToSourceFromBlock,
      domBlockDistanceToSourceFromBlock: sourcePosByDomBlockDistanceToSourceFromBlock,
      maxSourcePosDistance: LIVE_PREVIEW_RENDERED_DOM_ANCHOR_STICKY_MAX_POS_DELTA
    });
    const sourcePosByStickyClamp =
      preferDomAnchorForRenderedClick &&
      Number.isFinite(sourcePosByCoordinates) &&
      blockBoundsBySourceFrom
        ? resolveLiveBlockSelection(
            view.state.doc.length,
            sourceFrom,
            sourcePosByCoordinates,
            blockBoundsBySourceFrom
          )
        : null;
    let sourcePos = sourcePosByCoordinates;
    let sourcePosOrigin = 'coordinates';
    if (Number.isFinite(sourcePosBySourceRange)) {
      sourcePos = sourcePosBySourceRange;
      sourcePosOrigin = 'source-range';
    } else if (preferDomAnchorForRenderedClick) {
      if (Number.isFinite(sourcePosByStickyClamp)) {
        sourcePos = sourcePosByStickyClamp;
        sourcePosOrigin = 'dom-sticky-clamped';
      } else if (sourcePosByDomTargetDistanceToSourceFromBlock === 0) {
        sourcePos = sourcePosByDomTarget;
        sourcePosOrigin = 'dom-target-sticky';
      } else if (sourcePosByDomBlockDistanceToSourceFromBlock === 0) {
        sourcePos = sourcePosByDomBlock;
        sourcePosOrigin = 'dom-block-sticky';
      }
    }

    if (!Number.isFinite(sourcePos)) {
      if (Number.isFinite(sourcePosByDomTarget)) {
        sourcePos = sourcePosByDomTarget;
        sourcePosOrigin = 'dom-target-fallback';
      } else if (Number.isFinite(sourcePosByDomBlock)) {
        sourcePos = sourcePosByDomBlock;
        sourcePosOrigin = 'dom-block-fallback';
      }
    }

    const blockBoundsBySourcePos = Number.isFinite(sourcePos)
      ? (
          findBlockContainingPosition(blocks, sourcePos) ??
          findNearestBlockForPosition(blocks, sourcePos, 1)
        )
      : null;
    const sourcePosDistanceToSourceFromBlock =
      Number.isFinite(sourcePos) && blockBoundsBySourceFrom
        ? distanceToBlockBounds(sourcePos, blockBoundsBySourceFrom)
        : null;
    const sourcePosOutsideSourceFromBlock =
      Number.isFinite(sourcePos) &&
      blockBoundsBySourceFrom &&
      sourcePosDistanceToSourceFromBlock !== 0;
    const sourceFromBlockLineBounds = readBlockLineBoundsForLog(view.state.doc, blockBoundsBySourceFrom);
    const sourcePosBlockLineBounds = readBlockLineBoundsForLog(view.state.doc, blockBoundsBySourcePos);
    const sourcePosLineInfo = readLineInfoForPosition(view.state.doc, sourcePos);
    const sourcePosLineDeltaAfterSourceFromBlock =
      Number.isFinite(sourcePosLineInfo?.lineNumber) &&
      Number.isFinite(sourceFromBlockLineBounds?.endLineNumber)
        ? sourcePosLineInfo.lineNumber - sourceFromBlockLineBounds.endLineNumber
        : null;
    const sourceFromBlockIsFencedCode =
      blockBoundsBySourceFrom && isFencedCodeBlock(view.state.doc, blockBoundsBySourceFrom);
    const preferSourceFromForRenderedFencedClick = allowHeuristicSticky && shouldPreferSourceFromForRenderedFencedClick({
      targetTagName: targetElement?.tagName ?? null,
      sourceFromBlockIsFencedCode,
      sourcePosDistanceToSourceFromBlock,
      sourcePosLineDeltaAfterSourceFromBlock,
      maxDistance: LIVE_PREVIEW_RENDERED_FENCED_STICKY_MAX_POS_DELTA,
      maxLineDelta: LIVE_PREVIEW_RENDERED_FENCED_STICKY_MAX_LINE_DELTA
    });
    const shouldReboundToSourcePosBlockCandidate =
      sourcePosOutsideSourceFromBlock &&
      blockBoundsBySourcePos &&
      blockBoundsBySourcePos !== blockBoundsBySourceFrom;
    const provisionalBlockBounds = shouldReboundToSourcePosBlockCandidate
      ? blockBoundsBySourcePos
      : blockBoundsBySourceFrom;
    const pointerProbeForDecision = buildRenderedPointerProbe(
      view,
      renderedBlock,
      targetElement,
      coordinates,
      provisionalBlockBounds,
      sourcePos,
      blockBoundsBySourceFrom,
      blockBoundsBySourcePos
    );
    const preferSourceFromForRenderedBoundaryClick = allowHeuristicSticky && shouldPreferSourceFromForRenderedBoundaryClick({
      targetTagName: targetElement?.tagName ?? null,
      sourceFromBlockIsFencedCode,
      sourcePosDistanceToSourceFromBlock,
      sourcePosLineDeltaAfterSourceFromBlock,
      pointerDistanceToBlockBottom: pointerProbeForDecision?.pointer?.pointerDistanceToBlockBottom ?? null,
      pointerRatioY: pointerProbeForDecision?.pointer?.pointerRatioY ?? null,
      maxSourcePosDistance: LIVE_PREVIEW_RENDERED_BOUNDARY_STICKY_MAX_POS_DELTA,
      maxLineDelta: LIVE_PREVIEW_RENDERED_BOUNDARY_STICKY_MAX_LINE_DELTA,
      maxDistanceFromBottomPx: LIVE_PREVIEW_RENDERED_BOUNDARY_STICKY_MAX_DISTANCE_FROM_BOTTOM_PX,
      minPointerRatioY: LIVE_PREVIEW_RENDERED_BOUNDARY_STICKY_MIN_RATIO_Y
    });
    const shouldReboundToSourcePosBlock =
      allowHeuristicSticky &&
      shouldReboundToSourcePosBlockCandidate &&
      !preferSourceFromForRenderedFencedClick &&
      !preferSourceFromForRenderedBoundaryClick;
    const blockBounds = shouldReboundToSourcePosBlock
      ? blockBoundsBySourcePos
      : blockBoundsBySourceFrom;
    const sourcePosDistanceToFinalBlock =
      Number.isFinite(sourcePos) ? distanceToBlockBounds(sourcePos, blockBounds) : null;
    const pointerProbe =
      provisionalBlockBounds === blockBounds
        ? pointerProbeForDecision
        : buildRenderedPointerProbe(
            view,
            renderedBlock,
            targetElement,
            coordinates,
            blockBounds,
            sourcePos,
            blockBoundsBySourceFrom,
            blockBoundsBySourcePos
          );
    const boundaryCrossingLineNumbers = summarizeLineNumbersForCoordSamples(
      pointerProbe?.verticalScanCoordSamples
    );
    const boundaryEdgeLineNumbers = summarizeLineNumbersForCoordSamples(
      pointerProbe?.edgeCoordSamples
    );
    const renderedBoundaryCrossingLikely =
      sourcePosOutsideSourceFromBlock &&
      blockBoundsBySourceFrom &&
      blockBoundsBySourcePos &&
      blockBoundsBySourcePos !== blockBoundsBySourceFrom &&
      Number.isFinite(sourcePosLineDeltaAfterSourceFromBlock) &&
      Math.abs(sourcePosLineDeltaAfterSourceFromBlock) >= 2;
    const sourcePosInBounds =
      Number.isFinite(sourcePos) && distanceToBlockBounds(sourcePos, blockBounds) === 0;
    const sourcePosNearFinalBlock =
      Number.isFinite(sourcePosDistanceToFinalBlock) && sourcePosDistanceToFinalBlock <= 1;
    const stickySelection = (preferSourceFromForRenderedFencedClick || preferSourceFromForRenderedBoundaryClick)
      ? resolveLiveBlockSelection(
          view.state.doc.length,
          sourceFrom,
          sourcePos,
          blockBoundsBySourceFrom
        )
      : null;
    const preferredSelection = Number.isFinite(stickySelection)
      ? stickySelection
      : Number.isFinite(sourcePos) && (sourcePosInBounds || sourcePosNearFinalBlock)
        ? sourcePos
        : null;
    const allowCoordinateRemap = !Number.isFinite(preferredSelection);
    if (!blockBounds) {
      liveDebug.trace('block.activate.rendered-block-unbounded', {
        trigger,
        sourceFrom,
        sourcePos: Number.isFinite(sourcePos) ? sourcePos : null
      });
    } else if (blockBoundsBySourceFrom && blockBoundsBySourceFrom.from !== sourceFrom) {
      liveDebug.trace('block.activate.rebound', {
        trigger,
        sourceFrom,
        reboundFrom: blockBoundsBySourceFrom.from,
        reboundTo: blockBoundsBySourceFrom.to,
        sourcePos: Number.isFinite(sourcePos) ? sourcePos : null
      });
    }

    if (shouldReboundToSourcePosBlock) {
      liveDebug.trace('block.activate.rendered-rebound-source-pos-block', {
        trigger,
        sourceFrom,
        sourcePos,
        sourcePosOrigin,
        reboundFrom: blockBoundsBySourcePos?.from ?? null,
        reboundTo: blockBoundsBySourcePos?.to ?? null,
        sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
        sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null
      });
    }

    if (preferDomAnchorForRenderedClick) {
      liveDebug.trace('block.activate.rendered-dom-anchor-sticky', {
        trigger,
        sourceFrom,
        sourcePos,
        sourcePosOrigin,
        sourcePosByCoordinates,
        sourcePosByDomTarget,
        sourcePosByDomBlock,
        sourcePosByStickyClamp,
        sourcePosByCoordinatesDistanceToSourceFromBlock,
        sourcePosByDomTargetDistanceToSourceFromBlock,
        sourcePosByDomBlockDistanceToSourceFromBlock,
        sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
        sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null
      });
    }

    if (Number.isFinite(sourcePosBySourceRange)) {
      liveDebug.trace('block.activate.rendered-source-range', {
        trigger,
        sourceFrom,
        sourcePos,
        sourcePosOrigin,
        sourcePosBySourceRange,
        sourcePosByCoordinates,
        sourceRangeFrom: sourceRangeTarget?.range?.from ?? null,
        sourceRangeTo: sourceRangeTarget?.range?.to ?? null,
        sourceRangeSource: sourceRangeTarget?.range?.source ?? null,
        sourceRangeTagName: sourceRangeTarget?.element?.tagName ?? null,
        sourceRangeClassName:
          typeof sourceRangeTarget?.element?.className === 'string'
            ? normalizeLogString(sourceRangeTarget.element.className, 120)
            : null
      });
    }

    if (preferSourceFromForRenderedFencedClick) {
      liveDebug.trace('block.activate.rendered-fenced-source-sticky', {
        trigger,
        sourceFrom,
        sourcePos,
        targetTagName: targetElement?.tagName ?? null,
        sourcePosDistanceToSourceFromBlock,
        sourcePosLineDeltaAfterSourceFromBlock,
        stickySelection,
        sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
        sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null
      });
    }

    if (preferSourceFromForRenderedBoundaryClick) {
      liveDebug.trace('block.activate.rendered-boundary-source-sticky', {
        trigger,
        sourceFrom,
        sourcePos,
        targetTagName: targetElement?.tagName ?? null,
        sourcePosDistanceToSourceFromBlock,
        sourcePosLineDeltaAfterSourceFromBlock,
        pointerDistanceToBlockBottom: pointerProbe?.pointer?.pointerDistanceToBlockBottom ?? null,
        pointerRatioY: pointerProbe?.pointer?.pointerRatioY ?? null,
        stickySelection,
        sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
        sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null
      });
    }

    if (renderedBoundaryCrossingLikely) {
      liveDebug.warn('block.activate.rendered-boundary-crossing', {
        trigger,
        sourceFrom,
        sourcePos,
        targetTagName: targetElement?.tagName ?? null,
        sourcePosDistanceToSourceFromBlock,
        sourcePosLineDeltaAfterSourceFromBlock,
        sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
        sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null,
        sourcePosBlockFrom: blockBoundsBySourcePos?.from ?? null,
        sourcePosBlockTo: blockBoundsBySourcePos?.to ?? null,
        finalBlockFrom: blockBounds?.from ?? null,
        finalBlockTo: blockBounds?.to ?? null,
        sourceFromBlockLineBounds,
        sourcePosBlockLineBounds,
        boundaryCrossingLineNumbers,
        boundaryEdgeLineNumbers,
        pointerOffsetY: pointerProbe?.pointer?.pointerOffsetY ?? null,
        pointerRatioY: pointerProbe?.pointer?.pointerRatioY ?? null,
        pointerDistanceToBlockBottom: pointerProbe?.pointer?.pointerDistanceToBlockBottom ?? null
      });
    }

    if (
      blockBounds &&
      Number.isFinite(sourcePos) &&
      !sourcePosInBounds
    ) {
      liveDebug.trace('block.activate.rendered-source-pos-outside-block', {
        trigger,
        sourceFrom,
        sourcePos,
        sourcePosOrigin,
        sourcePosByCoordinates,
        sourcePosBySourceRange,
        sourcePosByDomTarget,
        sourcePosByDomBlock,
        sourcePosByStickyClamp,
        sourcePosByCoordinatesDistanceToSourceFromBlock,
        sourcePosBySourceRangeDistanceToSourceFromBlock,
        sourcePosByDomTargetDistanceToSourceFromBlock,
        sourcePosByDomBlockDistanceToSourceFromBlock,
        sourceRangeFrom: sourceRangeTarget?.range?.from ?? null,
        sourceRangeTo: sourceRangeTarget?.range?.to ?? null,
        sourceRangeSource: sourceRangeTarget?.range?.source ?? null,
        allowHeuristicSticky,
        preferDomAnchorForRenderedClick,
        preferSourceFromForRenderedFencedClick,
        preferSourceFromForRenderedBoundaryClick,
        targetTagName: targetElement?.tagName ?? null,
        sourceFromBlockLineBounds,
        sourcePosBlockLineBounds,
        sourcePosDistanceToSourceFromBlock,
        sourcePosLineDeltaAfterSourceFromBlock,
        boundaryCrossingLineNumbers,
        boundaryEdgeLineNumbers,
        blockFrom: blockBounds.from,
        blockTo: blockBounds.to
      });
    }

    liveDebug.trace('block.activate.rendered-pointer-probe', {
      trigger,
      sourceFrom,
      sourcePos: Number.isFinite(sourcePos) ? sourcePos : null,
      blockFrom: blockBounds?.from ?? null,
      blockTo: blockBounds?.to ?? null,
      sourcePosInBounds,
      sourcePosDistanceToFinalBlock,
      sourcePosNearFinalBlock,
      sourcePosOrigin,
      sourcePosByCoordinates,
      sourcePosBySourceRange,
      sourcePosByDomTarget,
      sourcePosByDomBlock,
      sourcePosByStickyClamp,
      sourcePosByCoordinatesDistanceToSourceFromBlock,
      sourcePosBySourceRangeDistanceToSourceFromBlock,
      sourcePosByDomTargetDistanceToSourceFromBlock,
      sourcePosByDomBlockDistanceToSourceFromBlock,
      sourceRangeFrom: sourceRangeTarget?.range?.from ?? null,
      sourceRangeTo: sourceRangeTarget?.range?.to ?? null,
      sourceRangeSource: sourceRangeTarget?.range?.source ?? null,
      allowHeuristicSticky,
      preferDomAnchorForRenderedClick,
      sourcePosDistanceToSourceFromBlock,
      sourcePosLineDeltaAfterSourceFromBlock,
      sourceFromBlockIsFencedCode,
      preferSourceFromForRenderedFencedClick,
      preferSourceFromForRenderedBoundaryClick,
      stickySelection,
      preferredSelection,
      allowCoordinateRemap,
      reboundToSourcePosBlock: shouldReboundToSourcePosBlock,
      pointerProbe
    });

    return {
      sourceFrom: blockBounds?.from ?? sourceFrom,
      sourcePos: preferredSelection,
      rawSourcePos: Number.isFinite(sourcePosByCoordinates) ? sourcePosByCoordinates : null,
      sourcePosOrigin,
      blockBounds,
      strategy: 'rendered-block',
      allowCoordinateRemap,
      pointerProbe
    };
  }
  liveDebug.trace('block.activate.pass-through-native', {
    trigger,
    reason: 'not-rendered-block-target',
    tagName: targetElement.tagName,
    className: typeof targetElement.className === 'string' ? targetElement.className : ''
  });
  return null;
}

function handleLivePointerActivation(view, event, trigger) {
  const targetElement = normalizePointerTarget(event.target);
  const coordinates = readPointerCoordinates(event);
  const targetSummary = describeElementForLog(targetElement);

  if (app.viewMode === 'live') {
    const pointerSignal = recordInputSignal('pointer', {
      trigger,
      x: coordinates?.x ?? null,
      y: coordinates?.y ?? null,
      targetTag: targetSummary?.tagName ?? null,
      targetClassName: targetSummary?.className ?? null,
      sourceFrom: targetSummary?.sourceFrom ?? null
    });
    liveDebug.trace('input.pointer', {
      ...pointerSignal,
      target: targetSummary
    });
  }

  if (app.viewMode !== 'live') {
    return false;
  }

  if (!targetElement) {
    liveDebug.trace('block.activate.miss', {
      trigger,
      reason: 'no-element-target'
    });
    return false;
  }

  const renderedBlockTarget = targetElement.closest('.cm-rendered-block');
  if (!renderedBlockTarget) {
    liveDebug.trace('block.activate.pass-through-native', {
      trigger,
      reason: 'not-rendered-block-target',
      tagName: targetElement.tagName,
      className: typeof targetElement.className === 'string' ? targetElement.className : ''
    });
    return false;
  }

  const activation = resolveLiveActivationContext(view, targetElement, coordinates, trigger);
  if (!activation) {
    return false;
  }

  liveDebug.trace('block.activate.request', {
    trigger,
    sourceFrom: activation.sourceFrom,
    sourcePos: activation.sourcePos,
    rawSourcePos: activation.rawSourcePos ?? null,
    sourcePosOrigin: activation.sourcePosOrigin ?? null,
    strategy: activation.strategy,
    match: activation.match ?? null,
    allowCoordinateRemap: activation.allowCoordinateRemap !== false,
    blockFrom: activation.blockBounds?.from ?? null,
    blockTo: activation.blockBounds?.to ?? null,
    pointerProbe: activation.pointerProbe ?? null,
    x: coordinates?.x ?? null,
    y: coordinates?.y ?? null
  });

  if (typeof event.preventDefault === 'function') {
    event.preventDefault();
  }

  try {
    activateLiveBlock(
      view,
      activation.sourceFrom,
      coordinates,
      trigger,
      activation.blockBounds,
      activation.sourcePos,
      activation.allowCoordinateRemap !== false,
      activation.strategy
    );
    return true;
  } catch (error) {
    liveDebug.error('block.activate.failed', {
      trigger,
      message: error instanceof Error ? error.message : String(error),
      sourceFrom: activation.sourceFrom,
      sourcePos: activation.sourcePos
    });
    return false;
  }
}

function activateLiveBlock(
  view,
  sourceFrom,
  coordinates = null,
  trigger = 'unknown',
  blockBounds = null,
  preferredSelection = null,
  allowCoordinateRemap = true,
  strategy = null
) {
  const docLength = view.state.doc.length;
  const preferredPos = Number.isFinite(preferredSelection) ? preferredSelection : sourceFrom;
  const baseSelection = resolveLiveBlockSelection(docLength, sourceFrom, preferredPos, blockBounds);
  const baseSelectionLineInfo = readLineInfoForPosition(view.state.doc, baseSelection);

  try {
    view.dispatch({
      selection: { anchor: baseSelection },
      scrollIntoView: true
    });
    view.focus();
  } catch (error) {
    liveDebug.error('block.activate.dispatch-failed', {
      trigger,
      sourceFrom,
      selection: baseSelection,
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
  liveDebug.trace('block.activated', {
    trigger,
    sourceFrom,
    selection: baseSelection,
    preferredSelection: Number.isFinite(preferredSelection) ? preferredSelection : null,
    baseSelectionLineInfo,
    allowCoordinateRemap,
    strategy: strategy ?? null,
    blockFrom: blockBounds?.from ?? null,
    blockTo: blockBounds?.to ?? null
  });

  if (!coordinates || !allowCoordinateRemap) {
    liveDebug.trace('block.position.mapped.skipped', {
      trigger,
      sourceFrom,
      selection: baseSelection,
      allowCoordinateRemap,
      reason: !coordinates ? 'missing-coordinates' : 'disabled-for-strategy',
      strategy: strategy ?? null,
      blockFrom: blockBounds?.from ?? null,
      blockTo: blockBounds?.to ?? null
    });
    return;
  }

  window.requestAnimationFrame(() => {
    const mappedPos = view.posAtCoords(coordinates);
    const docLengthAfterFrame = view.state.doc.length;
    const mappedPosLooksLikeDocEndDrift =
      !blockBounds &&
      Number.isFinite(mappedPos) &&
      mappedPos === docLengthAfterFrame &&
      sourceFrom < docLengthAfterFrame;
    const useMappedPosition =
      Number.isFinite(mappedPos) && !mappedPosLooksLikeDocEndDrift;
    const fallbackSelection = useMappedPosition ? sourceFrom : baseSelection;
    const nextMappedPos = useMappedPosition ? mappedPos : Number.NaN;
    const unboundedPos = resolveLiveBlockSelection(
      docLengthAfterFrame,
      fallbackSelection,
      nextMappedPos
    );
    const resolvedPos = resolveLiveBlockSelection(
      docLengthAfterFrame,
      fallbackSelection,
      nextMappedPos,
      blockBounds
    );
    const clampedByBlock = resolvedPos !== unboundedPos;
    const mappedLineInfo = readLineInfoForPosition(view.state.doc, mappedPos);
    const resolvedLineInfo = readLineInfoForPosition(view.state.doc, resolvedPos);
    const positionDeltaFromBase = Math.abs(resolvedPos - baseSelection);
    const lineDeltaFromBase =
      Number.isFinite(resolvedLineInfo?.lineNumber) && Number.isFinite(baseSelectionLineInfo?.lineNumber)
        ? Math.abs(resolvedLineInfo.lineNumber - baseSelectionLineInfo.lineNumber)
        : null;
    const largeDeltaDetected =
      Number.isFinite(positionDeltaFromBase) &&
      positionDeltaFromBase >= LIVE_DEBUG_BLOCK_MAP_LARGE_DELTA_POS &&
      Number.isFinite(lineDeltaFromBase) &&
      lineDeltaFromBase >= LIVE_DEBUG_BLOCK_MAP_LARGE_DELTA_LINES;
    const rejectMappedSelection =
      largeDeltaDetected &&
      strategy === 'rendered-block' &&
      Number.isFinite(preferredSelection);

    liveDebug.trace('block.position.mapped', {
      trigger,
      sourceFrom,
      mappedPos,
      mappedAccepted: useMappedPosition,
      mappedPosLooksLikeDocEndDrift,
      unboundedPos,
      resolvedPos,
      baseSelection,
      baseSelectionLineInfo,
      mappedLineInfo,
      resolvedLineInfo,
      positionDeltaFromBase,
      lineDeltaFromBase,
      largeDeltaDetected,
      rejectMappedSelection,
      clampedByBlock,
      blockFrom: blockBounds?.from ?? null,
      blockTo: blockBounds?.to ?? null,
      x: coordinates.x,
      y: coordinates.y
    });

    if (
      Number.isFinite(positionDeltaFromBase) &&
      positionDeltaFromBase >= LIVE_DEBUG_BLOCK_MAP_LARGE_DELTA_POS &&
      Number.isFinite(lineDeltaFromBase) &&
      lineDeltaFromBase >= LIVE_DEBUG_BLOCK_MAP_LARGE_DELTA_LINES
    ) {
      liveDebug.warn('block.position.mapped.large-delta', {
        trigger,
        sourceFrom,
        baseSelection,
        resolvedPos,
        positionDeltaFromBase,
        lineDeltaFromBase,
        mappedPos,
        mappedAccepted: useMappedPosition,
        blockFrom: blockBounds?.from ?? null,
        blockTo: blockBounds?.to ?? null,
        strategy: strategy ?? null,
        x: coordinates.x,
        y: coordinates.y
      });
    }

    if (rejectMappedSelection) {
      liveDebug.warn('block.position.mapped.rejected-large-delta', {
        trigger,
        sourceFrom,
        strategy,
        baseSelection,
        resolvedPos,
        mappedPos,
        positionDeltaFromBase,
        lineDeltaFromBase,
        preferredSelection,
        blockFrom: blockBounds?.from ?? null,
        blockTo: blockBounds?.to ?? null,
        x: coordinates.x,
        y: coordinates.y
      });
      return;
    }

    if (resolvedPos !== baseSelection) {
      view.dispatch({
        selection: { anchor: resolvedPos },
        scrollIntoView: true
      });
    }
  });
}

function moveLiveCursorVertically(view, direction, trigger = 'arrow') {
  if (app.viewMode !== 'live' || !Number.isInteger(direction) || direction === 0) {
    return false;
  }

  recordInputSignal('keyboard', {
    trigger,
    key: direction > 0 ? 'ArrowDown' : 'ArrowUp'
  });

  const selection = view.state.selection.main;
  if (!selection.empty) {
    liveDebug.trace('cursor.move.vertical.skipped', {
      trigger,
      reason: 'non-empty-selection',
      anchor: selection.anchor,
      head: selection.head
    });
    return false;
  }

  const currentLine = view.state.doc.lineAt(selection.head);
  const targetLineNumber = currentLine.number + direction;
  if (targetLineNumber < 1 || targetLineNumber > view.state.doc.lines) {
    liveDebug.trace('cursor.move.vertical.boundary', {
      trigger,
      direction,
      from: selection.head,
      fromLine: currentLine.number
    });
    return true;
  }

  const targetLine = view.state.doc.line(targetLineNumber);
  const currentColumn = Math.max(0, selection.head - currentLine.from);
  const targetPos = Math.min(targetLine.to, targetLine.from + currentColumn);
  const currentLineLength = Math.max(0, currentLine.to - currentLine.from);
  const targetLineLength = Math.max(0, targetLine.to - targetLine.from);
  const primaryAssoc = direction > 0 ? -1 : 1;
  const secondaryAssoc = -primaryAssoc;

  view.dispatch({
    selection: EditorSelection.cursor(targetPos, primaryAssoc),
    scrollIntoView: true
  });
  view.focus();

  liveDebug.trace('cursor.move.vertical', {
    trigger,
    direction,
    from: selection.head,
    to: targetPos,
    fromLine: currentLine.number,
    toLine: targetLine.number,
    column: currentColumn,
    currentLineLength,
    targetLineLength,
    targetLineTextPreview: normalizeLogString(
      view.state.doc.sliceString(targetLine.from, targetLine.to),
      80
    ),
    assoc: primaryAssoc
  });
  scheduleCursorVisibilityProbe(view, 'moveLiveCursorVertically');

  window.requestAnimationFrame(() => {
    if (app.viewMode !== 'live' || view.state.selection.main.head !== targetPos) {
      return;
    }

    const cursorState = readCursorVisibilityForLog(view, targetPos);
    const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
    const selectedLineLength = Math.max(0, selectedLine.to - selectedLine.from);
    const domSelection = readDomSelectionForLog();
    const domSelectionOnContentContainer =
      typeof domSelection?.anchorNode?.className === 'string' &&
      domSelection.anchorNode.className.includes('cm-content');
    const shouldCorrectAssoc =
      cursorState.hasCursorElement &&
      isCursorVisibilitySuspect(
        cursorState,
        selectedLineLength,
        domSelectionOnContentContainer
      );
    if (!shouldCorrectAssoc) {
      return;
    }

    view.dispatch({
      selection: EditorSelection.cursor(targetPos, secondaryAssoc),
      scrollIntoView: true
    });
    view.focus();
    liveDebug.warn('cursor.move.vertical.corrected-assoc', {
      trigger,
      targetPos,
      lineNumber: selectedLine.number,
      lineLength: selectedLineLength,
      previousAssoc: primaryAssoc,
      nextAssoc: secondaryAssoc,
      cursorState
    });
    scheduleCursorVisibilityProbe(view, 'moveLiveCursorVertically-corrected-assoc');
  });

  return true;
}

const livePreviewPointerHandlers = EditorView.domEventHandlers({
  mousedown(event, view) {
    return handleLivePointerActivation(view, event, 'mousedown');
  },
  touchstart(event, view) {
    return handleLivePointerActivation(view, event, 'touchstart');
  },
  keydown(event, view) {
    if (!LIVE_DEBUG_KEYLOG_KEYS.has(event.key) && app.viewMode !== 'live') {
      return false;
    }

    const signal = recordInputSignal('keyboard', {
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
    scheduleCursorVisibilityProbe(view, 'editor-focus');
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

const livePreviewAtomicRanges = EditorView.atomicRanges.of(
  () => Decoration.none
);

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
    if (app.viewMode !== 'live' && !LIVE_DEBUG_KEYLOG_KEYS.has(event.key)) {
      return;
    }

    const targetElement = normalizePointerTarget(event.target);
    const targetSummary = describeElementForLog(targetElement);
    const activeElement =
      document.activeElement instanceof Element ? describeElementForLog(document.activeElement) : null;
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
      LIVE_DEBUG_DOM_SELECTION_THROTTLE_MS
    ) {
      return;
    }
    liveDebugDiagnostics.lastDomSelectionChangeLoggedAt = now;

    const domSelection = readDomSelectionForLog();
    const activeElement = document.activeElement;
    const anchorNode = window.getSelection?.()?.anchorNode ?? null;
    const relatedToEditor =
      (activeElement instanceof Node && view.dom.contains(activeElement)) ||
      (anchorNode instanceof Node && view.dom.contains(anchorNode));

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
  document.addEventListener('selectionchange', onDocumentSelectionChange, true);

  liveDebug.info('diagnostics.editor-input.installed', {});
}

function setViewMode(nextMode) {
  const previousMode = app.viewMode;
  const mode = nextMode === 'preview' || nextMode === 'live' ? nextMode : 'raw';
  app.viewMode = mode;
  liveDebug.info('mode.changed', {
    from: previousMode,
    to: mode
  });

  const showEditor = mode !== 'preview';
  const showPreview = mode === 'preview';

  editorElement.hidden = !showEditor;
  previewElement.hidden = !showPreview;

  rawModeButton.classList.toggle('active', mode === 'raw');
  rawModeButton.setAttribute('aria-pressed', String(mode === 'raw'));

  liveModeButton.classList.toggle('active', mode === 'live');
  liveModeButton.setAttribute('aria-pressed', String(mode === 'live'));

  previewModeButton.classList.toggle('active', mode === 'preview');
  previewModeButton.setAttribute('aria-pressed', String(mode === 'preview'));

  editorElement.classList.toggle('live-mode', mode === 'live');

  if (mode === 'preview') {
    renderPreview(getEditorText());
    return;
  }

  requestLivePreviewRefresh('mode-change');
  editorView.focus();

  window.requestAnimationFrame(() => {
    if (app.viewMode === mode) {
      requestLivePreviewRefresh('mode-change-post-frame');
    }
  });
}

function getEditorText() {
  return editorView.state.doc.toString();
}

function setEditorText(nextText) {
  app.isLoadingFile = true;
  liveDebugDiagnostics.lastProgrammaticSelectionAt = Date.now();
  const previousLength = editorView.state.doc.length;
  const previousHead = editorView.state.selection.main.head;

  editorView.dispatch({
    changes: {
      from: 0,
      to: editorView.state.doc.length,
      insert: nextText
    },
    selection: { anchor: 0 },
    scrollIntoView: true
  });
  liveDebug.trace('editor.text.set.programmatic', {
    previousLength,
    nextLength: nextText.length,
    previousHead,
    nextHead: editorView.state.selection.main.head
  });

  app.isLoadingFile = false;
}

function notifyLauncher(pathname) {
  if (!launcherToken) {
    return;
  }

  const url = buildLauncherEndpoint(pathname);
  void fetch(url, {
    method: 'POST',
    keepalive: true,
    headers: {
      'content-type': 'text/plain'
    },
    body: '1'
  }).catch(() => {
    // Ignore launcher heartbeat failures so normal app usage is unaffected.
  });
}

function startLauncherHeartbeat() {
  if (!launcherToken) {
    return;
  }

  notifyLauncher('/__launcher/heartbeat');

  launcherHeartbeatTimer = window.setInterval(() => {
    notifyLauncher('/__launcher/heartbeat');
    void flushLiveDebugUploads('heartbeat');
  }, LAUNCHER_HEARTBEAT_MS);

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushLiveDebugUploadsWithBeacon('visibility-hidden');
      return;
    }

    if (document.visibilityState === 'visible') {
      notifyLauncher('/__launcher/heartbeat');
      void flushLiveDebugUploads('visibility-visible');
    }
  });

  window.addEventListener('beforeunload', () => {
    flushLiveDebugUploadsWithBeacon('beforeunload');

    if (launcherHeartbeatTimer) {
      window.clearInterval(launcherHeartbeatTimer);
      launcherHeartbeatTimer = null;
    }

    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        buildLauncherEndpoint('/__launcher/disconnect'),
        'closing'
      );
      return;
    }

    notifyLauncher('/__launcher/disconnect');
  });
}

function slashCommandCompletion(context) {
  const token = context.matchBefore(/\/[a-z-]*/i);

  if (!token) {
    return null;
  }

  if (!context.explicit && token.from === token.to) {
    return null;
  }

  return {
    from: token.from,
    options: markdownCommands,
    validFor: /\/[a-z-]*/i
  };
}

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

async function readWorkspaceFromDb() {
  if (!('indexedDB' in window)) {
    return null;
  }

  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const request = store.get(WORKSPACE_KEY);

    request.onsuccess = () => {
      resolve(request.result ?? null);
    };

    request.onerror = () => {
      reject(request.error);
    };

    tx.oncomplete = () => {
      db.close();
    };

    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

async function writeWorkspaceToDb(payload) {
  if (!('indexedDB' in window)) {
    return;
  }

  const db = await openDatabase();

  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const request = store.put(payload, WORKSPACE_KEY);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };

    tx.oncomplete = () => {
      db.close();
    };

    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

async function persistWorkspaceState() {
  if (!app.folderHandle) {
    return;
  }

  try {
    await writeWorkspaceToDb({
      folderHandle: app.folderHandle,
      currentPath: app.currentPath
    });
  } catch (error) {
    console.warn('Unable to persist workspace state:', error);
  }
}

async function ensureReadWritePermission(handle) {
  const options = { mode: 'readwrite' };

  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }

  return (await handle.requestPermission(options)) === 'granted';
}

async function saveCurrentFile(force = false) {
  if (!app.currentFileHandle) {
    return;
  }

  if (!force && !app.hasUnsavedChanges) {
    return;
  }

  const permitted = await ensureReadWritePermission(app.currentFileHandle);
  if (!permitted) {
    setStatus('Write permission was denied for this file.', true);
    return;
  }

  const markdownText = getEditorText();
  const writable = await app.currentFileHandle.createWritable();
  await writable.write(markdownText);
  await writable.close();

  app.lastSavedText = markdownText;
  app.hasUnsavedChanges = false;
  updateActionButtons();
  setStatus(`Saved ${app.currentPath}`);
}

function scheduleAutosave() {
  if (app.autosaveTimer) {
    window.clearTimeout(app.autosaveTimer);
  }

  app.autosaveTimer = window.setTimeout(() => {
    void saveCurrentFile().catch((error) => {
      console.error(error);
      setStatus(`Autosave failed: ${error.message}`, true);
    });
  }, 700);
}

async function openFile(path) {
  const handle = app.fileHandles.get(path);
  if (!handle) {
    return;
  }

  const file = await handle.getFile();
  const markdownText = await file.text();
  liveDebug.info('file.open.read', {
    path,
    byteLength: file.size,
    textLength: markdownText.length
  });

  app.currentPath = path;
  app.currentFileHandle = handle;
  app.lastSavedText = markdownText;
  app.hasUnsavedChanges = false;

  setEditorText(markdownText);
  if (app.viewMode === 'preview') {
    renderPreview(markdownText);
  }
  renderFileList();
  updateActionButtons();

  await persistWorkspaceState();
  setStatus(`Editing ${path}`);
}

async function loadWorkspace(folderHandle, preferredPath = null) {
  app.folderHandle = folderHandle;
  app.fileHandles = await walkDirectory(folderHandle);
  renderFileList();
  updateActionButtons();

  if (app.fileHandles.size === 0) {
    app.currentPath = null;
    app.currentFileHandle = null;
    app.lastSavedText = getEditorText();
    app.hasUnsavedChanges = false;
    updateActionButtons();

    setStatus(
      `Folder "${folderHandle.name}" has no markdown files. Use New Note to create one.`
    );
    await persistWorkspaceState();
    return;
  }

  const firstPath = app.fileHandles.keys().next().value;
  const initialPath = preferredPath && app.fileHandles.has(preferredPath)
    ? preferredPath
    : firstPath;

  await openFile(initialPath);
}

async function restoreWorkspaceState() {
  try {
    const savedState = await readWorkspaceFromDb();

    if (!savedState?.folderHandle) {
      return;
    }

    const permission = await savedState.folderHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      setStatus('Re-open your folder to continue editing local markdown files.');
      return;
    }

    await loadWorkspace(savedState.folderHandle, savedState.currentPath ?? null);
    setStatus(`Restored folder "${savedState.folderHandle.name}".`);
  } catch (error) {
    console.warn('Could not restore workspace:', error);
  }
}

async function pickFolder() {
  if (!('showDirectoryPicker' in window)) {
    setStatus('This browser does not support local folder editing. Use Chrome or Edge desktop.', true);
    return;
  }

  try {
    const folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const permitted = await ensureReadWritePermission(folderHandle);

    if (!permitted) {
      setStatus('Folder permission was not granted.', true);
      return;
    }

    await loadWorkspace(folderHandle);
    await persistWorkspaceState();

    setStatus(`Opened "${folderHandle.name}".`);
  } catch (error) {
    if (error.name === 'AbortError') {
      setStatus('Folder selection cancelled.');
      return;
    }

    setStatus(`Unable to open folder: ${error.message}`, true);
  }
}

async function createNewNote() {
  if (!app.folderHandle) {
    setStatus('Open a folder first.', true);
    return;
  }

  const rawInput = window.prompt('Name the new markdown file (you can include subfolders):', 'notes/new-note.md');
  if (!rawInput) {
    return;
  }

  const trimmed = rawInput.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) {
    setStatus('File name cannot be empty.', true);
    return;
  }

  const pathSegments = trimmed.split('/').filter(Boolean);
  if (pathSegments.length === 0) {
    setStatus('File name cannot be empty.', true);
    return;
  }

  let filename = pathSegments.pop();
  if (!isMarkdownFile(filename)) {
    filename = `${filename}.md`;
  }

  try {
    let targetDirectory = app.folderHandle;
    for (const segment of pathSegments) {
      targetDirectory = await targetDirectory.getDirectoryHandle(segment, { create: true });
    }

    const fileHandle = await targetDirectory.getFileHandle(filename, { create: true });
    const fullPath = [...pathSegments, filename].join('/');
    const existingFile = await fileHandle.getFile();

    if (existingFile.size === 0) {
      const starterTitle = filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      const initialText = `# ${starterTitle}\n\n`;
      const writable = await fileHandle.createWritable();
      await writable.write(initialText);
      await writable.close();
    }

    await loadWorkspace(app.folderHandle, fullPath);
    setStatus(`Created ${fullPath}`);
  } catch (error) {
    setStatus(`Could not create note: ${error.message}`, true);
  }
}

const editorView = new EditorView({
  state: EditorState.create({
    doc: '# Welcome\n\nChoose a folder and start editing markdown files.\n\nType `/` for quick markdown snippets.\n',
    selection: { anchor: 0 },
    extensions: [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      keymap.of([
        indentWithTab,
        {
          key: 'ArrowDown',
          run: (view) => moveLiveCursorVertically(view, 1, 'ArrowDown')
        },
        {
          key: 'ArrowUp',
          run: (view) => moveLiveCursorVertically(view, -1, 'ArrowUp')
        },
        {
          key: 'Enter',
          run: insertNewlineContinueMarkup
        }
      ]),
      livePreviewStateField,
      EditorView.decorations.from(
        livePreviewStateField,
        (stateValue) => stateValue.decorations
      ),
      livePreviewAtomicRanges,
      livePreviewPointerHandlers,
      autocompletion({
        activateOnTyping: true,
        override: [slashCommandCompletion]
      }),
      EditorView.updateListener.of((update) => {
        if (app.viewMode === 'live' && update.selectionSet) {
          const previousSelection = update.startState.selection.main;
          const currentSelection = update.state.selection.main;
          const previousLine = update.startState.doc.lineAt(previousSelection.head);
          const currentLine = update.state.doc.lineAt(currentSelection.head);
          const positionDelta = Math.abs(currentSelection.head - previousSelection.head);
          const lineDelta = Math.abs(currentLine.number - previousLine.number);
          const userEvents = collectTransactionUserEvents(update);
          const recentInput = readRecentInputSignal();
          const transactionSummary = summarizeTransactionsForLog(update);
          const domSelection = readDomSelectionForLog();
          const now = Date.now();
          const hasRecentInput = Boolean(recentInput && Number.isFinite(recentInput.ageMs));
          const programmaticSelectionAgeMs =
            now - liveDebugDiagnostics.lastProgrammaticSelectionAt;
          const shouldSuppressJumpDetection =
            app.isLoadingFile ||
            (
              Number.isFinite(programmaticSelectionAgeMs) &&
              programmaticSelectionAgeMs >= 0 &&
              programmaticSelectionAgeMs <=
                LIVE_DEBUG_SELECTION_JUMP_SUPPRESS_AFTER_PROGRAMMATIC_MS
            ) ||
            (update.docChanged && !hasRecentInput);

          liveDebug.trace('selection.changed', {
            anchor: currentSelection.anchor,
            head: currentSelection.head,
            previousAnchor: previousSelection.anchor,
            previousHead: previousSelection.head,
            previousLineNumber: previousLine.number,
            currentLineNumber: currentLine.number,
            positionDelta,
            lineDelta,
            docChanged: update.docChanged,
            userEvents,
            recentInputKind: recentInput?.kind ?? null,
            recentInputTrigger: recentInput?.trigger ?? null,
            recentInputKey: recentInput?.key ?? null,
            recentInputAgeMs: recentInput?.ageMs ?? null,
            programmaticSelectionAgeMs: Number.isFinite(programmaticSelectionAgeMs)
              ? programmaticSelectionAgeMs
              : null,
            jumpDetectionSuppressed: shouldSuppressJumpDetection,
            transactionSummary,
            domSelection
          });
          scheduleCursorVisibilityProbe(update.view, 'selection-changed');

          const likelyUnexpectedJump =
            positionDelta >= LIVE_DEBUG_SELECTION_JUMP_WARN_POS_DELTA &&
            lineDelta >= LIVE_DEBUG_SELECTION_JUMP_WARN_LINE_DELTA;
          if (likelyUnexpectedJump && shouldSuppressJumpDetection) {
            liveDebug.trace('selection.jump.suppressed', {
              previousHead: previousSelection.head,
              currentHead: currentSelection.head,
              previousLineNumber: previousLine.number,
              currentLineNumber: currentLine.number,
              positionDelta,
              lineDelta,
              docChanged: update.docChanged,
              appIsLoadingFile: app.isLoadingFile,
              programmaticSelectionAgeMs: Number.isFinite(programmaticSelectionAgeMs)
                ? programmaticSelectionAgeMs
                : null,
              recentInputKind: recentInput?.kind ?? null,
              recentInputKey: recentInput?.key ?? null,
              recentInputAgeMs: recentInput?.ageMs ?? null,
              userEvents
            });
          }
          if (
            likelyUnexpectedJump &&
            !shouldSuppressJumpDetection &&
            now - liveDebugDiagnostics.lastSelectionJumpLoggedAt > 500
          ) {
            liveDebugDiagnostics.lastSelectionJumpLoggedAt = now;
            liveDebug.warn('selection.jump.detected', {
              previousHead: previousSelection.head,
              currentHead: currentSelection.head,
              previousLineNumber: previousLine.number,
              currentLineNumber: currentLine.number,
              positionDelta,
              lineDelta,
              userEvents,
              recentInputKind: recentInput?.kind ?? null,
              recentInputTrigger: recentInput?.trigger ?? null,
              recentInputKey: recentInput?.key ?? null,
              recentInputAgeMs: recentInput?.ageMs ?? null,
              transactionSummary,
              domSelection
            });
            captureLiveDebugSnapshot('selection-jump-detected');
          }
        }

        if (!update.docChanged) {
          return;
        }

        const markdownText = update.state.doc.toString();
        liveDebug.trace('document.changed', {
          mode: app.viewMode,
          length: markdownText.length
        });
        if (app.viewMode === 'preview') {
          renderPreview(markdownText);
        }

        if (app.isLoadingFile) {
          return;
        }

        app.hasUnsavedChanges = markdownText !== app.lastSavedText;
        updateActionButtons();

        if (!app.hasUnsavedChanges) {
          return;
        }

        setStatus(`Unsaved changes in ${app.currentPath ?? 'scratch buffer'}...`);
        scheduleAutosave();
      })
    ]
  }),
  parent: editorElement
});

installEditorInputDiagnostics(editorView);
installRuntimeDiagnostics();
mountLiveDebugPanel();
initTheme();
renderPreview(editorView.state.doc.toString());
setViewMode(app.viewMode);
updateActionButtons();

openFolderButton.addEventListener('click', () => {
  void pickFolder();
});

newNoteButton.addEventListener('click', () => {
  void createNewNote();
});

saveNowButton.addEventListener('click', () => {
  void saveCurrentFile(true).catch((error) => {
    setStatus(`Save failed: ${error.message}`, true);
  });
});

rawModeButton.addEventListener('click', () => {
  setViewMode('raw');
});

liveModeButton.addEventListener('click', () => {
  setViewMode('live');
});

previewModeButton.addEventListener('click', () => {
  setViewMode('preview');
});

window.addEventListener('beforeunload', (event) => {
  if (!app.hasUnsavedChanges) {
    return;
  }

  event.preventDefault();
  event.returnValue = '';
});

void restoreWorkspaceState();
startLauncherHeartbeat();
