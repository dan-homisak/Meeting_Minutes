import { Decoration, WidgetType } from '@codemirror/view';
import { RenderedBlockWidget } from './render/WidgetFactory.js';
import { buildLiveProjection } from './LiveProjection.js';

function clampRangeToDoc(state, from, to) {
  if (!state?.doc || !Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  const max = Math.max(0, Math.trunc(state.doc.length));
  const rangeFrom = Math.max(0, Math.min(max, Math.trunc(from)));
  const rangeTo = Math.max(rangeFrom, Math.min(max, Math.trunc(to)));
  if (rangeTo <= rangeFrom) {
    return null;
  }

  return {
    from: rangeFrom,
    to: rangeTo
  };
}

function resolveReplacementRange(state, sourceFrom, sourceTo) {
  return clampRangeToDoc(state, sourceFrom, sourceTo);
}

function buildWidgetDecorations(state, renderedBlocks) {
  const decorations = [];
  let previousRangeTo = -1;

  const sortedBlocks = [...(Array.isArray(renderedBlocks) ? renderedBlocks : [])]
    .filter((entry) => (
      entry &&
      Number.isFinite(entry.sourceFrom) &&
      Number.isFinite(entry.sourceTo) &&
      entry.sourceTo > entry.sourceFrom
    ))
    .sort((left, right) => left.sourceFrom - right.sourceFrom || left.sourceTo - right.sourceTo);

  for (const entry of sortedBlocks) {
    const replacement = resolveReplacementRange(state, entry.sourceFrom, entry.sourceTo);
    if (!replacement) {
      continue;
    }

    let rangeFrom = replacement.from;
    const rangeTo = replacement.to;
    if (rangeFrom < previousRangeTo) {
      rangeFrom = previousRangeTo;
    }
    if (rangeTo <= rangeFrom) {
      continue;
    }

    decorations.push(
      Decoration.replace({
        widget: new RenderedBlockWidget({
          html: entry.html,
          fragmentId: entry.fragmentId,
          blockId: entry.blockId,
          sourceFrom: entry.sourceFrom,
          sourceTo: entry.sourceTo
        }),
        block: false,
        inclusive: false
      }).range(rangeFrom, rangeTo)
    );

    previousRangeTo = rangeTo;
  }

  return decorations;
}

class InlineListPrefixWidget extends WidgetType {
  constructor({ markerLabel = '•', depth = 0 } = {}) {
    super();
    this.markerLabel = markerLabel;
    this.depth = Number.isFinite(depth) ? Math.max(0, Math.trunc(depth)) : 0;
  }

  eq(other) {
    return (
      other instanceof InlineListPrefixWidget &&
      this.markerLabel === other.markerLabel &&
      this.depth === other.depth
    );
  }

  toDOM() {
    const wrapper = document.createElement('span');
    wrapper.className = 'mm-live-v4-inline-list-prefix';
    wrapper.textContent = this.markerLabel;
    wrapper.style.setProperty('--list-depth', String(this.depth));
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

class InlineTaskPrefixWidget extends WidgetType {
  constructor({ sourceFrom, checked = false, depth = 0 } = {}) {
    super();
    this.sourceFrom = sourceFrom;
    this.checked = Boolean(checked);
    this.depth = Number.isFinite(depth) ? Math.max(0, Math.trunc(depth)) : 0;
  }

  eq(other) {
    return (
      other instanceof InlineTaskPrefixWidget &&
      this.sourceFrom === other.sourceFrom &&
      this.checked === other.checked &&
      this.depth === other.depth
    );
  }

  toDOM() {
    const wrapper = document.createElement('span');
    wrapper.className = 'mm-live-v4-inline-task-prefix';
    wrapper.style.setProperty('--list-depth', String(this.depth));

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = this.checked;
    checkbox.setAttribute('data-task-source-from', String(this.sourceFrom));

    wrapper.appendChild(checkbox);
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

class InlineQuotePrefixWidget extends WidgetType {
  toDOM() {
    const wrapper = document.createElement('span');
    wrapper.className = 'mm-live-v4-inline-quote-prefix';
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

function normalizeListMarker(marker) {
  if (typeof marker !== 'string' || marker.length === 0) {
    return '•';
  }
  return /^\d+\.$/.test(marker) ? marker : '•';
}

function resolveLineTransformMeta(state, transform) {
  if (!state?.doc || !transform || !Number.isFinite(transform.sourceFrom) || !Number.isFinite(transform.sourceTo)) {
    return null;
  }

  const range = clampRangeToDoc(state, transform.sourceFrom, transform.sourceTo);
  if (!range) {
    return null;
  }

  const lineText = state.doc.sliceString(range.from, range.to);
  const depth = Number.isFinite(transform?.depth)
    ? Math.max(0, Math.trunc(transform.depth))
    : Number.isFinite(transform?.attrs?.depth)
      ? Math.max(0, Math.trunc(transform.attrs.depth))
      : 0;

  const base = {
    type: transform.type,
    sourceFrom: range.from,
    sourceTo: range.to,
    depth
  };

  if (transform.type === 'heading') {
    const match = lineText.match(/^(\s{0,3}#{1,6}\s+)/);
    if (!match || !match[1]) {
      return null;
    }
    return {
      ...base,
      markerFrom: range.from,
      markerTo: range.from + match[1].length,
      contentFrom: range.from + match[1].length,
      contentClass: 'mm-live-v4-source-content mm-live-v4-source-heading'
    };
  }

  if (transform.type === 'blockquote') {
    const match = lineText.match(/^(\s*>\s?)/);
    if (!match || !match[1]) {
      return null;
    }
    return {
      ...base,
      markerFrom: range.from,
      markerTo: range.from + match[1].length,
      contentFrom: range.from + match[1].length,
      contentClass: 'mm-live-v4-source-content mm-live-v4-source-quote'
    };
  }

  if (transform.type === 'task') {
    const match = lineText.match(/^(\s*(?:[-+*]|\d+\.)\s+\[)( |x|X)(\]\s+)/);
    if (!match || !match[0]) {
      return null;
    }
    const listMarker = /^\s*(\d+\.|[-+*])/.exec(lineText)?.[1] ?? '-';
    return {
      ...base,
      markerFrom: range.from,
      markerTo: range.from + match[0].length,
      contentFrom: range.from + match[0].length,
      checked: String(match[2] ?? '').toLowerCase() === 'x',
      listMarker,
      contentClass: 'mm-live-v4-source-content mm-live-v4-source-task'
    };
  }

  if (transform.type === 'list') {
    const match = lineText.match(/^(\s*(?:[-+*]|\d+\.)\s+)/);
    if (!match || !match[1]) {
      return null;
    }
    const listMarker = /^\s*(\d+\.|[-+*])/.exec(lineText)?.[1] ?? '-';
    return {
      ...base,
      markerFrom: range.from,
      markerTo: range.from + match[1].length,
      contentFrom: range.from + match[1].length,
      listMarker,
      contentClass: 'mm-live-v4-source-content mm-live-v4-source-list'
    };
  }

  return null;
}

function buildSourceLineDecorations(state, sourceTransforms) {
  if (!Array.isArray(sourceTransforms) || sourceTransforms.length === 0) {
    return [];
  }

  const selectionHead = state.selection.main.head;
  const decorations = [];
  const sortedTransforms = [...sourceTransforms]
    .filter((entry) => Number.isFinite(entry?.sourceFrom) && Number.isFinite(entry?.sourceTo))
    .sort((left, right) => left.sourceFrom - right.sourceFrom || left.sourceTo - right.sourceTo);

  for (const transform of sortedTransforms) {
    const meta = resolveLineTransformMeta(state, transform);
    if (!meta) {
      continue;
    }

    const markerIncludesSelection = (
      selectionHead >= meta.markerFrom &&
      selectionHead <= meta.markerTo
    );
    const hideSyntaxMarker = !markerIncludesSelection;

    if (hideSyntaxMarker && meta.markerTo > meta.markerFrom) {
      decorations.push(
        Decoration.mark({
          class: 'mm-live-v4-syntax-hidden'
        }).range(meta.markerFrom, meta.markerTo)
      );
    }

    if (meta.contentFrom < meta.sourceTo) {
      const attributes = {
        class: meta.contentClass
      };
      if (Number.isFinite(meta.depth)) {
        attributes['data-list-depth'] = String(meta.depth);
      }
      decorations.push(
        Decoration.mark({
          attributes
        }).range(meta.contentFrom, meta.sourceTo)
      );
    }

    if (!hideSyntaxMarker) {
      continue;
    }

    if (meta.type === 'task') {
      decorations.push(
        Decoration.widget({
          widget: new InlineTaskPrefixWidget({
            sourceFrom: meta.sourceFrom,
            checked: meta.checked,
            depth: meta.depth
          }),
          side: -1
        }).range(meta.contentFrom)
      );
      continue;
    }

    if (meta.type === 'list') {
      decorations.push(
        Decoration.widget({
          widget: new InlineListPrefixWidget({
            markerLabel: normalizeListMarker(meta.listMarker),
            depth: meta.depth
          }),
          side: -1
        }).range(meta.contentFrom)
      );
      continue;
    }

    if (meta.type === 'blockquote') {
      decorations.push(
        Decoration.widget({
          widget: new InlineQuotePrefixWidget(),
          side: -1
        }).range(meta.contentFrom)
      );
    }
  }

  return decorations;
}

export function createLiveRenderer({
  liveDebug,
  renderMarkdownHtml,
  renderBudgetMaxBlocks = 180,
  virtualizationBufferBefore = 16,
  virtualizationBufferAfter = 16
} = {}) {
  function buildRenderProjection(state, model, viewportWindow = null) {
    const projection = buildLiveProjection({
      state,
      model,
      renderMarkdownHtml,
      viewportWindow,
      renderBudgetMaxBlocks,
      virtualizationBufferBefore,
      virtualizationBufferAfter
    });

    const widgetRanges = buildWidgetDecorations(state, projection.renderedBlocks);
    const sourceRanges = buildSourceLineDecorations(state, projection.sourceTransforms);
    const allRanges = [...widgetRanges, ...sourceRanges];

    liveDebug?.trace?.('live-v4.projection.built', {
      activeBlockId: projection.activeBlockId,
      renderedBlockCount: projection.metrics.renderedBlockCount,
      virtualizedBlockCount: projection.metrics.virtualizedBlockCount,
      budgetTruncated: projection.metrics.budgetTruncated,
      renderMs: projection.metrics.renderMs,
      viewportFrom: projection.viewportWindow?.from ?? null,
      viewportTo: projection.viewportWindow?.to ?? null
    });
    liveDebug?.trace?.('decorations.hybrid-built', {
      blockCount: Array.isArray(model?.blocks) ? model.blocks.length : 0,
      activeBlockId: projection.activeBlockId,
      renderedFragmentCount: widgetRanges.length,
      sourceTransformDecorationCount: sourceRanges.length,
      virtualizedBlockCount: projection.metrics.virtualizedBlockCount,
      renderBudgetMaxBlocks,
      renderBudgetTruncated: projection.metrics.budgetTruncated
    });

    return {
      ...projection,
      decorations: allRanges.length > 0 ? Decoration.set(allRanges, true) : Decoration.none,
      atomicRanges: widgetRanges.length > 0 ? Decoration.set(widgetRanges, true) : Decoration.none
    };
  }

  return {
    buildRenderProjection
  };
}
