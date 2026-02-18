import test from 'node:test';
import assert from 'node:assert/strict';
import { createPointerProbeGeometry } from '../src/live/pointerProbeGeometry.js';

test('summarizeRectForLog returns rounded rect values', () => {
  const probe = createPointerProbeGeometry({
    normalizeLogString: (value) => String(value),
    readLineInfoForPosition: () => null,
    windowObject: {
      getComputedStyle() {
        return {};
      }
    },
    elementConstructor: class {}
  });

  const summary = probe.summarizeRectForLog({
    left: 1.2345,
    top: 2.3456,
    right: 8.7654,
    bottom: 9.8765,
    width: 7.5309,
    height: 7.5309
  });

  assert.deepEqual(summary, {
    left: 1.23,
    top: 2.35,
    right: 8.77,
    bottom: 9.88,
    width: 7.53,
    height: 7.53
  });
});

test('readComputedStyleSnapshotForLog reads expected style fields for elements', () => {
  class ElementMock {}
  const windowObject = {
    getComputedStyle() {
      return {
        display: 'block',
        position: 'relative',
        whiteSpace: 'pre-wrap',
        lineHeight: '20px',
        fontSize: '14px',
        marginTop: '1px',
        marginBottom: '2px',
        paddingTop: '3px',
        paddingBottom: '4px',
        overflowY: 'auto'
      };
    }
  };
  const probe = createPointerProbeGeometry({
    normalizeLogString: (value) => String(value),
    readLineInfoForPosition: () => null,
    windowObject,
    elementConstructor: ElementMock
  });

  assert.equal(probe.readComputedStyleSnapshotForLog({}), null);

  const styleSnapshot = probe.readComputedStyleSnapshotForLog(new ElementMock());
  assert.deepEqual(styleSnapshot, {
    display: 'block',
    position: 'relative',
    whiteSpace: 'pre-wrap',
    lineHeight: '20px',
    fontSize: '14px',
    marginTop: '1px',
    marginBottom: '2px',
    paddingTop: '3px',
    paddingBottom: '4px',
    overflowY: 'auto'
  });
});

test('buildCoordSamples maps coordinates to line info and rounds values', () => {
  const probe = createPointerProbeGeometry({
    normalizeLogString: (value) => String(value),
    readLineInfoForPosition(_doc, position) {
      return {
        lineNumber: Number.isFinite(position) ? position + 1 : null,
        column: Number.isFinite(position) ? position % 3 : null
      };
    },
    windowObject: {
      getComputedStyle() {
        return {};
      }
    },
    elementConstructor: class {}
  });

  const view = {
    state: {
      doc: {}
    },
    posAtCoords({ x, y }) {
      return Math.trunc(x + y);
    }
  };

  const samples = probe.buildCoordSamples(view, [
    { label: 'a', x: 1.234, y: 2.345 },
    { label: 'b', x: 4.444, y: 5.555 }
  ]);

  assert.deepEqual(samples, [
    {
      label: 'a',
      x: 1.23,
      y: 2.35,
      position: 3,
      lineNumber: 4,
      column: 0
    },
    {
      label: 'b',
      x: 4.44,
      y: 5.55,
      position: 9,
      lineNumber: 10,
      column: 0
    }
  ]);
});

test('summarizeLineNumbersForCoordSamples keeps unique finite line numbers', () => {
  const probe = createPointerProbeGeometry({
    normalizeLogString: (value) => String(value),
    readLineInfoForPosition: () => null,
    windowObject: {
      getComputedStyle() {
        return {};
      }
    },
    elementConstructor: class {}
  });

  const summary = probe.summarizeLineNumbersForCoordSamples([
    { lineNumber: 2 },
    { lineNumber: 4 },
    { lineNumber: 2 },
    { lineNumber: NaN },
    {},
    { lineNumber: 5 }
  ]);

  assert.deepEqual(summary, [2, 4, 5]);
});
