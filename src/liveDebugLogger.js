export const LIVE_DEBUG_QUERY_PARAM = 'debugLive';
export const LIVE_DEBUG_STORAGE_KEY = 'meetingMinutes.liveDebugLevel';

const LEVEL_PRIORITY = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  trace: 4
};

const LEVEL_ALIASES = {
  '1': 'trace',
  '0': 'off',
  true: 'trace',
  false: 'off',
  on: 'trace',
  off: 'off',
  debug: 'trace'
};

function toLevel(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized in LEVEL_PRIORITY) {
    return normalized;
  }

  if (normalized in LEVEL_ALIASES) {
    return LEVEL_ALIASES[normalized];
  }

  return null;
}

export function resolveLiveDebugLevel({ search = '', storedValue = '' } = {}) {
  const params = new URLSearchParams(search);
  const queryLevel = toLevel(params.get(LIVE_DEBUG_QUERY_PARAM));
  if (queryLevel) {
    return queryLevel;
  }

  const storedLevel = toLevel(storedValue);
  if (storedLevel) {
    return storedLevel;
  }

  return 'off';
}

function consoleMethodForLevel(level) {
  if (level === 'trace') {
    return 'debug';
  }

  return level;
}

function shouldLog(currentLevel, nextLevel) {
  return LEVEL_PRIORITY[nextLevel] <= LEVEL_PRIORITY[currentLevel] && currentLevel !== 'off';
}

export function createLiveDebugLogger({
  scope = 'live-preview',
  level = 'off',
  maxEntries = 400,
  sink = null
} = {}) {
  let currentLevel = toLevel(level) ?? 'off';
  const entries = Array.isArray(sink) ? sink : [];
  const listeners = new Set();

  function pushEntry(entry) {
    entries.push(entry);
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }
  }

  function notifyListeners(payload = null) {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // ignore listener errors
      }
    }
  }

  function emit(levelName, event, data = {}) {
    if (!shouldLog(currentLevel, levelName)) {
      return null;
    }

    const entry = {
      at: new Date().toISOString(),
      scope,
      level: levelName,
      event,
      data
    };

    pushEntry(entry);

    const method = consoleMethodForLevel(levelName);
    const logger = console[method] ?? console.log;
    logger.call(console, `[${scope}] ${event}`, data);
    return entry;
  }

  return {
    getLevel() {
      return currentLevel;
    },
    setLevel(nextLevel) {
      currentLevel = toLevel(nextLevel) ?? currentLevel;
      notifyListeners({
        type: 'level',
        level: currentLevel
      });
      return currentLevel;
    },
    clearEntries() {
      entries.length = 0;
      notifyListeners({
        type: 'clear'
      });
    },
    getEntries() {
      return entries.slice();
    },
    subscribe(listener) {
      if (typeof listener !== 'function') {
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    error(event, data) {
      const entry = emit('error', event, data);
      if (entry) {
        notifyListeners({
          type: 'entry',
          entry
        });
      }
    },
    warn(event, data) {
      const entry = emit('warn', event, data);
      if (entry) {
        notifyListeners({
          type: 'entry',
          entry
        });
      }
    },
    info(event, data) {
      const entry = emit('info', event, data);
      if (entry) {
        notifyListeners({
          type: 'entry',
          entry
        });
      }
    },
    trace(event, data) {
      const entry = emit('trace', event, data);
      if (entry) {
        notifyListeners({
          type: 'entry',
          entry
        });
      }
    }
  };
}

export function readStoredLiveDebugLevel(storage) {
  if (!storage) {
    return '';
  }

  try {
    return storage.getItem(LIVE_DEBUG_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function persistLiveDebugLevel(storage, level) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(LIVE_DEBUG_STORAGE_KEY, level);
  } catch {
    // ignore storage write errors
  }
}

export function attachLiveDebugToWindow(targetWindow, logger, onSetLevel = null) {
  if (!targetWindow) {
    return;
  }

  targetWindow.__meetingMinutesLiveDebug = {
    get level() {
      return logger.getLevel();
    },
    setLevel(level) {
      const next = logger.setLevel(level);
      if (typeof onSetLevel === 'function') {
        onSetLevel(next);
      }
      return next;
    },
    clear() {
      logger.clearEntries();
    },
    entries() {
      return logger.getEntries();
    }
  };
}
