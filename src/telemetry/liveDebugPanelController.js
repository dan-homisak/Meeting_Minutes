export function formatLiveDebugEntry(entry) {
  const data = Object.keys(entry?.data ?? {}).length > 0 ? ` ${JSON.stringify(entry.data)}` : '';
  return `${entry?.at ?? ''} ${String(entry?.level ?? '').toUpperCase()} ${entry?.event ?? ''}${data}`;
}

export function createLiveDebugPanelController({
  appShellElement = null,
  statusElement = null,
  liveDebug = null,
  isDevBuild = false,
  setLiveDebugLevel = null,
  setStatus = null,
  captureLiveDebugSnapshot = null,
  navigatorObject = navigator,
  documentObject = document
} = {}) {
  let liveDebugPanelElements = null;

  function getLevel() {
    return typeof liveDebug?.getLevel === 'function' ? liveDebug.getLevel() : 'off';
  }

  function getEntries() {
    return typeof liveDebug?.getEntries === 'function' ? liveDebug.getEntries() : [];
  }

  function renderLiveDebugPanel() {
    if (!liveDebugPanelElements) {
      return;
    }

    const level = getLevel();
    const entries = getEntries().slice(-80);
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
    const entries = getEntries();
    const payload = JSON.stringify(entries, null, 2);

    try {
      await navigatorObject?.clipboard?.writeText(payload);
      if (typeof setStatus === 'function') {
        setStatus(`Copied ${entries.length} live debug entries.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (typeof setStatus === 'function') {
        setStatus(`Could not copy live debug entries: ${message}`, true);
      }
    }
  }

  function mountLiveDebugPanel() {
    if (!appShellElement || !statusElement || typeof documentObject?.createElement !== 'function') {
      return;
    }

    const panel = documentObject.createElement('details');
    panel.id = 'live-debug-panel';

    const summary = documentObject.createElement('summary');
    summary.className = 'live-debug-summary';

    const title = documentObject.createElement('strong');
    title.textContent = 'Live Debug';

    const badge = documentObject.createElement('span');
    badge.className = 'live-debug-level-badge';
    badge.textContent = getLevel().toUpperCase();

    summary.append(title, badge);

    const controls = documentObject.createElement('div');
    controls.className = 'live-debug-controls';

    const levelLabel = documentObject.createElement('label');
    levelLabel.setAttribute('for', 'live-debug-level');
    levelLabel.textContent = 'Level';

    const levelSelect = documentObject.createElement('select');
    levelSelect.id = 'live-debug-level';
    levelSelect.className = 'live-debug-level-select';
    for (const level of ['off', 'error', 'warn', 'info', 'trace']) {
      const option = documentObject.createElement('option');
      option.value = level;
      option.textContent = level.toUpperCase();
      levelSelect.append(option);
    }
    levelSelect.value = getLevel();
    levelSelect.addEventListener('change', () => {
      if (typeof setLiveDebugLevel === 'function') {
        setLiveDebugLevel(levelSelect.value);
      } else if (typeof liveDebug?.setLevel === 'function') {
        liveDebug.setLevel(levelSelect.value);
      }
      renderLiveDebugPanel();
      if (typeof setStatus === 'function') {
        setStatus(`Live debug level set to ${getLevel()}.`);
      }
    });

    const clearButton = documentObject.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = 'Clear';
    clearButton.addEventListener('click', () => {
      if (typeof liveDebug?.clearEntries === 'function') {
        liveDebug.clearEntries();
      }
      renderLiveDebugPanel();
    });

    const copyButton = documentObject.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy JSON';
    copyButton.addEventListener('click', () => {
      void copyLiveDebugEntries();
    });

    const snapshotButton = documentObject.createElement('button');
    snapshotButton.type = 'button';
    snapshotButton.textContent = 'Snapshot';
    snapshotButton.addEventListener('click', () => {
      if (typeof captureLiveDebugSnapshot === 'function') {
        captureLiveDebugSnapshot('manual-panel');
      }
      if (typeof setStatus === 'function') {
        setStatus('Captured live debug snapshot.');
      }
    });

    controls.append(levelLabel, levelSelect, clearButton, copyButton, snapshotButton);

    const log = documentObject.createElement('pre');
    log.className = 'live-debug-log';

    panel.append(summary, controls, log);
    statusElement.insertAdjacentElement('afterend', panel);

    liveDebugPanelElements = {
      root: panel,
      levelSelect,
      levelBadge: badge,
      log
    };

    if (typeof liveDebug?.subscribe === 'function') {
      liveDebug.subscribe(renderLiveDebugPanel);
    }
    renderLiveDebugPanel();
  }

  return {
    mountLiveDebugPanel,
    renderLiveDebugPanel
  };
}
