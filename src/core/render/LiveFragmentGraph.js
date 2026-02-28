function clampRange(from, to, maxLength) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  const max = Math.max(0, Math.trunc(maxLength));
  const clampedFrom = Math.max(0, Math.min(max, Math.trunc(from)));
  const clampedTo = Math.max(clampedFrom, Math.min(max, Math.trunc(to)));
  if (clampedTo <= clampedFrom) {
    return null;
  }
  return {
    from: clampedFrom,
    to: clampedTo
  };
}

function intersects(left, right) {
  if (!left || !right) {
    return false;
  }
  return left.from < right.to && right.from < left.to;
}

function readBlockSource(doc, block) {
  if (!doc || !block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
    return '';
  }
  return doc.sliceString(block.from, block.to);
}

function normalizeBlockId(block, index) {
  if (typeof block?.id === 'string' && block.id.length > 0) {
    return block.id;
  }
  return `block-${index}-${Math.trunc(block?.from ?? 0)}-${Math.trunc(block?.to ?? 0)}`;
}

function normalizeBlockType(block) {
  if (typeof block?.type === 'string' && block.type.length > 0) {
    return block.type;
  }
  return 'paragraph';
}

function isWidgetBlockType(blockType) {
  return blockType === 'table' || blockType === 'code' || blockType === 'frontmatter';
}

function lineIntersectsActive(lineRange, activeLineRange) {
  return intersects(lineRange, activeLineRange);
}

function parseInlineFragments(source, sourceFrom, sourceTo, blockId, lineNumber = null) {
  if (typeof source !== 'string' || source.length === 0 || !Number.isFinite(sourceFrom)) {
    return [];
  }
  const maxTo = Number.isFinite(sourceTo) ? sourceTo : sourceFrom + source.length;
  const fragments = [];
  const patterns = [
    { type: 'wikilink', regex: /\[\[[^[\]\n|]+(?:\|[^[\]\n]+)?\]\]/g },
    { type: 'embed', regex: /!\[\[[^[\]\n|]+(?:\|[^[\]\n]+)?\]\]/g },
    { type: 'markdown-link', regex: /\[[^\]\n]+\]\([^)]+\)/g },
    { type: 'inline-code', regex: /`[^`\n]+`/g },
    { type: 'strong', regex: /\*\*[^*\n]+\*\*|__[^_\n]+__/g },
    { type: 'emphasis', regex: /(^|[^*])\*[^*\n]+\*(?!\*)|(^|[^_])_[^_\n]+_(?!_)/g }
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern.regex)) {
      const index = Number(match.index);
      const text = match[0] ?? '';
      if (!Number.isFinite(index) || text.length === 0) {
        continue;
      }
      const range = clampRange(sourceFrom + index, sourceFrom + index + text.length, maxTo);
      if (!range) {
        continue;
      }
      const fragmentId = `inline-${pattern.type}-${range.from}-${range.to}`;
      fragments.push({
        kind: 'inline-fragment',
        fragmentType: pattern.type,
        fragmentId,
        blockId,
        sourceFrom: range.from,
        sourceTo: range.to,
        lineNumber,
        priority: 220
      });
    }
  }
  return fragments;
}

function parseMarkerFragments(source, sourceFrom, sourceTo, blockId, lineNumber = null) {
  if (typeof source !== 'string' || source.length === 0 || !Number.isFinite(sourceFrom)) {
    return [];
  }
  const maxTo = Number.isFinite(sourceTo) ? sourceTo : sourceFrom + source.length;
  const markers = [];
  const markerPatterns = [
    { type: 'heading-marker', regex: /^\s{0,3}#{1,6}\s+/ },
    { type: 'list-marker', regex: /^\s*(?:[-+*]|\d+\.)\s+/ },
    { type: 'task-marker', regex: /^\s*(?:[-+*]|\d+\.)\s+\[(?: |x|X)\]\s+/ },
    { type: 'quote-marker', regex: /^\s*>\s?/ },
    { type: 'fence-marker', regex: /^\s*[`~]{3,}/ }
  ];
  for (const markerPattern of markerPatterns) {
    const match = source.match(markerPattern.regex);
    if (!match || typeof match[0] !== 'string' || match[0].length === 0) {
      continue;
    }
    const range = clampRange(sourceFrom, sourceFrom + match[0].length, maxTo);
    if (!range) {
      continue;
    }
    markers.push({
      kind: 'marker',
      markerType: markerPattern.type,
      fragmentId: `marker-${markerPattern.type}-${range.from}-${range.to}`,
      blockId,
      sourceFrom: range.from,
      sourceTo: range.to,
      lineNumber,
      priority: 260
    });
  }
  return markers;
}

function readLineRangeWithinBlock(doc, block, cursor) {
  const line = doc.lineAt(cursor);
  const from = Math.max(block.from, line.from);
  const to = Math.min(block.to, line.to);
  return clampRange(from, to, doc.length);
}

function buildLineFragment({
  lineRange,
  lineNumber,
  blockId,
  blockType,
  doc,
  renderMarkdownHtml
} = {}) {
  if (!lineRange || !Number.isFinite(lineNumber)) {
    return null;
  }
  const lineSource = doc.sliceString(lineRange.from, lineRange.to);
  const renderedHtml = renderMarkdownHtml(lineSource, {
    sourceFrom: lineRange.from,
    sourceTo: lineRange.to,
    blockType,
    fragmentKind: 'line-fragment'
  });
  return {
    kind: 'line-fragment',
    fragmentId: `line-${lineNumber}-${lineRange.from}-${lineRange.to}`,
    blockId,
    blockType,
    lineNumber,
    sourceFrom: lineRange.from,
    sourceTo: lineRange.to,
    html: renderedHtml,
    priority: 140
  };
}

