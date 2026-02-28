import { LIVE_CONSTANTS } from './liveConstants.js';

function readLauncherToken(windowObject) {
  if (!windowObject?.location?.search) {
    return null;
  }

  try {
    const params = new URLSearchParams(windowObject.location.search);
    const token = params.get('launcherToken');
    return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null;
  } catch {
    return null;
  }
}

function createSessionId(windowObject) {
  if (typeof windowObject?.crypto?.randomUUID === 'function') {
    return windowObject.crypto.randomUUID();
  }

  const random = Math.random().toString(36).slice(2);
  return `session-${Date.now()}-${random}`;
}

function createEndpoint(windowObject, path, token) {
  const url = new URL(path, windowObject.location.origin);
  url.searchParams.set('token', token);
  return url.toString();
}

function requestIdle(windowObject, callback, delayMs) {
  if (typeof windowObject?.requestIdleCallback === 'function') {
    return windowObject.requestIdleCallback(callback, {
      timeout: delayMs
    });
  }

  return windowObject.setTimeout(callback, delayMs);
}

function cancelIdle(windowObject, handle) {
  if (handle == null) {
    return;
  }

  if (typeof windowObject?.cancelIdleCallback === 'function') {
    windowObject.cancelIdleCallback(handle);
    return;
  }

  windowObject.clearTimeout(handle);
}

export function createLauncherDebugBridge({
  windowObject,
  liveDebug,
  scope = 'live-preview'
} = {}) {
  const token = readLauncherToken(windowObject);
  if (!token || typeof windowObject?.fetch !== 'function' || !liveDebug) {
    return {
      enabled: false,
      flushNow() {
        return Promise.resolve();
      },
      shutdown() {}
    };
  }

  const sessionId = createSessionId(windowObject);
  const heartbeatUrl = createEndpoint(windowObject, '/__launcher/heartbeat', token);
  const disconnectUrl = createEndpoint(windowObject, '/__launcher/disconnect', token);
  const uploadUrl = createEndpoint(windowObject, '/__launcher/live-debug', token);

  const queue = [];
  let flushHandle = null;
  let flushing = false;
  let stopped = false;

  function normalizeQueuedEntry(entry) {
    return {
      currentPath: `${windowObject.location.pathname}${windowObject.location.search}`,
      viewMode: 'live-preview',
      entry
    };
  }

  function trimQueue() {
    const maxQueue = LIVE_CONSTANTS.LIVE_DEBUG_UPLOAD_MAX_QUEUE;
    if (queue.length <= maxQueue) {
      return;
    }
    queue.splice(0, queue.length - maxQueue);
  }

  function scheduleFlush() {
    if (stopped || flushHandle != null) {
      return;
    }

    flushHandle = requestIdle(windowObject, () => {
      flushHandle = null;
      void flushNow('debounced');
    }, LIVE_CONSTANTS.LIVE_DEBUG_UPLOAD_DEBOUNCE_MS);
  }

  async function postHeartbeat() {
    if (stopped) {
      return;
    }

    try {
      await windowObject.fetch(heartbeatUrl, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain'
        },
        body: '1',
        keepalive: true
      });
    } catch {
      // Ignore heartbeat errors; launcher watchdog handles disconnects.
    }
  }

  async function flushNow(reason = 'manual') {
    if (stopped || flushing || queue.length === 0) {
      return;
    }

    flushing = true;
    const entries = queue.splice(0, LIVE_CONSTANTS.LIVE_DEBUG_UPLOAD_MAX_BATCH);

    try {
      await windowObject.fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sessionId,
          reason,
          appPath: `${windowObject.location.pathname}${windowObject.location.search}`,
          scope,
          entries
        }),
        keepalive: reason === 'pagehide' || reason === 'beforeunload'
      });
    } catch {
      queue.unshift(...entries);
      trimQueue();
    } finally {
      flushing = false;
      if (!stopped && queue.length > 0) {
        scheduleFlush();
      }
    }
  }

  const unsubscribe = liveDebug.subscribe((payload) => {
    if (stopped || payload?.type !== 'entry' || !payload.entry) {
      return;
    }

    queue.push(normalizeQueuedEntry(payload.entry));
    trimQueue();
    scheduleFlush();
  });

  const heartbeatTimer = windowObject.setInterval(() => {
    void postHeartbeat();
  }, LIVE_CONSTANTS.LAUNCHER_HEARTBEAT_MS);

  const onPageHide = () => {
    void flushNow('pagehide');
  };
  const onBeforeUnload = () => {
    void flushNow('beforeunload');
  };

  windowObject.addEventListener('pagehide', onPageHide);
  windowObject.addEventListener('beforeunload', onBeforeUnload);

  void postHeartbeat();

  function shutdown() {
    if (stopped) {
      return;
    }

    stopped = true;
    unsubscribe?.();
    windowObject.clearInterval(heartbeatTimer);
    cancelIdle(windowObject, flushHandle);
    flushHandle = null;

    windowObject.removeEventListener('pagehide', onPageHide);
    windowObject.removeEventListener('beforeunload', onBeforeUnload);

    void flushNow('shutdown');
    void windowObject.fetch(disconnectUrl, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain'
      },
      body: '1',
      keepalive: true
    }).catch(() => {});
  }

  return {
    enabled: true,
    sessionId,
    flushNow,
    shutdown
  };
}
