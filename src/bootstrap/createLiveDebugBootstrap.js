import { createLauncherDebugBridge } from './createLauncherDebugBridge.js';

const LIVE_DEBUG_STORAGE_KEY = 'meetingMinutes.liveDebugLevel';
const LEVELS = ['off', 'error', 'warn', 'info', 'trace'];
const LEVEL_PRIORITY = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  trace: 4
};

function normalizeLevel(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized in LEVEL_PRIORITY) {
    return normalized;
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'debug') {
    return 'trace';
  }
  if (normalized === '0' || normalized === 'false') {
    return 'off';
  }
  return null;
}

function readStoredLevel(storage) {
  if (!storage) {
    return '';
  }
  try {
    return storage.getItem(LIVE_DEBUG_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistLevel(storage, level) {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(LIVE_DEBUG_STORAGE_KEY, level);
  } catch {
    // Ignore storage persistence errors.
  }
}

function resolveLevel(search = '', storedValue = '') {
  const params = new URLSearchParams(search);
  const queryLevel = normalizeLevel(params.get('debugLive'));
  if (queryLevel) {
    return queryLevel;
  }
  const storedLevel = normalizeLevel(storedValue);
  return storedLevel ?? 'off';
}

function createMinimalLiveDebugLogger({
  scope = 'live-preview',
  level = 'off',
  maxEntries = 300
} = {}) {
  let currentLevel = normalizeLevel(level) ?? 'off';
  const entries = [];
  const subscribers = new Set();

  function notify(payload) {
    for (const subscriber of subscribers) {
      try {
        subscriber(payload);
      } catch {
        // Ignore listener errors.
      }
    }
  }

  function shouldEmit(levelName) {
    return currentLevel !== 'off' && LEVEL_PRIORITY[levelName] <= LEVEL_PRIORITY[currentLevel];
  }

  function pushEntry(levelName, event, data = {}) {
    if (!shouldEmit(levelName)) {
      return null;
    }
    const entry = {
      at: new Date().toISOString(),
      scope,
      level: levelName,
      event,
      data
    };
    entries.push(entry);
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }
    notify({
      type: 'entry',
      entry
    });
    return entry;
  }

  return {
    getLevel() {
      return currentLevel;
    },
    setLevel(levelName) {
      const normalized = normalizeLevel(levelName);
      if (normalized) {
        currentLevel = normalized;
      }
      notify({
        type: 'level',
        level: currentLevel
      });
      return currentLevel;
    },
    getEntries() {
      return entries.slice();
    },
    clearEntries() {
      entries.length = 0;
      notify({
        type: 'clear'
      });
    },
    subscribe(listener) {
      if (typeof listener !== 'function') {
        return () => {};
      }
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    error(event, data) {
      pushEntry('error', event, data);
    },
    warn(event, data) {
      pushEntry('warn', event, data);
    },
    info(event, data) {
      pushEntry('info', event, data);
    },
    trace(event, data) {
      pushEntry('trace', event, data);
    }
  };
}

function attachToWindow(targetWindow, logger, setLevel) {
  if (!targetWindow) {
    return;
  }
  targetWindow.__meetingMinutesLiveDebug = {
    get level() {
      return logger.getLevel();
    },
    setLevel,
    clear() {
      logger.clearEntries();
    },
    entries() {
      return logger.getEntries();
    }
  };
}

export function createLiveDebugBootstrap({
  windowObject = window,
  isDevBuild = false,
  markdownEngineOptions = null,
  scope = 'live-preview'
} = {}) {
  const configuredLiveDebugLevel = resolveLevel(
    windowObject?.location?.search ?? '',
    readStoredLevel(windowObject?.localStorage)
  );
  const initialLiveDebugLevel =
    configuredLiveDebugLevel === 'off' && isDevBuild ? 'trace' : configuredLiveDebugLevel;
  const liveDebug = createMinimalLiveDebugLogger({
    scope,
    level: initialLiveDebugLevel
  });

  function setLiveDebugLevel(level) {
    const nextLevel = liveDebug.setLevel(level);
    persistLevel(windowObject?.localStorage, nextLevel);
    return nextLevel;
  }

  setLiveDebugLevel(liveDebug.getLevel());
  attachToWindow(windowObject, liveDebug, setLiveDebugLevel);
  const launcherDebugBridge = createLauncherDebugBridge({
    windowObject,
    liveDebug,
    scope
  });
  if (markdownEngineOptions) {
    liveDebug.info('markdown.engine.config', markdownEngineOptions);
  }
  liveDebug.info('live.mode.architecture', {
    renderer: scope,
    sourceOfTruth: 'source->model->projection'
  });
  if (launcherDebugBridge.enabled) {
    liveDebug.info('launcher.bridge.enabled', {
      sessionId: launcherDebugBridge.sessionId
    });
  }

  return {
    liveDebug,
    launcherDebugBridge,
    setLiveDebugLevel,
    configuredLiveDebugLevel,
    initialLiveDebugLevel
  };
}
