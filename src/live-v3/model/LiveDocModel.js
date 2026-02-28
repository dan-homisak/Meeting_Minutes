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

function detectFrontmatterBlockType(text, block, blockType, index) {
  if (index !== 0 || blockType === 'frontmatter') {
    return blockType;
  }
  if (!Number.isFinite(block?.from) || !Number.isFinite(block?.to)) {
    return blockType;
  }
  if (Math.trunc(block.from) !== 0) {
    return blockType;
  }
  if (typeof text !== 'string' || !text.startsWith('---')) {
    return blockType;
  }

  const blockSource = text.slice(block.from, block.to);
  if (!/^---\n[\s\S]*\n---(?:\n|$)/.test(blockSource)) {
    return blockType;
  }

  return 'frontmatter';
}

function normalizeParserMeta(meta = {}) {
  const parser = meta?.parser === 'incremental' ? 'incremental' : 'full';
  return {
    dialect: 'obsidian-core',
    parser,
    reparsedFrom: Number.isFinite(meta?.reparsedFrom) ? Math.trunc(meta.reparsedFrom) : null,
    reparsedTo: Number.isFinite(meta?.reparsedTo) ? Math.trunc(meta.reparsedTo) : null
  };
}

export function toLiveDocModel(legacyModel, versionOverride = null) {
  const source = legacyModel && typeof legacyModel === 'object' ? legacyModel : {};
  const text = typeof source.text === 'string' ? source.text : '';
  const blocksSource = Array.isArray(source.blocks) ? source.blocks : [];
  const inlinesSource = Array.isArray(source.inlineSpans) ? source.inlineSpans : [];

  const blocks = blocksSource
    .map((block, index) => {
      if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
        return null;
      }
      const from = normalizeNumber(block.from);
      const to = Math.max(from, normalizeNumber(block.to));
      if (to <= from) {
        return null;
      }

      const type = detectFrontmatterBlockType(
        text,
        block,
        normalizeLiveBlockType(block.type),
        index
      );
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
    .filter(Boolean);

  const inlines = inlinesSource
    .map((span) => {
      if (!span || !Number.isFinite(span.from) || !Number.isFinite(span.to)) {
        return null;
      }
      const from = normalizeNumber(span.from);
      const to = Math.max(from, normalizeNumber(span.to));
      if (to <= from) {
        return null;
      }
      return {
        from,
        to,
        type: normalizeInlineType(span.type)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.from - right.from || left.to - right.to);

  const version = Number.isFinite(versionOverride)
    ? Math.max(0, Math.trunc(versionOverride))
    : Number.isFinite(source.version)
      ? Math.max(0, Math.trunc(source.version))
      : 0;

  return {
    version,
    text,
    blocks,
    inlines,
    meta: normalizeParserMeta(source.meta)
  };
}

export function createEmptyLiveDocModel() {
  return {
    version: 0,
    text: '',
    blocks: [],
    inlines: [],
    meta: {
      dialect: 'obsidian-core',
      parser: 'full',
      reparsedFrom: null,
      reparsedTo: null
    }
  };
}
