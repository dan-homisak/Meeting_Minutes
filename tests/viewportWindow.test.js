import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { buildViewportWindow } from '../src/core/viewport/ViewportWindow.js';

test('buildViewportWindow expands visible ranges with line buffer', () => {
  const state = EditorState.create({
    doc: '1\n2\n3\n4\n5\n6\n7\n8\n9'
  });
  const doc = state.doc;
  const line5 = doc.line(5);
  const line6 = doc.line(6);
  const viewportWindow = buildViewportWindow({
    doc,
    visibleRanges: [{ from: line5.from, to: line6.to }],
    lineBuffer: 1,
    minimumLineSpan: 1
  });

  assert.equal(viewportWindow.lineFrom, 4);
  assert.equal(viewportWindow.lineTo, 7);
  assert.equal(viewportWindow.sourceFrom, doc.line(4).from);
  assert.equal(viewportWindow.sourceTo, doc.line(7).to);
  assert.equal(viewportWindow.rangeCount, 1);
});

test('buildViewportWindow includes the active line even when outside visible ranges', () => {
  const state = EditorState.create({
    doc: '1\n2\n3\n4\n5\n6\n7\n8\n9'
  });
  const doc = state.doc;
  const line2 = doc.line(2);
  const line8 = doc.line(8);
  const viewportWindow = buildViewportWindow({
    doc,
    visibleRanges: [{ from: line2.from, to: line2.to }],
    activeLineNumber: 8,
    lineBuffer: 1,
    minimumLineSpan: 1
  });

  assert.equal(viewportWindow.lineTo, 9);
  assert.equal(viewportWindow.sourceFrom <= line8.from, true);
  assert.equal(viewportWindow.sourceTo >= line8.to, true);
});

test('buildViewportWindow falls back to the full document when no viewport data exists', () => {
  const state = EditorState.create({
    doc: 'alpha\nbeta\ngamma'
  });
  const doc = state.doc;
  const viewportWindow = buildViewportWindow({
    doc
  });

  assert.equal(viewportWindow.lineFrom, 1);
  assert.equal(viewportWindow.lineTo, doc.lines);
  assert.equal(viewportWindow.sourceFrom, 0);
  assert.equal(viewportWindow.sourceTo, doc.length);
});
