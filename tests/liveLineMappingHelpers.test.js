import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveLineMappingHelpers } from '../src/live/liveLineMappingHelpers.js';

function createDocStub() {
  const lines = [
    { number: 1, from: 0, to: 4, text: 'alpha' },
    { number: 2, from: 5, to: 9, text: 'bravo' },
    { number: 3, from: 10, to: 14, text: 'charlie' }
  ];
  return {
    length: 14,
    lineAt(position) {
      const clamped = Math.max(0, Math.min(14, position));
      return lines.find((line) => clamped >= line.from && clamped <= line.to) ?? lines.at(-1);
    },
    sliceString(from, to) {
      const line = lines.find((entry) => from === entry.from && to === entry.to);
      return line?.text ?? '';
    }
  };
}

test('clampNumber returns null for non-finite and clamps range', () => {
  const helpers = createLiveLineMappingHelpers();

  assert.equal(helpers.clampNumber(Number.NaN, 0, 1), null);
  assert.equal(helpers.clampNumber(-5, 0, 10), 0);
  assert.equal(helpers.clampNumber(15, 0, 10), 10);
  assert.equal(helpers.clampNumber(6, 0, 10), 6);
});

test('readLineInfoForPosition returns clamped line metadata and text preview', () => {
  const helpers = createLiveLineMappingHelpers({
    normalizeLogString: (value, maxLength = 120) => String(value).slice(0, maxLength)
  });
  const doc = createDocStub();

  const info = helpers.readLineInfoForPosition(doc, 8);
  assert.deepEqual(info, {
    position: 8,
    lineNumber: 2,
    lineFrom: 5,
    lineTo: 9,
    lineLength: 4,
    column: 3,
    lineTextPreview: 'bravo'
  });

  const clamped = helpers.readLineInfoForPosition(doc, 99);
  assert.equal(clamped.position, 14);
  assert.equal(clamped.lineNumber, 3);
});

test('readBlockLineBoundsForLog handles invalid and valid ranges', () => {
  const helpers = createLiveLineMappingHelpers();
  const doc = createDocStub();

  assert.equal(helpers.readBlockLineBoundsForLog(doc, null), null);
  assert.equal(helpers.readBlockLineBoundsForLog(doc, { from: 4, to: 4 }), null);

  const bounds = helpers.readBlockLineBoundsForLog(doc, { from: 2, to: 13 });
  assert.deepEqual(bounds, {
    startLineNumber: 1,
    startLineFrom: 0,
    endLineNumber: 3,
    endLineTo: 14,
    lineCount: 3
  });
});
