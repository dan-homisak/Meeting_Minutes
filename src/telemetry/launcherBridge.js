function createLiveDebugSessionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `live-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createLauncherBridge({
  launcherToken = '',
  liveDebug = null,
  windowObject = window,
  navigatorObject = navigator,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  heartbeatMs = 4000,
  uploadDebounceMs = 900,
  uploadMaxBatch = 200,
  uploadMaxQueue = 4000,
  getCurrentPath = () => null,
  getViewMode = () => 'raw',
  getAppPath = () => windowObject.location?.pathname ?? ''
} = {}) {
  const state = {
    enabled: Boolean(launcherToken),
    sessionId: createLiveDebugSessionId(),
    queue: [],
    flushTimer: null,
    inflight: false,
    heartbeatTimer: null
  };

  function buildLauncherEndpoint(pathname) {
    return `${pathname}?token=${encodeURIComponent(launcherToken)}`;
  }

  function getQueuedEntryCount() {
    return state.queue.length;
  }

  function scheduleLiveDebugUpload() {
    if (!state.enabled || state.flushTimer) {
      return;
    }

    state.flushTimer = windowObject.setTimeout(() => {
      state.flushTimer = null;
      void flushLiveDebugUploads('timer');
    }, uploadDebounceMs);
  }

  function buildLiveDebugPayload(batch, reason) {
    return {
      sessionId: state.sessionId,
      reason,
      appPath: getAppPath(),
      entries: batch
    };
  }

  function enqueueLiveDebugEntry(entry) {
    if (!state.enabled) {
      return;
    }

    state.queue.push({
      sessionCapturedAt: new Date().toISOString(),
      currentPath: getCurrentPath(),
      viewMode: getViewMode(),
      entry
    });

    if (state.queue.length > uploadMaxQueue) {
      state.queue.splice(0, state.queue.length - uploadMaxQueue);
    }

    if (state.queue.length >= uploadMaxBatch) {
      void flushLiveDebugUploads('batch-threshold');
      return;
    }

    scheduleLiveDebugUpload();
  }

  async function flushLiveDebugUploads(reason = 'manual') {
    if (!state.enabled || state.inflight || typeof fetchImpl !== 'function') {
      return;
    }

    if (state.flushTimer) {
      windowObject.clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }

    if (state.queue.length === 0) {
      return;
    }

    state.inflight = true;

    try {
      while (state.queue.length > 0) {
        const batch = state.queue.splice(0, uploadMaxBatch);
        try {
          const response = await fetchImpl(buildLauncherEndpoint('/__launcher/live-debug'), {
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
          state.queue.unshift(...batch);
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
      state.inflight = false;
    }
  }

  function flushLiveDebugUploadsWithBeacon(reason = 'beforeunload') {
    if (!state.enabled || state.queue.length === 0 || !navigatorObject.sendBeacon) {
      return;
    }

    if (state.flushTimer) {
      windowObject.clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }

    const batch = state.queue.splice(0, state.queue.length);
    const payload = JSON.stringify(buildLiveDebugPayload(batch, reason));
    const blob = new Blob([payload], {
      type: 'application/json'
    });

    const accepted = navigatorObject.sendBeacon(buildLauncherEndpoint('/__launcher/live-debug'), blob);
    if (!accepted) {
      state.queue.unshift(...batch);
    }
  }

  function notifyLauncher(pathname) {
    if (!state.enabled || typeof fetchImpl !== 'function') {
      return;
    }

    const url = buildLauncherEndpoint(pathname);
    void fetchImpl(url, {
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
    if (!state.enabled) {
      return;
    }

    notifyLauncher('/__launcher/heartbeat');

    state.heartbeatTimer = windowObject.setInterval(() => {
      notifyLauncher('/__launcher/heartbeat');
      void flushLiveDebugUploads('heartbeat');
    }, heartbeatMs);

    windowObject.addEventListener('visibilitychange', () => {
      if (windowObject.document?.visibilityState === 'hidden') {
        flushLiveDebugUploadsWithBeacon('visibility-hidden');
        return;
      }

      if (windowObject.document?.visibilityState === 'visible') {
        notifyLauncher('/__launcher/heartbeat');
        void flushLiveDebugUploads('visibility-visible');
      }
    });

    windowObject.addEventListener('beforeunload', () => {
      flushLiveDebugUploadsWithBeacon('beforeunload');

      if (state.heartbeatTimer) {
        windowObject.clearInterval(state.heartbeatTimer);
        state.heartbeatTimer = null;
      }

      if (navigatorObject.sendBeacon) {
        navigatorObject.sendBeacon(
          buildLauncherEndpoint('/__launcher/disconnect'),
          'closing'
        );
        return;
      }

      notifyLauncher('/__launcher/disconnect');
    });
  }

  function connectLiveDebugLogger() {
    if (!liveDebug || typeof liveDebug.subscribe !== 'function') {
      return;
    }

    liveDebug.subscribe((event) => {
      if (!event || event.type !== 'entry') {
        return;
      }

      enqueueLiveDebugEntry(event.entry);
    });
  }

  function initializeLiveDebugCapture() {
    if (!state.enabled) {
      return;
    }

    enqueueLiveDebugEntry({
      at: new Date().toISOString(),
      scope: 'launcher',
      level: 'info',
      event: 'live-debug.capture.enabled',
      data: {
        sessionId: state.sessionId
      }
    });
    void flushLiveDebugUploads('startup');
  }

  return {
    isEnabled() {
      return state.enabled;
    },
    getSessionId() {
      return state.sessionId;
    },
    getQueuedEntryCount,
    enqueueLiveDebugEntry,
    flushLiveDebugUploads,
    flushLiveDebugUploadsWithBeacon,
    notifyLauncher,
    startLauncherHeartbeat,
    connectLiveDebugLogger,
    initializeLiveDebugCapture
  };
}
