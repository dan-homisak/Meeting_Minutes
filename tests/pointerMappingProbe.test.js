import test from 'node:test';
import assert from 'node:assert/strict';
import { createPointerMappingProbe } from '../src/live/pointerMappingProbe.js';

function rect({ left, top, width, height }) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  };
}

test('buildRenderedPointerProbe returns null without required view and coordinates', () => {
  const probe = createPointerMappingProbe();

  assert.equal(probe.buildRenderedPointerProbe(null, null, null, null, null, null), null);
});

test('buildRenderedPointerProbe assembles rendered mapping diagnostics', () => {
  const doc = { id: 'doc' };
  const renderedBlock = {
    id: 'block',
    tagName: 'DIV',
    className: ' rendered block ',
    getBoundingClientRect() {
      return rect({ left: 10, top: 10, width: 80, height: 40 });
    }
  };
  const targetElement = {
    id: 'target',
    tagName: 'P',
    className: ' target ',
    getBoundingClientRect() {
      return rect({ left: 14, top: 12, width: 60, height: 16 });
    }
  };
  const probe = createPointerMappingProbe({
    clampNumber(value, min, max) {
      return Math.min(max, Math.max(min, value));
    },
    readBlockLineBoundsForLog(_doc, bounds) {
      if (!bounds) {
        return null;
      }
      return { from: bounds.from, to: bounds.to };
    },
    buildCoordSamples(_view, samples) {
      return samples.map((sample, index) => ({
        label: sample.label,
        x: Number(sample.x.toFixed(2)),
        y: Number(sample.y.toFixed(2)),
        lineNumber: index + 1
      }));
    },
    readLineInfoForPosition(_doc, position) {
      return { lineNumber: 7, column: Number(position) };
    },
    resolvePointerPosition(_view, element) {
      return element?.id === 'block' ? 111 : element?.id === 'target' ? 112 : null;
    },
    summarizeRectForLog(rawRect) {
      if (!rawRect) {
        return null;
      }
      return {
        left: Number(rawRect.left.toFixed(2)),
        top: Number(rawRect.top.toFixed(2)),
        width: Number(rawRect.width.toFixed(2)),
        height: Number(rawRect.height.toFixed(2))
      };
    },
    readComputedStyleSnapshotForLog(element) {
      return element ? { display: 'block' } : null;
    },
    normalizeLogString(value, maxLength = 120) {
      return String(value ?? '').trim().slice(0, maxLength);
    }
  });
  const view = { state: { doc } };

  const result = probe.buildRenderedPointerProbe(
    view,
    renderedBlock,
    targetElement,
    { x: 30, y: 30 },
    { from: 5, to: 10 },
    9,
    { from: 5, to: 6 },
    { from: 9, to: 10 }
  );

  assert.equal(result.pointer.x, 30);
  assert.equal(result.pointer.y, 30);
  assert.equal(result.pointer.pointerOffsetX, 20);
  assert.equal(result.pointer.pointerOffsetY, 20);
  assert.equal(result.pointer.pointerRatioY, 0.5);
  assert.equal(result.pointer.pointerDistanceToBlockBottom, 20);
  assert.deepEqual(result.blockLineBounds, { from: 5, to: 10 });
  assert.deepEqual(result.sourceFromBlockLineBounds, { from: 5, to: 6 });
  assert.deepEqual(result.sourcePosBlockLineBounds, { from: 9, to: 10 });
  assert.deepEqual(result.sourceLineInfo, { lineNumber: 7, column: 9 });
  assert.equal(result.domBlockPos, 111);
  assert.equal(result.domTargetPos, 112);
  assert.equal(result.renderedBlockStyle.display, 'block');
  assert.equal(result.targetStyle.display, 'block');
  assert.equal(result.targetTagName, 'P');
  assert.equal(result.targetClassName, 'target');
  assert.equal(result.coordSamples.length, 4);
  assert.equal(result.verticalScanCoordSamples.length, 9);
  assert.equal(result.edgeCoordSamples.length, 4);
});

test('buildLineFallbackPointerProbe handles missing coordinates', () => {
  const doc = { id: 'doc' };
  const lineElement = {
    tagName: 'DIV',
    textContent: '  line text  ',
    getBoundingClientRect() {
      return rect({ left: 0, top: 100, width: 80, height: 20 });
    }
  };
  const targetElement = {
    tagName: 'SPAN',
    getBoundingClientRect() {
      return rect({ left: 3, top: 102, width: 20, height: 12 });
    }
  };
  const probe = createPointerMappingProbe({
    readBlockLineBoundsForLog(_doc, bounds) {
      return bounds ? { from: bounds.from, to: bounds.to } : null;
    },
    buildCoordSamples(_view, samples) {
      return samples.map((sample) => ({ label: sample.label, y: Number(sample.y.toFixed(2)) }));
    },
    readLineInfoForPosition(_doc, position) {
      return { lineNumber: 3, column: position };
    },
    summarizeRectForLog(rawRect) {
      return rawRect ? { top: rawRect.top, height: rawRect.height } : null;
    },
    normalizeLogString(value) {
      return String(value).trim();
    }
  });
  const view = { state: { doc } };

  const result = probe.buildLineFallbackPointerProbe(
    view,
    lineElement,
    targetElement,
    null,
    { from: 1, to: 4 },
    2
  );

  assert.equal(result.pointer, null);
  assert.equal(result.lineTagName, 'DIV');
  assert.equal(result.targetTagName, 'SPAN');
  assert.equal(result.lineTextPreview, 'line text');
  assert.deepEqual(result.sourceLineInfo, { lineNumber: 3, column: 2 });
  assert.deepEqual(result.blockLineBounds, { from: 1, to: 4 });
  assert.deepEqual(result.coordSamples, [
    { label: 'line-left', y: 110 },
    { label: 'line-center', y: 110 },
    { label: 'line-right', y: 110 }
  ]);
});
