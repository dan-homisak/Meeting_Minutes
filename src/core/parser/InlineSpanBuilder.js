function pushInlineSpan(spans, from, to, type) {
  if (!Array.isArray(spans) || !Number.isFinite(from) || !Number.isFinite(to)) {
    return;
  }

  const normalizedFrom = Math.max(0, Math.trunc(from));
  const normalizedTo = Math.max(normalizedFrom, Math.trunc(to));
  if (normalizedTo <= normalizedFrom) {
    return;
  }

  spans.push({
    from: normalizedFrom,
    to: normalizedTo,
    type: typeof type === 'string' && type ? type : 'unknown'
  });
}

function intersectsAnyRange(ranges, from, to) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return false;
  }

  return ranges.some(
    (range) =>
      Number.isFinite(range?.from) &&
      Number.isFinite(range?.to) &&
      from < range.to &&
      to > range.from
  );
}

function pushInlineCodeSpans(line, spans, blockedRanges) {
  const pattern = /`([^`\n]+)`/g;
  for (const match of line.matchAll(pattern)) {
    const full = match[0] ?? '';
    const content = match[1] ?? '';
    const index = Number(match.index);
    if (!full || !content || !Number.isFinite(index)) {
      continue;
    }

    const from = index;
    const to = from + full.length;
    if (to <= from || intersectsAnyRange(blockedRanges, from, to)) {
      continue;
    }

    blockedRanges.push({ from, to });
    pushInlineSpan(spans, from + 1, to - 1, 'inline-code');
  }
}

function pushInlineLinkSpans(line, spans, blockedRanges) {
  const pattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  for (const match of line.matchAll(pattern)) {
    const full = match[0] ?? '';
    const label = match[1] ?? '';
    const url = match[2] ?? '';
    const index = Number(match.index);
    if (!full || !label || !url || !Number.isFinite(index)) {
      continue;
    }

    const from = index;
    const to = from + full.length;
    if (to <= from || intersectsAnyRange(blockedRanges, from, to)) {
      continue;
    }

    blockedRanges.push({ from, to });
    const labelFrom = from + 1;
    const labelTo = labelFrom + label.length;
    const urlFrom = labelTo + 2;
    const urlTo = urlFrom + url.length;
    pushInlineSpan(spans, labelFrom, labelTo, 'link-label');
    pushInlineSpan(spans, urlFrom, urlTo, 'link-url');
  }
}

function pushWikiLinkSpans(line, spans, blockedRanges) {
  const pattern = /(!)?\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;
  for (const match of line.matchAll(pattern)) {
    const full = match[0] ?? '';
    const isEmbed = match[1] === '!';
    const target = match[2] ?? '';
    const alias = match[3] ?? '';
    const index = Number(match.index);
    if (!full || !target || !Number.isFinite(index)) {
      continue;
    }

    const from = index;
    const to = from + full.length;
    if (to <= from || intersectsAnyRange(blockedRanges, from, to)) {
      continue;
    }

    blockedRanges.push({ from, to });

    // ![[target|alias]]
    // 0123456789...
    // target starts after ![[ (or [[), alias starts after '|'
    const tokenOffset = isEmbed ? 3 : 2;
    const targetFrom = from + tokenOffset;
    const targetTo = targetFrom + target.length;
    pushInlineSpan(spans, targetFrom, targetTo, isEmbed ? 'embed-target' : 'wikilink-target');
    if (alias) {
      const aliasFrom = targetTo + 1;
      const aliasTo = aliasFrom + alias.length;
      pushInlineSpan(spans, aliasFrom, aliasTo, isEmbed ? 'embed-alias' : 'wikilink-alias');
    }
    pushInlineSpan(spans, from, to, isEmbed ? 'embed' : 'wikilink');
  }
}

function pushInlineStrongSpans(line, spans, blockedRanges) {
  const patterns = [/\*\*([^\n*]+)\*\*/g, /__([^\n_]+)__/g];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      const full = match[0] ?? '';
      const content = match[1] ?? '';
      const index = Number(match.index);
      if (!full || !content || !Number.isFinite(index)) {
        continue;
      }

      const from = index;
      const to = from + full.length;
      if (to <= from || intersectsAnyRange(blockedRanges, from, to)) {
        continue;
      }

      blockedRanges.push({ from, to });
      pushInlineSpan(spans, from + 2, to - 2, 'strong');
    }
  }
}

function pushInlineEmphasisSpans(line, spans, blockedRanges) {
  const patterns = [
    /(^|[^*])\*([^*\n]+)\*(?!\*)/g,
    /(^|[^_])_([^_\n]+)_(?!_)/g
  ];

  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      const prefix = match[1] ?? '';
      const content = match[2] ?? '';
      const full = match[0] ?? '';
      const index = Number(match.index);
      if (!full || !content || !Number.isFinite(index)) {
        continue;
      }

      const markerFrom = index + prefix.length;
      const markerTo = markerFrom + content.length + 2;
      if (markerTo <= markerFrom || intersectsAnyRange(blockedRanges, markerFrom, markerTo)) {
        continue;
      }

      blockedRanges.push({ from: markerFrom, to: markerTo });
      pushInlineSpan(spans, markerFrom + 1, markerTo - 1, 'emphasis');
    }
  }
}

function buildInlineSpansForSource(source, offset = 0) {
  const text = typeof source === 'string' ? source : '';
  if (!text) {
    return [];
  }

  const spans = [];
  const blockedRanges = [];
  pushWikiLinkSpans(text, spans, blockedRanges);
  pushInlineCodeSpans(text, spans, blockedRanges);
  pushInlineLinkSpans(text, spans, blockedRanges);
  pushInlineStrongSpans(text, spans, blockedRanges);
  pushInlineEmphasisSpans(text, spans, blockedRanges);

  return spans
    .map((span) => ({
      ...span,
      from: span.from + offset,
      to: span.to + offset
    }))
    .sort((left, right) => left.from - right.from || left.to - right.to);
}

export function buildInlineSpansForBlocks(source, blocks = []) {
  const text = typeof source === 'string' ? source : '';
  if (!Array.isArray(blocks) || blocks.length === 0 || text.length === 0) {
    return [];
  }

  const spans = [];
  for (const block of blocks) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }

    const from = Math.max(0, Math.trunc(block.from));
    const to = Math.min(text.length, Math.max(from, Math.trunc(block.to)));
    if (to <= from) {
      continue;
    }

    const blockSource = text.slice(from, to);
    spans.push(...buildInlineSpansForSource(blockSource, from));
  }

  spans.sort((left, right) => left.from - right.from || left.to - right.to);
  return spans;
}
