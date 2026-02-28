import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  buildSourceFirstDecorationPlan,
  classifyLiveSourceLine,
  computeFenceStateByLine
} from '../src/core/render/LiveSourceRenderer.js';

function docFrom(text) {
  return EditorState.create({ doc: text }).doc;
}

test('computeFenceStateByLine marks fenced marker and content lines', () => {
  const doc = docFrom('Intro\n```js\nconst n = 1;\n```\nAfter\n');
  const states = computeFenceStateByLine(doc);
  assert.equal(states.length, 6);

  assert.equal(states[0].insideFence, false);
  assert.equal(states[1].insideFence, true);
  assert.equal(states[1].markerLine, true);
  assert.equal(states[1].openingFenceLineNumber, 2);
  assert.equal(states[2].insideFence, true);
  assert.equal(states[2].markerLine, false);
  assert.equal(states[3].insideFence, true);
  assert.equal(states[3].markerLine, true);
  assert.equal(states[3].closingFenceLineNumber, 4);
  assert.equal(states[4].insideFence, false);
  assert.equal(states[5].insideFence, false);
});

test('classifyLiveSourceLine styles heading and de-emphasizes markers off active line', () => {
  const inactive = classifyLiveSourceLine({
    lineText: '## Heading',
    activeLine: false,
    fenceState: null
  });
  assert.ok(inactive.lineClasses.includes('cm-live-heading-line'));
  assert.ok(inactive.lineClasses.includes('cm-live-heading-2'));
  assert.equal(inactive.tokenSpans.length, 1);
  assert.equal(inactive.tokenSpans[0].fromOffset, 0);
  assert.equal(inactive.tokenSpans[0].toOffset, 2);

  const active = classifyLiveSourceLine({
    lineText: '## Heading',
    activeLine: true,
    fenceState: null
  });
  assert.equal(active.tokenSpans.length, 0);
});

test('classifyLiveSourceLine classifies list task markers and paragraph lines', () => {
  const taskLine = classifyLiveSourceLine({
    lineText: '- [x] done',
    activeLine: false,
    fenceState: null
  });
  assert.ok(taskLine.lineClasses.includes('cm-live-list-line'));
  assert.ok(taskLine.lineClasses.includes('cm-live-task-line'));
  assert.ok(taskLine.lineClasses.includes('cm-live-task-checked'));
  assert.ok(taskLine.tokenSpans.length >= 2);

  const paragraphLine = classifyLiveSourceLine({
    lineText: 'Plain paragraph text',
    activeLine: false,
    fenceState: null
  });
  assert.ok(paragraphLine.lineClasses.includes('cm-live-paragraph-line'));

  const hrLine = classifyLiveSourceLine({
    lineText: '---',
    activeLine: false,
    fenceState: null
  });
  assert.ok(hrLine.lineClasses.includes('cm-live-hr-line'));
});

test('classifyLiveSourceLine adds inline markdown token styles in non-active lines', () => {
  const inline = classifyLiveSourceLine({
    lineText: 'This has `code`, **strong**, _em_, and [link](https://example.com).',
    activeLine: false,
    fenceState: null
  });

  const classes = inline.tokenSpans.map((span) => span.className).join(' ');
  assert.match(classes, /cm-live-inline-code/);
  assert.match(classes, /cm-live-strong-text/);
  assert.match(classes, /cm-live-em-text/);
  assert.match(classes, /cm-live-link-text/);
  assert.match(classes, /cm-live-link-url/);
  assert.match(classes, /cm-live-md-token/);
});

test('buildSourceFirstDecorationPlan builds line and token decoration ranges', () => {
  const doc = docFrom(
    '## Heading\n\n- Item one\n> Quote\n```js\nconst n = 1;\n```\n'
  );
  const plan = buildSourceFirstDecorationPlan(doc, 3);

  assert.ok(plan.stats.lineDecorationCount >= 5);
  assert.ok(plan.stats.tokenDecorationCount >= 3);
  assert.equal(plan.stats.fenceLineCount, 3);
  assert.equal(plan.stats.fenceMarkerLineCount, 2);
  assert.ok(plan.lineDecorations.some((entry) => entry.className.includes('cm-live-heading-line')));
  assert.ok(plan.lineDecorations.some((entry) => entry.className.includes('cm-live-fence-marker-line')));
  assert.ok(plan.tokenDecorations.every((entry) => entry.to > entry.from));
  assert.ok(plan.stats.headingLineCount >= 1);
  assert.ok(plan.stats.listLineCount >= 1);
  assert.ok(plan.stats.quoteLineCount >= 1);
});
