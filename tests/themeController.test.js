import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_DARK,
  THEME_LIGHT,
  THEME_STORAGE_KEY,
  createThemeController,
  readStoredTheme
} from '../src/ui/themeController.js';

function createStorageMock(initialValue = null) {
  let currentValue = initialValue;
  const writes = [];
  return {
    writes,
    getItem(key) {
      if (key !== THEME_STORAGE_KEY) {
        return null;
      }
      return currentValue;
    },
    setItem(key, value) {
      writes.push({ key, value });
      if (key === THEME_STORAGE_KEY) {
        currentValue = value;
      }
    }
  };
}

function createButtonMock() {
  const attributes = new Map();
  const listeners = new Map();
  return {
    textContent: '',
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    click() {
      const handler = listeners.get('click');
      if (typeof handler === 'function') {
        handler();
      }
    }
  };
}

test('readStoredTheme accepts only valid persisted values', () => {
  assert.equal(readStoredTheme(createStorageMock(THEME_DARK)), THEME_DARK);
  assert.equal(readStoredTheme(createStorageMock(THEME_LIGHT)), THEME_LIGHT);
  assert.equal(readStoredTheme(createStorageMock('system')), null);
  assert.equal(readStoredTheme(null), null);
});

test('theme controller initializes from stored value and toggles with persistence', () => {
  const storage = createStorageMock(THEME_DARK);
  const button = createButtonMock();
  const rootElement = {
    dataset: {},
    style: {}
  };

  const controller = createThemeController({
    rootElement,
    themeToggleButton: button,
    storage,
    prefersDarkColorSchemeQuery: {
      matches: false,
      addEventListener() {}
    }
  });

  controller.initTheme();
  assert.equal(controller.getActiveTheme(), THEME_DARK);
  assert.equal(rootElement.dataset.theme, THEME_DARK);
  assert.equal(rootElement.style.colorScheme, THEME_DARK);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.textContent, 'Light mode');

  button.click();
  assert.equal(controller.getActiveTheme(), THEME_LIGHT);
  assert.equal(rootElement.dataset.theme, THEME_LIGHT);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.textContent, 'Dark mode');
  assert.deepEqual(storage.writes.at(-1), {
    key: THEME_STORAGE_KEY,
    value: THEME_LIGHT
  });
});

test('theme controller follows system preference changes when no stored override exists', () => {
  const storage = createStorageMock(null);
  const button = createButtonMock();
  const rootElement = {
    dataset: {},
    style: {}
  };
  const listeners = new Map();

  const controller = createThemeController({
    rootElement,
    themeToggleButton: button,
    storage,
    prefersDarkColorSchemeQuery: {
      matches: false,
      addEventListener(event, handler) {
        listeners.set(event, handler);
      }
    }
  });

  controller.initTheme();
  assert.equal(controller.getActiveTheme(), THEME_LIGHT);

  const changeHandler = listeners.get('change');
  assert.equal(typeof changeHandler, 'function');
  changeHandler({ matches: true });
  assert.equal(controller.getActiveTheme(), THEME_DARK);
  assert.equal(rootElement.dataset.theme, THEME_DARK);
  assert.equal(storage.writes.length, 0);
});
