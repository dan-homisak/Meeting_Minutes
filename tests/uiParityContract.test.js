import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function resolvePath(relativePath) {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}

test('index shell keeps Obsidian-like sidebar and note-pane hierarchy contract', async () => {
  const html = await readFile(resolvePath('index.html'), 'utf8');

  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="vault-sidebar"/);
  assert.match(html, /class="workspace-main"/);
  assert.match(html, /class="note-toolbar"/);
  assert.match(html, /class="note-pane"/);
  assert.match(html, /id="mode-live"[^>]*>Live Preview</);
});

test('style tokens expose dark and light semantic theme variables', async () => {
  const css = await readFile(resolvePath('src/style.css'), 'utf8');

  assert.match(css, /:root\s*\{[\s\S]*--bg:/);
  assert.match(css, /:root\[data-theme='light'\]\s*\{[\s\S]*--bg:/);
  assert.match(css, /--accent:/);
  assert.match(css, /--selection:/);
  assert.match(css, /--cursor:/);
  assert.match(css, /\.cm-rendered-block\b/);
  assert.match(css, /#editor\.live-mode \.cm-scroller/);
});
