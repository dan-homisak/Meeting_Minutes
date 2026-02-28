import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppShellContext } from '../src/bootstrap/createAppShellContext.js';

test('createAppShellContext resolves shell elements and initializes app state', () => {
  const selectors = new Map([
    ['#open-folder', { id: 'open-folder' }],
    ['#new-note', { id: 'new-note' }],
    ['#save-now', { id: 'save-now' }],
    ['#mode-raw', { id: 'mode-raw' }],
    ['#mode-live', { id: 'mode-live' }],
    ['#mode-preview', { id: 'mode-preview' }],
    ['#theme-toggle', { id: 'theme-toggle' }],
    ['#status', { id: 'status' }],
    ['#file-count', { id: 'file-count' }],
    ['#file-list', { id: 'file-list' }],
    ['#editor', { id: 'editor' }],
    ['#preview', { id: 'preview' }],
    ['.app-shell', { id: 'app-shell' }]
  ]);
  const requestedSelectors = [];
  const context = createAppShellContext({
    documentObject: {
      querySelector(selector) {
        requestedSelectors.push(selector);
        return selectors.get(selector) ?? null;
      },
      documentElement: { id: 'root' }
    }
  });

  assert.equal(context.openFolderButton.id, 'open-folder');
  assert.equal(context.newNoteButton.id, 'new-note');
  assert.equal(context.saveNowButton.id, 'save-now');
  assert.equal(context.rawModeButton.id, 'mode-raw');
  assert.equal(context.liveModeButton.id, 'mode-live');
  assert.equal(context.previewModeButton.id, 'mode-preview');
  assert.equal(context.themeToggleButton.id, 'theme-toggle');
  assert.equal(context.statusElement.id, 'status');
  assert.equal(context.fileCountElement.id, 'file-count');
  assert.equal(context.fileListElement.id, 'file-list');
  assert.equal(context.editorElement.id, 'editor');
  assert.equal(context.previewElement.id, 'preview');
  assert.equal(context.appShellElement.id, 'app-shell');
  assert.equal(context.rootElement.id, 'root');
  assert.deepEqual(requestedSelectors, [
    '#open-folder',
    '#new-note',
    '#save-now',
    '#mode-raw',
    '#mode-live',
    '#mode-preview',
    '#theme-toggle',
    '#status',
    '#file-count',
    '#file-list',
    '#editor',
    '#preview',
    '.app-shell'
  ]);

  assert.equal(context.app.folderHandle, null);
  assert.equal(context.app.currentPath, null);
  assert.equal(context.app.currentFileHandle, null);
  assert.equal(context.app.lastSavedText, '');
  assert.equal(context.app.hasUnsavedChanges, false);
  assert.equal(context.app.isLoadingFile, false);
  assert.equal(context.app.autosaveTimer, null);
  assert.equal(context.app.viewMode, 'live');
  assert.equal(context.app.fileHandles instanceof Map, true);
  assert.equal(context.app.fileHandles.size, 0);
});
