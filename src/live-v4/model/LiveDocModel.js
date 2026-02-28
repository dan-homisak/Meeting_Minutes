const BLOCK_TYPES = new Set([
  'frontmatter',
  'heading',
  'paragraph',
  'blockquote',
  'list',
  'task',
  'table',
  'code',
  'hr'
]);

function normalizeNumber(value, fallback = 0) {
  if (!Number.isFinite(value)) {
    return Math.max(0, Math.trunc(fallback));
  }
  return Math.max(0, Math.trunc(value));
}

export function normalizeLiveBlockType(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return 'paragraph';
  }

  if (BLOCK_TYPES.has(value)) {
    return value;
  }

  if (value === 'ordered-list' || value === 'unordered-list') {
    return 'list';
  }

  if (value === 'rule') {
    return 'hr';
  }

  return 'paragraph';
}

function normalizeAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) {
    return {};
  }
  return { ...attrs };
}

function readDepth(blockType, attrs = {}) {
  if (Number.isFinite(attrs.depth)) {
    return Math.max(0, Math.trunc(attrs.depth));
  }
  if (blockType === 'heading' && Number.isFinite(attrs.level)) {
    return Math.max(1, Math.trunc(attrs.level));
  }
  return null;
}

function normalizeInlineType(type) {
  if (typeof type === 'string' && type.trim().length > 0) {
    return type.trim();
  }
  return 'inline';
}

function normalizeParserMeta(meta = {}) {
  return {
    dialect: 'obsidian-core',
    parser: meta?.parser === 'incremental' ? 'incremental' : 'full',
    reparsedFrom: Number.isFinite(meta?.reparsedFrom) ? Math.trunc(meta.reparsedFrom) : null,
    reparsedTo: Number.isFinite(meta?.reparsedTo) ? Math.trunc(meta.reparsedTo) : null
  };
}

export function createLiveDocModel({
  version = 0,
  text = '',
  blocks = [],
  inlines = [],
  meta = null
} = {}) {
  const normalizedText = typeof text === 'string' ? text : '';
  const textLength = normalizedText.length;

  const normalizedBlocks = (Array.isArray(blocks) ? blocks : [])
    .map((block, index) => {
      if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
        return null;
      }

      const from = normalizeNumber(block.from);
      const to = Math.max(from, Math.min(textLength, normalizeNumber(block.to, textLength)));
      if (to <= from) {
        return null;
      }

      const type = normalizeLiveBlockType(block.type);
      const attrs = normalizeAttrs(block.attrs);
      const lineFrom = normalizeNumber(block.lineFrom, 1);
      const lineTo = Math.max(lineFrom, normalizeNumber(block.lineTo, lineFrom));
      const id = typeof block.id === 'string' && block.id.length > 0
        ? block.id
        : `live-block-${index + 1}-${from}-${to}`;

      return {
        id,
        type,
        from,
        to,
        lineFrom,
        lineTo,
        depth: readDepth(type, attrs),
        attrs
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.from - right.from || left.to - right.to);

  const normalizedInlines = (Array.isArray(inlines) ? inlines : [])
    .map((inline) => {
      if (!inline || !Number.isFinite(inline.from) || !Number.isFinite(inline.to)) {
        return null;
      }

      const from = normalizeNumber(inline.from);
      const to = Math.max(from, Math.min(textLength, normalizeNumber(inline.to, textLength)));
      if (to <= from) {
        return null;
      }

      return {
        from,
        to,
        type: normalizeInlineType(inline.type)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.from - right.from || left.to - right.to);

  return {
    version: normalizeNumber(version),
    text: normalizedText,
    blocks: normalizedBlocks,
    inlines: normalizedInlines,
    meta: normalizeParserMeta(meta)
  };
}

// Kept for test compatibility while using native live-v4 model shape.
export function toLiveDocModel(sourceModel, versionOverride = null) {
  const source = sourceModel && typeof sourceModel === 'object' ? sourceModel : {};
  const version = Number.isFinite(versionOverride)
    ? Math.max(0, Math.trunc(versionOverride))
    : normalizeNumber(source.version);

  return createLiveDocModel({
    version,
    text: source.text,
    blocks: source.blocks,
    inlines: source.inlines ?? source.inlineSpans,
    meta: source.meta
  });
}

export function createEmptyLiveDocModel() {
  return createLiveDocModel({
    version: 0,
    text: '',
    blocks: [],
    inlines: [],
    meta: {
      parser: 'full',
      reparsedFrom: null,
      reparsedTo: null
    }
  });
}
