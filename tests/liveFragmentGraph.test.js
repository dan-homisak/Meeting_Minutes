import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { buildLiveFragmentGraph } from '../src/core/render/LiveFragmentGraph.js';

test('buildLiveFragmentGraph emits line fragments for inactive lines and preserves inline/marker maps', () => {
  const state = EditorState.create({
    doc: '## Heading\nParagraph with [link](https://example.com)\n- [ ] task item\n'
  });
  const doc = state.doc;
  const blocks = [
    { id: 'heading', type: 'heading', from: doc.line(1).from, to: doc.line(1).to },
    { id: 'paragraph', type: 'paragraph', from: doc.line(2).from, to: doc.line(2).to },
    { id: 'task', type: 'task', from: doc.line(3).from, to: doc.line(3).to }
  ];
  const activeLineRange = {
    from: doc.line(2).from,
    to: doc.line(2).to
  };

  const graph = buildLiveFragmentGraph({
    doc,
    blocks,
    activeLineRange,
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    }
  });

  assert.equal(graph.renderedFragments.length, 2);
  assert.equal(
    graph.renderedFragments.some((fragment) => fragment.sourceFrom === doc.line(1).from),
    true
  );
  assert.equal(
    graph.renderedFragments.some((fragment) => fragment.sourceFrom === doc.line(3).from),
    true
  );
  assert.equal(
    graph.renderedFragments.some((fragment) => fragment.sourceFrom === doc.line(2).from),
    false
  );
  assert.equal(
    graph.inlineFragments.some((fragment) => fragment.kind === 'inline-fragment'),
    true
  );
  assert.equal(
    graph.markerFragments.some((fragment) => fragment.kind === 'marker'),
    true
  );
});

test('buildLiveFragmentGraph treats table/code/frontmatter blocks as widget fragments when inactive', () => {
  const state = EditorState.create({
    doc: '| A | B |\n| --- | --- |\n| 1 | 2 |\n'
  });
  const doc = state.doc;
  const tableBlock = {
    id: 'table-block',
    type: 'table',
    from: doc.line(1).from,
    to: doc.line(3).to
  };

  const inactiveGraph = buildLiveFragmentGraph({
    doc,
    blocks: [tableBlock],
    activeLineRange: null,
    renderMarkdownHtml(source) {
      return `<table><tbody><tr><td>${source.length}</td></tr></tbody></table>`;
    }
  });
  assert.equal(inactiveGraph.renderedFragments.length, 1);
  assert.equal(inactiveGraph.renderedFragments[0].sourceFrom, tableBlock.from);
  assert.equal(inactiveGraph.renderedFragments[0].sourceTo, tableBlock.to);

  const activeGraph = buildLiveFragmentGraph({
    doc,
    blocks: [tableBlock],
    activeLineRange: {
      from: doc.line(2).from,
      to: doc.line(2).to
    },
    renderMarkdownHtml(source) {
      return `<table><tbody><tr><td>${source.length}</td></tr></tbody></table>`;
    }
  });
  assert.equal(activeGraph.renderedFragments.length, 0);
});
