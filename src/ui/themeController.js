const THEME_STORAGE_KEY = 'meeting-minutes-theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';

export function readStoredTheme(storage) {
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

export function createThemeController({
  rootElement,
  themeToggleButton,
  storage,
  prefersDarkColorSchemeQuery
} = {}) {
  let activeTheme = THEME_LIGHT;

  function resolveInitialTheme() {
    const storedTheme = readStoredTheme(storage);
    if (storedTheme) {
      return storedTheme;
    }

    return prefersDarkColorSchemeQuery?.matches ? THEME_DARK : THEME_LIGHT;
  }

  function applyTheme(nextTheme, options = {}) {
    const persist = options.persist !== false;
    const theme = nextTheme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
    activeTheme = theme;

    if (rootElement) {
      rootElement.dataset.theme = theme;
      rootElement.style.colorScheme = theme;
    }

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
      persistTheme(storage, theme);
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
      if (readStoredTheme(storage)) {
        return;
      }
      applyTheme(event.matches ? THEME_DARK : THEME_LIGHT, { persist: false });
    });
  }

  return {
    initTheme,
    applyTheme,
    toggleTheme,
    getActiveTheme() {
      return activeTheme;
    }
  };
}
