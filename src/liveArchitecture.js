const LIVE_SOURCE_FIRST_STORAGE_KEY = 'meetingMinutes.liveSourceFirst';

export function parseSourceFirstFlag(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === '') {
    return null;
  }

  if (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'on' ||
    normalized === 'source-first' ||
    normalized === 'sourcefirst'
  ) {
    return true;
  }

  if (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'off' ||
    normalized === 'legacy'
  ) {
    return false;
  }

  return null;
}

export function readStoredSourceFirstFlag(storage) {
  if (!storage) {
    return null;
  }

  try {
    return parseSourceFirstFlag(storage.getItem(LIVE_SOURCE_FIRST_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function resolveLiveSourceFirstMode(search = '', storage = null) {
  const urlParams = new URLSearchParams(search);
  const sourceFirstFromQuery = (
    parseSourceFirstFlag(urlParams.get('liveSourceFirst')) ??
    parseSourceFirstFlag(urlParams.get('liveArchitecture'))
  );
  const sourceFirstFromStorage = readStoredSourceFirstFlag(storage);

  return {
    value: sourceFirstFromQuery ?? sourceFirstFromStorage ?? true,
    sourceFirstFromQuery,
    sourceFirstFromStorage,
    urlParams
  };
}
