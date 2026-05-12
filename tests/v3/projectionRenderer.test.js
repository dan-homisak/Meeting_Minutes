import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { createLiveRenderer } from "../../src/live-v4/LiveRenderer.js";
import { buildLiveProjection } from "../../src/live-v4/LiveProjection.js";

function createModel(text, blocks, inlines = []) {
  return {
    version: 1,
    text,
    blocks,
    inlines,
    meta: {
      dialect: "obsidian-core",
      parser: "full",
      reparsedFrom: null,
      reparsedTo: null,
    },
  };
}

function collectSyntaxHiddenRanges(projection, from, to) {
  const ranges = [];
  projection.decorations.between(from, to, (rangeFrom, rangeTo, value) => {
    const className =
      value?.spec?.class ?? value?.spec?.attributes?.class ?? "";
    if (String(className).includes("mm-live-v4-syntax-hidden")) {
      ranges.push([Number(rangeFrom), Number(rangeTo)]);
    }
  });
  return ranges;
}

function collectRangesByClass(projection, from, to, classPattern) {
  const ranges = [];
  projection.decorations.between(from, to, (rangeFrom, rangeTo, value) => {
    const className =
      value?.spec?.class ?? value?.spec?.attributes?.class ?? "";
    if (String(className).includes(classPattern)) {
      ranges.push([Number(rangeFrom), Number(rangeTo)]);
    }
  });
  return ranges;
}

function collectLineRangesByClass(projection, from, to, classPattern) {
  const ranges = [];
  projection.decorations.between(from, to, (rangeFrom, rangeTo, value) => {
    const className = value?.spec?.attributes?.class ?? "";
    if (value?.spec?.attributes && String(className).includes(classPattern)) {
      ranges.push([Number(rangeFrom), Number(rangeTo)]);
    }
  });
  return ranges;
}

function collectLineAttributesByClass(projection, from, to, classPattern) {
  const attributes = [];
  projection.decorations.between(from, to, (rangeFrom, rangeTo, value) => {
    const lineAttributes = value?.spec?.attributes ?? null;
    const className = lineAttributes?.class ?? "";
    if (lineAttributes && String(className).includes(classPattern)) {
      attributes.push({
        from: Number(rangeFrom),
        to: Number(rangeTo),
        attributes: lineAttributes,
      });
    }
  });
  return attributes;
}

function collectReplacementsByWidgetName(projection, from, to, namePattern) {
  const ranges = [];
  projection.decorations.between(from, to, (rangeFrom, rangeTo, value) => {
    const widget = value?.spec?.widget ?? null;
    const widgetName = widget?.constructor?.name ?? "";
    if (String(widgetName).includes(namePattern)) {
      ranges.push([Number(rangeFrom), Number(rangeTo)]);
    }
  });
  return ranges;
}

test("buildLiveProjection uses source transforms for single-line paragraph blocks", () => {
  const text = "# A\n\nB\n\nC\n";
  const state = EditorState.create({
    doc: text,
    selection: { anchor: 1 },
  });
  const model = createModel(text, [
    {
      id: "b1",
      type: "heading",
      from: 0,
      to: 3,
      lineFrom: 1,
      lineTo: 1,
      depth: 1,
      attrs: { level: 1 },
    },
    {
      id: "b2",
      type: "paragraph",
      from: 5,
      to: 6,
      lineFrom: 3,
      lineTo: 3,
      depth: null,
      attrs: {},
    },
    {
      id: "b3",
      type: "paragraph",
      from: 8,
      to: 9,
      lineFrom: 5,
      lineTo: 5,
      depth: null,
      attrs: {},
    },
  ]);

  const projection = buildLiveProjection({
    state,
    model,
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  assert.equal(projection.activeBlockId, "b1");
  assert.equal(projection.renderedBlocks.length, 0);
  assert.deepEqual(
    projection.sourceTransforms.map((entry) => entry.type),
    ["heading", "paragraph", "paragraph"],
  );
});

test("createLiveRenderer enforces render budget for large docs", () => {
  const lines = Array.from(
    { length: 3000 },
    (_, index) => `line ${index + 1}`,
  ).join("\n");
  const state = EditorState.create({
    doc: lines,
    selection: { anchor: 0 },
  });
  const blocks = Array.from({ length: state.doc.lines }, (_, index) => {
    const line = state.doc.line(index + 1);
    return {
      id: `b-${index + 1}`,
      type: "paragraph",
      from: line.from,
      to: line.to,
      lineFrom: line.number,
      lineTo: line.number,
      depth: null,
      attrs: {},
    };
  });

  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
    renderBudgetMaxBlocks: 120,
    virtualizationBufferBefore: 24,
    virtualizationBufferAfter: 24,
  });

  const projection = renderer.buildRenderProjection(
    state,
    createModel(lines, blocks),
  );
  assert.equal(projection.metrics.renderedBlockCount <= 120, true);
  assert.equal(typeof projection.metrics.budgetTruncated, "boolean");
});

