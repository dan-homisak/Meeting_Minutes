import {
  attachLiveDebugToWindow as attachLiveDebugToWindowFactory,
  createLiveDebugLogger as createLiveDebugLoggerFactory,
  persistLiveDebugLevel as persistLiveDebugLevelFactory,
  readStoredLiveDebugLevel as readStoredLiveDebugLevelFactory,
  resolveLiveDebugLevel as resolveLiveDebugLevelFactory
} from '../liveDebugLogger.js';

export function createLiveDebugBootstrap({
  windowObject = window,
  isDevBuild = false,
  sourceFirstMode = true,
  sourceFirstFromQuery = null,
  sourceFirstFromStorage = null,
  markdownEngineOptions = null,
  scope = 'live-preview',
  factories = {}
} = {}) {
  const resolveLiveDebugLevel =
    factories.resolveLiveDebugLevel ?? resolveLiveDebugLevelFactory;
  const readStoredLiveDebugLevel =
    factories.readStoredLiveDebugLevel ?? readStoredLiveDebugLevelFactory;
  const createLiveDebugLogger =
    factories.createLiveDebugLogger ?? createLiveDebugLoggerFactory;
  const persistLiveDebugLevel =
    factories.persistLiveDebugLevel ?? persistLiveDebugLevelFactory;
  const attachLiveDebugToWindow =
    factories.attachLiveDebugToWindow ?? attachLiveDebugToWindowFactory;

  const configuredLiveDebugLevel = resolveLiveDebugLevel({
    search: windowObject.location.search,
    storedValue: readStoredLiveDebugLevel(windowObject.localStorage)
  });
  const initialLiveDebugLevel =
    configuredLiveDebugLevel === 'off' && isDevBuild ? 'trace' : configuredLiveDebugLevel;
  const liveDebug = createLiveDebugLogger({
    scope,
    level: initialLiveDebugLevel
  });

  function setLiveDebugLevel(level) {
    const nextLevel = liveDebug.setLevel(level);
    persistLiveDebugLevel(windowObject.localStorage, nextLevel);
    return nextLevel;
  }

  setLiveDebugLevel(liveDebug.getLevel());
  attachLiveDebugToWindow(windowObject, liveDebug, setLiveDebugLevel);
  if (markdownEngineOptions) {
    liveDebug.info('markdown.engine.config', markdownEngineOptions);
  }
  liveDebug.info('live.mode.architecture', {
    sourceFirst: sourceFirstMode,
    queryOverride: sourceFirstFromQuery,
    storedOverride: sourceFirstFromStorage
  });

  return {
    liveDebug,
    setLiveDebugLevel,
    configuredLiveDebugLevel,
    initialLiveDebugLevel
  };
}