function buildBlockFragment({
  block,
  blockId,
  blockType,
  doc,
  renderMarkdownHtml
} = {}) {
  const blockRange = clampRange(block?.from, block?.to, doc?.length ?? 0);
  if (!blockRange) {
    return null;
  }
  const blockSource = readBlockSource(doc, blockRange);
  const renderedHtml = renderMarkdownHtml(blockSource, {
    sourceFrom: blockRange.from,
    sourceTo: blockRange.to,
    blockType,
    fragmentKind: 'block'
  });
  return {
    kind: 'line-fragment',
    fragmentId: `block-fragment-${blockRange.from}-${blockRange.to}`,
    blockId,
    blockType,
    lineNumber: doc.lineAt(blockRange.from).number,
    sourceFrom: blockRange.from,
    sourceTo: blockRange.to,
    html: renderedHtml,
    priority: 130
  };
}

export function buildLiveFragmentGraph({
  doc,
  blocks = [],
  activeLineRange = null,
  renderMarkdownHtml = null,
  inlineSpans = []
} = {}) {
  if (!doc || !Array.isArray(blocks) || blocks.length === 0 || typeof renderMarkdownHtml !== 'function') {
    return {
      renderedFragments: [],
      inlineFragments: [],
      markerFragments: [],
      metrics: {
        renderedFragmentCount: 0,
        lineFragmentCount: 0,
        blockFragmentCount: 0,
        inlineFragmentCount: 0,
        markerFragmentCount: 0
      }
    };
  }

  const renderedFragments = [];
  const markerFragments = [];
  const inlineFragments = [];

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    const blockRange = clampRange(block?.from, block?.to, doc.length);
    if (!blockRange) {
      continue;
    }
    const blockId = normalizeBlockId(block, blockIndex);
    const blockType = normalizeBlockType(block);
    const blockIntersectsActiveLine = intersects(blockRange, activeLineRange);
    if (isWidgetBlockType(blockType)) {
      if (!blockIntersectsActiveLine) {
        const blockFragment = buildBlockFragment({
          block: blockRange,
          blockId,
          blockType,
          doc,
          renderMarkdownHtml
        });
        if (blockFragment) {
          renderedFragments.push(blockFragment);
        }
      }
      const blockSource = readBlockSource(doc, blockRange);
      inlineFragments.push(
        ...parseInlineFragments(blockSource, blockRange.from, blockRange.to, blockId, doc.lineAt(blockRange.from).number)
      );
      continue;
    }

    let cursor = blockRange.from;
    while (cursor < blockRange.to) {
      const lineRange = readLineRangeWithinBlock(doc, blockRange, cursor);
      if (!lineRange) {
        break;
      }
      const lineNumber = doc.lineAt(lineRange.from).number;
      const lineSource = doc.sliceString(lineRange.from, lineRange.to);
      const activeLine = lineIntersectsActive(lineRange, activeLineRange);
      if (!activeLine && lineSource.trim().length > 0) {
        const lineFragment = buildLineFragment({
          lineRange,
          lineNumber,
          blockId,
          blockType,
          doc,
          renderMarkdownHtml
        });
        if (lineFragment) {
          renderedFragments.push(lineFragment);
        }
      }

      markerFragments.push(
        ...parseMarkerFragments(lineSource, lineRange.from, lineRange.to, blockId, lineNumber)
      );
      inlineFragments.push(
        ...parseInlineFragments(lineSource, lineRange.from, lineRange.to, blockId, lineNumber)
      );

      if (lineRange.to >= blockRange.to) {
        break;
      }
      cursor = lineRange.to + 1;
    }
  }

  // Preserve inline spans from the shared document model as authoritative fragment hints.
  for (const span of inlineSpans) {
    if (!Number.isFinite(span?.from) || !Number.isFinite(span?.to) || span.to <= span.from) {
      continue;
    }
    const range = clampRange(span.from, span.to, doc.length);
    if (!range) {
      continue;
    }
    inlineFragments.push({
      kind: 'inline-fragment',
      fragmentType: typeof span.type === 'string' && span.type.length > 0 ? span.type : 'inline',
      fragmentId: `inline-model-${range.from}-${range.to}`,
      blockId: null,
      sourceFrom: range.from,
      sourceTo: range.to,
      lineNumber: doc.lineAt(range.from).number,
      priority: 200
    });
  }

  const blockFragmentCount = renderedFragments.filter((fragment) => fragment.blockType === 'table' || fragment.blockType === 'code' || fragment.blockType === 'frontmatter').length;
  const lineFragmentCount = Math.max(0, renderedFragments.length - blockFragmentCount);

  return {
    renderedFragments,
    inlineFragments,
    markerFragments,
    metrics: {
      renderedFragmentCount: renderedFragments.length,
      lineFragmentCount,
      blockFragmentCount,
      inlineFragmentCount: inlineFragments.length,
      markerFragmentCount: markerFragments.length
    }
  };
}