test("active multi-line paragraph keeps only active line editable and renders inactive slices", () => {
  const text = "line one\nline two\nline three\n";
  const state = EditorState.create({
    doc: text,
    selection: { anchor: 2 },
  });
  const model = createModel(text, [
    {
      id: "p1",
      type: "paragraph",
      from: 0,
      to: text.length - 1,
      lineFrom: 1,
      lineTo: 3,
      depth: null,
      attrs: {},
    },
  ]);

  const projection = buildLiveProjection({
    state,
    model,
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  assert.equal(projection.activeBlockId, "p1");
  assert.equal(projection.renderedBlocks.length > 0, true);
  assert.equal(
    projection.renderedBlocks.every((entry) => entry.blockId === "p1"),
    true,
  );
});

test("single-line heading/quote/list/task blocks use source transforms for syntax-level live preview", () => {
  const text = "# H\n> quoted\n- [ ] alpha\n- beta\n";
  const state = EditorState.create({
    doc: text,
    selection: { anchor: 6 },
  });
  const model = createModel(text, [
    {
      id: "h1",
      type: "heading",
      from: 0,
      to: 3,
      lineFrom: 1,
      lineTo: 1,
      depth: null,
      attrs: { level: 1 },
    },
    {
      id: "q1",
      type: "blockquote",
      from: 4,
      to: 12,
      lineFrom: 2,
      lineTo: 2,
      depth: null,
      attrs: {},
    },
    {
      id: "t1",
      type: "task",
      from: 13,
      to: 24,
      lineFrom: 3,
      lineTo: 3,
      depth: 0,
      attrs: { checked: false, depth: 0 },
    },
    {
      id: "l1",
      type: "list",
      from: 25,
      to: 31,
      lineFrom: 4,
      lineTo: 4,
      depth: 0,
      attrs: { depth: 0 },
    },
  ]);

  const projection = buildLiveProjection({
    state,
    model,
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  assert.equal(Array.isArray(projection.sourceTransforms), true);
  assert.equal(projection.sourceTransforms.length, 4);
  assert.deepEqual(
    projection.sourceTransforms.map((entry) => entry.type),
    ["heading", "blockquote", "task", "list"],
  );
  assert.equal(projection.renderedBlocks.length, 0);
});

test("blockquote source transforms add one rendered quote line decoration per quoted line", () => {
  const text = "> alpha\n> beta\nplain\n";
  const state = EditorState.create({
    doc: text,
    selection: { anchor: text.indexOf("alpha") + 1 },
  });
  const model = createModel(text, [
    {
      id: "q1",
      type: "blockquote",
      from: 0,
      to: 7,
      lineFrom: 1,
      lineTo: 1,
      depth: null,
      attrs: {},
    },
    {
      id: "q2",
      type: "blockquote",
      from: 8,
      to: 14,
      lineFrom: 2,
      lineTo: 2,
      depth: null,
      attrs: {},
    },
    {
      id: "p1",
      type: "paragraph",
      from: 15,
      to: 20,
      lineFrom: 3,
      lineTo: 3,
      depth: null,
      attrs: {},
    },
  ]);

  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  const projection = renderer.buildRenderProjection(state, model);
  const quoteLineRanges = collectLineRangesByClass(
    projection,
    0,
    text.length,
    "mm-live-v4-source-quote-line",
  );
  const quoteLineAttributes = collectLineAttributesByClass(
    projection,
    0,
    text.length,
    "mm-live-v4-source-quote-line",
  );
  const hiddenRanges = collectSyntaxHiddenRanges(projection, 0, text.length);

  assert.deepEqual(quoteLineRanges, [
    [0, 0],
    [8, 8],
  ]);
  assert.deepEqual(
    quoteLineAttributes.map(
      (entry) => entry.attributes["data-mm-quote-rendered"],
    ),
    ["true", "true"],
  );
  assert.equal(
    hiddenRanges.some(([from, to]) => from === 0 && to === 1),
    true,
  );
  assert.equal(
    hiddenRanges.some(([from, to]) => from === 1 && to === 2),
    true,
  );
  assert.equal(
    hiddenRanges.some(([from, to]) => from === 8 && to === 9),
    true,
  );
  assert.equal(
    hiddenRanges.some(([from, to]) => from === 9 && to === 10),
    true,
  );
});

test("blockquote content start keeps marker rendered while marker selection reveals raw syntax", () => {
  const text = "> alpha\n";
  const model = createModel(text, [
    {
      id: "q1",
      type: "blockquote",
      from: 0,
      to: 7,
      lineFrom: 1,
      lineTo: 1,
      depth: null,
      attrs: {},
    },
  ]);
  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  const contentState = EditorState.create({
    doc: text,
    selection: { anchor: 2 },
  });
  const contentProjection = renderer.buildRenderProjection(contentState, model);
  const contentHidden = collectSyntaxHiddenRanges(
    contentProjection,
    0,
    text.length,
  );
  const contentQuoteLine = collectLineAttributesByClass(
    contentProjection,
    0,
    text.length,
    "mm-live-v4-source-quote-line",
  );

  assert.equal(
    contentHidden.some(([from, to]) => from === 0 && to === 1),
    true,
  );
  assert.equal(
    contentHidden.some(([from, to]) => from === 1 && to === 2),
    true,
  );
  assert.equal(
    contentQuoteLine[0]?.attributes?.["data-mm-quote-rendered"],
    "true",
  );

  const leftEdgeState = EditorState.create({
    doc: text,
    selection: { anchor: 0 },
  });
  const leftEdgeProjection = renderer.buildRenderProjection(
    leftEdgeState,
    model,
  );
  const leftEdgeHidden = collectSyntaxHiddenRanges(
    leftEdgeProjection,
    0,
    text.length,
  );
  const leftEdgeQuoteLine = collectLineAttributesByClass(
    leftEdgeProjection,
    0,
    text.length,
    "mm-live-v4-source-quote-line",
  );
  const leftEdgeVisibleMarker = collectRangesByClass(
    leftEdgeProjection,
    0,
    text.length,
    "mm-live-v4-inline-quote-marker-visible",
  );

  assert.equal(
    leftEdgeHidden.some(([from, to]) => from === 0 && to === 1),
    false,
  );
  assert.equal(
    leftEdgeHidden.some(([from, to]) => from === 1 && to === 2),
    true,
  );
  assert.equal(
    leftEdgeQuoteLine[0]?.attributes?.["data-mm-quote-rendered"],
    "false",
  );
  assert.equal(
    leftEdgeVisibleMarker.some(([from, to]) => from === 0 && to === 1),
    true,
  );

  const markerState = EditorState.create({
    doc: text,
    selection: { anchor: 1 },
  });
  const markerProjection = renderer.buildRenderProjection(markerState, model);
  const markerHidden = collectSyntaxHiddenRanges(
    markerProjection,
    0,
    text.length,
  );
  const markerQuoteLine = collectLineAttributesByClass(
    markerProjection,
    0,
    text.length,
    "mm-live-v4-source-quote-line",
  );
  const markerVisibleMarker = collectRangesByClass(
    markerProjection,
    0,
    text.length,
    "mm-live-v4-inline-quote-marker-visible",
  );

  assert.equal(
    markerHidden.some(([from, to]) => from === 0 && to === 1),
    false,
  );
  assert.equal(
    markerHidden.some(([from, to]) => from === 1 && to === 2),
    true,
  );
  assert.equal(
    markerQuoteLine[0]?.attributes?.["data-mm-quote-rendered"],
    "false",
  );
  assert.equal(
    markerVisibleMarker.some(([from, to]) => from === 0 && to === 1),
    true,
  );
});

test("list and task marker core becomes source-visible in marker zone while trailing gap stays hidden", () => {
  const text = "- Bullet\n1. Ordered\n- [ ] Task\n";
  const orderedFrom = text.indexOf("1.");
  const taskFrom = text.indexOf("- [ ]");
  const model = createModel(text, [
    {
      id: "l1",
      type: "list",
      from: 0,
      to: 8,
      lineFrom: 1,
      lineTo: 1,
      depth: 0,
      attrs: { depth: 0, listMarker: "-" },
    },
    {
      id: "l2",
      type: "list",
      from: orderedFrom,
      to: orderedFrom + "1. Ordered".length,
      lineFrom: 2,
      lineTo: 2,
      depth: 0,
      attrs: { depth: 0, listMarker: "1." },
    },
    {
      id: "t1",
      type: "task",
      from: taskFrom,
      to: taskFrom + "- [ ] Task".length,
      lineFrom: 3,
      lineTo: 3,
      depth: 0,
      attrs: { checked: false, depth: 0, listMarker: "-" },
    },
  ]);
  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  const cases = [
    {
      anchor: 0,
      hiddenRanges: [[1, 2]],
      widgetName: "InlineListPrefixWidget",
      widgetAt: 2,
      expectWidget: false,
    },
    {
      anchor: orderedFrom + 1,
      hiddenRanges: [[orderedFrom + 2, orderedFrom + 3]],
      widgetName: "InlineListPrefixWidget",
      widgetAt: orderedFrom + 3,
      expectWidget: false,
    },
    {
      anchor: taskFrom + 1,
      hiddenRanges: [[taskFrom + 5, taskFrom + 6]],
      widgetName: "InlineTaskPrefixWidget",
      widgetAt: taskFrom + 6,
      expectWidget: false,
    },
  ];

  for (const entry of cases) {
    const state = EditorState.create({
      doc: text,
      selection: { anchor: entry.anchor },
    });
    const projection = renderer.buildRenderProjection(state, model);
    const hiddenRanges = collectSyntaxHiddenRanges(projection, 0, text.length);
    const widgets = collectReplacementsByWidgetName(
      projection,
      0,
      text.length,
      entry.widgetName,
    );

    for (const range of entry.hiddenRanges) {
      assert.equal(
        hiddenRanges.some(([from, to]) => from === range[0] && to === range[1]),
        true,
      );
    }
    assert.equal(
      widgets.some(
        ([from, to]) => from === entry.widgetAt && to === entry.widgetAt,
      ),
      entry.expectWidget,
    );
  }
});

test("frontmatter uses source transforms instead of rendered block replacement", () => {
  const text = "---\ntitle: Note\ntags:\n  - project\n---\n\nBody\n";
  const bodyFrom = text.indexOf("Body");
  const bodyTo = bodyFrom + "Body".length;
  const frontmatterTo = text.indexOf("\n\nBody");
  const state = EditorState.create({
    doc: text,
    selection: { anchor: bodyFrom },
  });
  const model = createModel(text, [
    {
      id: "fm1",
      type: "frontmatter",
      from: 0,
      to: frontmatterTo,
      lineFrom: 1,
      lineTo: 5,
      depth: null,
      attrs: {},
    },
    {
      id: "p1",
      type: "paragraph",
      from: bodyFrom,
      to: bodyTo,
      lineFrom: 7,
      lineTo: 7,
      depth: null,
      attrs: {},
    },
  ]);

  const projection = buildLiveProjection({
    state,
    model,
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  assert.equal(projection.renderedBlocks.length, 0);
  assert.deepEqual(
    projection.sourceTransforms.map((entry) => entry.type),
    ["frontmatter", "paragraph"],
  );
});

test("paragraph source transforms include inline spans for syntax rendering", () => {
  const text = "Line with **bold** and [link](https://example.com)\n";
  const state = EditorState.create({
    doc: text,
    selection: { anchor: 6 },
  });
  const model = createModel(
    text,
    [
      {
        id: "p1",
        type: "paragraph",
        from: 0,
        to: text.length - 1,
        lineFrom: 1,
        lineTo: 1,
        depth: null,
        attrs: {},
      },
    ],
    [
      { from: 10, to: 18, type: "strong" },
      { from: 23, to: 50, type: "link" },
    ],
  );

  const projection = buildLiveProjection({
    state,
    model,
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  assert.equal(projection.renderedBlocks.length, 0);
  assert.equal(projection.sourceTransforms.length, 1);
  assert.deepEqual(
    projection.sourceTransforms[0].inlineSpans.map((span) => span.type),
    ["strong", "link"],
  );
});

test("frontmatter renders as a full block when inactive and drops to raw source when active", () => {
  const text = "---\ntitle: Note\nowner: qa\n---\n\nBody\n";
  const bodyAnchor = text.indexOf("Body");
  const titleAnchor = text.indexOf("title");
  const closingFenceFrom = text.indexOf("\n---\n") + 1;
  const frontmatterTo = text.indexOf("\n\nBody");
  const model = createModel(text, [
    {
      id: "fm1",
      type: "frontmatter",
      from: 0,
      to: frontmatterTo,
      lineFrom: 1,
      lineTo: 4,
      depth: null,
      attrs: {},
    },
    {
      id: "p1",
      type: "paragraph",
      from: bodyAnchor,
      to: bodyAnchor + "Body".length,
      lineFrom: 6,
      lineTo: 6,
      depth: null,
      attrs: {},
    },
  ]);

  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  const inactiveState = EditorState.create({
    doc: text,
    selection: { anchor: bodyAnchor },
  });
  const inactiveProjection = renderer.buildRenderProjection(
    inactiveState,
    model,
  );
  const inactiveHidden = collectSyntaxHiddenRanges(
    inactiveProjection,
    0,
    frontmatterTo,
  );
  assert.equal(inactiveProjection.renderedBlocks.length, 0);
  assert.equal(
    inactiveHidden.some(([from, to]) => from === 0 && to === 3),
    true,
  );
  assert.equal(
    inactiveHidden.some(
      ([from, to]) => from === closingFenceFrom && to === closingFenceFrom + 3,
    ),
    true,
  );

  const activeState = EditorState.create({
    doc: text,
    selection: { anchor: titleAnchor },
  });
  const activeProjection = renderer.buildRenderProjection(activeState, model);
  const activeHidden = collectSyntaxHiddenRanges(
    activeProjection,
    0,
    frontmatterTo,
  );
  assert.equal(
    activeHidden.some(([from, to]) => from === 0 && to === 3),
    false,
  );
  assert.equal(
    activeHidden.some(
      ([from, to]) => from === closingFenceFrom && to === closingFenceFrom + 3,
    ),
    false,
  );
});

test("frontmatter drops to raw source when the cursor is on the closing fence", () => {
  const text = "---\ntitle: Note\nowner: qa\n---\n\nBody\n";
  const closingFenceAnchor = text.indexOf("\n---\n") + 1;
  const closingFenceFrom = text.indexOf("\n---\n") + 1;
  const bodyAnchor = text.indexOf("Body");
  const frontmatterTo = text.indexOf("\n\nBody");
  const model = createModel(text, [
    {
      id: "fm1",
      type: "frontmatter",
      from: 0,
      to: frontmatterTo,
      lineFrom: 1,
      lineTo: 4,
      depth: null,
      attrs: {},
    },
    {
      id: "p1",
      type: "paragraph",
      from: bodyAnchor,
      to: bodyAnchor + "Body".length,
      lineFrom: 6,
      lineTo: 6,
      depth: null,
      attrs: {},
    },
  ]);

  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  const fenceState = EditorState.create({
    doc: text,
    selection: { anchor: closingFenceAnchor },
  });
  const fenceProjection = renderer.buildRenderProjection(fenceState, model);
  const fenceHidden = collectSyntaxHiddenRanges(
    fenceProjection,
    0,
    frontmatterTo,
  );

  assert.equal(
    fenceHidden.some(([from, to]) => from === 0 && to === 3),
    false,
  );
  assert.equal(
    fenceHidden.some(
      ([from, to]) => from === closingFenceFrom && to === closingFenceFrom + 3,
    ),
    false,
  );
});

test("frontmatter remains rendered when the cursor is on the blank line after the closing fence", () => {
  const text = "---\ntitle: Note\nowner: qa\n---\n\nBody\n";
  const closingFenceFrom = text.indexOf("\n---\n") + 1;
  const blankLineAnchor = closingFenceFrom + 4;
  const bodyAnchor = text.indexOf("Body");
  const parserFrontmatterTo = blankLineAnchor;
  const model = createModel(text, [
    {
      id: "fm1",
      type: "frontmatter",
      from: 0,
      to: parserFrontmatterTo,
      lineFrom: 1,
      lineTo: 4,
      depth: null,
      attrs: {},
    },
    {
      id: "p1",
      type: "paragraph",
      from: bodyAnchor,
      to: bodyAnchor + "Body".length,
      lineFrom: 6,
      lineTo: 6,
      depth: null,
      attrs: {},
    },
  ]);

  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  const blankLineState = EditorState.create({
    doc: text,
    selection: { anchor: blankLineAnchor },
  });
  const blankLineProjection = renderer.buildRenderProjection(
    blankLineState,
    model,
  );
  const blankLineHidden = collectSyntaxHiddenRanges(
    blankLineProjection,
    0,
    parserFrontmatterTo,
  );

  assert.equal(
    blankLineHidden.some(([from, to]) => from === 0 && to === 3),
    true,
  );
  assert.equal(
    blankLineHidden.some(
      ([from, to]) => from === closingFenceFrom && to === closingFenceFrom + 3,
    ),
    true,
  );
});

test("inline syntax hides in content mode and reveals when cursor is inside syntax", () => {
  const text = "Paragraph with **bold** text\n";
  const line = text.trimEnd();
  const model = createModel(
    text,
    [
      {
        id: "p1",
        type: "paragraph",
        from: 0,
        to: line.length,
        lineFrom: 1,
        lineTo: 1,
        depth: null,
        attrs: {},
      },
    ],
    [{ from: 15, to: 23, type: "strong" }],
  );

  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  const contentState = EditorState.create({
    doc: text,
    selection: { anchor: 18 },
  });
  const contentProjection = renderer.buildRenderProjection(contentState, model);
  const contentHidden = collectSyntaxHiddenRanges(
    contentProjection,
    0,
    line.length,
  );
  assert.equal(
    contentHidden.some(([from, to]) => from === 15 && to === 17),
    true,
  );
  assert.equal(
    contentHidden.some(([from, to]) => from === 21 && to === 23),
    true,
  );

  const syntaxState = EditorState.create({
    doc: text,
    selection: { anchor: 16 },
  });
  const syntaxProjection = renderer.buildRenderProjection(syntaxState, model);
  const syntaxHidden = collectSyntaxHiddenRanges(
    syntaxProjection,
    0,
    line.length,
  );
  assert.equal(
    syntaxHidden.some(([from, to]) => from === 15 && to === 17),
    false,
  );
  assert.equal(
    syntaxHidden.some(([from, to]) => from === 21 && to === 23),
    false,
  );
});

test("highlight inline renders style and hides == markers outside syntax focus", () => {
  const text = "Paragraph ==mark== text\n";
  const line = text.trimEnd();
  const model = createModel(
    text,
    [
      {
        id: "p1",
        type: "paragraph",
        from: 0,
        to: line.length,
        lineFrom: 1,
        lineTo: 1,
        depth: null,
        attrs: {},
      },
    ],
    [{ from: 10, to: 18, type: "highlight" }],
  );

  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  const contentState = EditorState.create({
    doc: text,
    selection: { anchor: 14 },
  });
  const contentProjection = renderer.buildRenderProjection(contentState, model);
  const contentHidden = collectSyntaxHiddenRanges(
    contentProjection,
    0,
    line.length,
  );
  assert.equal(
    contentHidden.some(([from, to]) => from === 10 && to === 12),
    true,
  );
  assert.equal(
    contentHidden.some(([from, to]) => from === 16 && to === 18),
    true,
  );

  const syntaxState = EditorState.create({
    doc: text,
    selection: { anchor: 11 },
  });
  const syntaxProjection = renderer.buildRenderProjection(syntaxState, model);
  const syntaxHidden = collectSyntaxHiddenRanges(
    syntaxProjection,
    0,
    line.length,
  );
  assert.equal(
    syntaxHidden.some(([from, to]) => from === 10 && to === 12),
    false,
  );
  assert.equal(
    syntaxHidden.some(([from, to]) => from === 16 && to === 18),
    false,
  );
});

test("inline code selection adds explicit visible selection styling for selected content", () => {
  const text = "Paragraph with `~text~` token\n";
  const line = text.trimEnd();
  const codeFrom = text.indexOf("`~text~`");
  const codeTo = codeFrom + "`~text~`".length;
  const selectedTextFrom = text.indexOf("text");
  const selectedTextTo = selectedTextFrom + "text".length;
  const model = createModel(
    text,
    [
      {
        id: "p1",
        type: "paragraph",
        from: 0,
        to: line.length,
        lineFrom: 1,
        lineTo: 1,
        depth: null,
        attrs: {},
      },
    ],
    [{ from: codeFrom, to: codeTo, type: "code" }],
  );

  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  const selectedState = EditorState.create({
    doc: text,
    selection: {
      anchor: selectedTextFrom,
      head: selectedTextTo,
    },
  });
  const projection = renderer.buildRenderProjection(selectedState, model);
  const selectedRanges = collectRangesByClass(
    projection,
    0,
    line.length,
    "mm-live-v4-inline-code-selected",
  );

  assert.equal(
    selectedRanges.some(
      ([from, to]) => from === selectedTextFrom && to === selectedTextTo,
    ),
    true,
  );
});

test("richer inline spans hide syntax and render stable inline replacements", () => {
  const text =
    "Inline [ref link][ref], <https://example.com>, ***both***, \\*literal\\*, ![[diagram.png]], [^1], and end\\\n";
  const line = text.trimEnd();
  const imageFrom = text.indexOf("![[diagram.png]]");
  const imageTo = imageFrom + "![[diagram.png]]".length;
  const model = createModel(
    text,
    [
      {
        id: "p1",
        type: "paragraph",
        from: 0,
        to: line.length,
        lineFrom: 1,
        lineTo: 1,
        depth: null,
        attrs: {},
      },
    ],
    [
      {
        from: text.indexOf("[ref link][ref]"),
        to: text.indexOf("[ref link][ref]") + "[ref link][ref]".length,
        type: "reference-link",
      },
      {
        from: text.indexOf("<https://example.com>"),
        to:
          text.indexOf("<https://example.com>") +
          "<https://example.com>".length,
        type: "autolink",
      },
      {
        from: text.indexOf("***both***"),
        to: text.indexOf("***both***") + "***both***".length,
        type: "strong-emphasis",
      },
      {
        from: text.indexOf("\\*literal"),
        to: text.indexOf("\\*literal") + 2,
        type: "escape",
      },
      {
        from: text.indexOf("literal\\*") + "literal".length,
        to: text.indexOf("literal\\*") + "literal".length + 2,
        type: "escape",
      },
      { from: imageFrom, to: imageTo, type: "image" },
      {
        from: text.indexOf("[^1]"),
        to: text.indexOf("[^1]") + "[^1]".length,
        type: "footnote-ref",
      },
      {
        from: text.lastIndexOf("\\"),
        to: text.lastIndexOf("\\") + 1,
        type: "hardbreak",
      },
    ],
  );

  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  const state = EditorState.create({
    doc: text,
    selection: { anchor: 0 },
  });
  const projection = renderer.buildRenderProjection(state, model);
  const hidden = collectSyntaxHiddenRanges(projection, 0, line.length);
  const strongRanges = collectRangesByClass(
    projection,
    0,
    line.length,
    "mm-live-v4-inline-strong",
  );
  const linkRanges = collectRangesByClass(
    projection,
    0,
    line.length,
    "mm-live-v4-inline-link",
  );
  const footnoteRanges = collectRangesByClass(
    projection,
    0,
    line.length,
    "mm-live-v4-inline-footnote-ref",
  );
  const imageReplacements = collectReplacementsByWidgetName(
    projection,
    0,
    line.length,
    "InlineImagePlaceholderWidget",
  );

  assert.equal(
    hidden.some(
      ([from, to]) =>
        from === text.indexOf("[ref link][ref]") &&
        to === text.indexOf("[ref link][ref]") + 1,
    ),
    true,
  );
  assert.equal(
    hidden.some(
      ([from, to]) =>
        from === text.indexOf("<https://example.com>") &&
        to === text.indexOf("<https://example.com>") + 1,
    ),
    true,
  );
  assert.equal(
    strongRanges.some(
      ([from, to]) =>
        from === text.indexOf("both") &&
        to === text.indexOf("both") + "both".length,
    ),
    true,
  );
  assert.equal(linkRanges.length >= 2, true);
  assert.equal(
    footnoteRanges.some(
      ([from, to]) =>
        from === text.indexOf("1") && to === text.indexOf("1") + 1,
    ),
    true,
  );
  assert.deepEqual(imageReplacements, [[imageFrom, imageTo]]);
  assert.equal(
    hidden.some(
      ([from, to]) =>
        from === text.lastIndexOf("\\") && to === text.lastIndexOf("\\") + 1,
    ),
    true,
  );
});

test("inactive reference definitions are hidden while active definitions stay editable", () => {
  const text = "[ref]: https://example.net\n\nBody\n";
  const bodyFrom = text.indexOf("Body");
  const model = createModel(text, [
    {
      id: "d1",
      type: "definition",
      from: 0,
      to: "[ref]: https://example.net".length,
      lineFrom: 1,
      lineTo: 1,
      depth: null,
      attrs: {},
    },
    {
      id: "p1",
      type: "paragraph",
      from: bodyFrom,
      to: bodyFrom + "Body".length,
      lineFrom: 3,
      lineTo: 3,
      depth: null,
      attrs: {},
    },
  ]);
  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
  });

  const inactiveState = EditorState.create({
    doc: text,
    selection: { anchor: bodyFrom },
  });
  const inactiveProjection = renderer.buildRenderProjection(
    inactiveState,
    model,
  );
  const inactiveHidden = collectSyntaxHiddenRanges(
    inactiveProjection,
    0,
    text.length,
  );
  assert.deepEqual(inactiveHidden, [[0, "[ref]: https://example.net".length]]);

  const activeState = EditorState.create({
    doc: text,
    selection: { anchor: 2 },
  });
  const activeProjection = renderer.buildRenderProjection(activeState, model);
  const activeHidden = collectSyntaxHiddenRanges(
    activeProjection,
    0,
    text.length,
  );
  assert.deepEqual(activeHidden, []);
});

test("active render-only blocks stay as raw source instead of being replaced", () => {
  const text = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\nBody\n";
  const bodyFrom = text.indexOf("Body");
  const tableTo = text.indexOf("\n\nBody");
  const model = createModel(text, [
    {
      id: "tbl1",
      type: "table",
      from: 0,
      to: tableTo,
      lineFrom: 1,
      lineTo: 3,
      depth: null,
      attrs: {},
    },
    {
      id: "p1",
      type: "paragraph",
      from: bodyFrom,
      to: bodyFrom + "Body".length,
      lineFrom: 5,
      lineTo: 5,
      depth: null,
      attrs: {},
    },
  ]);

  const inactiveState = EditorState.create({
    doc: text,
    selection: { anchor: bodyFrom },
  });
  const inactiveProjection = buildLiveProjection({
    state: inactiveState,
    model,
    renderMarkdownHtml(source) {
      return `<table>${source}</table>`;
    },
  });
  assert.equal(
    inactiveProjection.renderedBlocks.some((entry) => entry.blockId === "tbl1"),
    true,
  );

  const activeState = EditorState.create({
    doc: text,
    selection: { anchor: 2 },
  });
  const activeProjection = buildLiveProjection({
    state: activeState,
    model,
    renderMarkdownHtml(source) {
      return `<table>${source}</table>`;
    },
  });
  assert.equal(
    activeProjection.renderedBlocks.some((entry) => entry.blockId === "tbl1"),
    false,
  );
});
