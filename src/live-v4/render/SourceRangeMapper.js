export function buildLineStartOffsets(source) {
  if (typeof source !== 'string') {
    return [0];
  }

  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      offsets.push(index + 1);
    }
  }

  if (offsets[offsets.length - 1] !== source.length) {
    offsets.push(source.length);
  }

  return offsets;
}

function resolveSourceRangeFromTokenMap(tokenMap, lineStartOffsets, sourceFrom, sourceTo = null) {
  if (
    !Array.isArray(tokenMap) ||
    tokenMap.length < 2 ||
    !Array.isArray(lineStartOffsets) ||
    lineStartOffsets.length < 2 ||
    !Number.isFinite(sourceFrom)
  ) {
    return null;
  }

  const lineCount = lineStartOffsets.length - 1;
  const rawStartLine = Number(tokenMap[0]);
  const rawEndLine = Number(tokenMap[1]);
  if (!Number.isFinite(rawStartLine) || !Number.isFinite(rawEndLine)) {
    return null;
  }

  if (rawStartLine < 0 || rawStartLine >= lineCount || rawEndLine <= rawStartLine) {
    return null;
  }

  const startLine = Math.min(lineCount, Math.max(0, Math.trunc(rawStartLine)));
  const endLineExclusive = Math.min(lineCount, Math.max(startLine + 1, Math.trunc(rawEndLine)));
  const startOffset = lineStartOffsets[startLine];
  const endOffset = lineStartOffsets[endLineExclusive];
  if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset <= startOffset) {
    return null;
  }

  const absoluteFrom = sourceFrom + startOffset;
  const absoluteUnboundedTo = sourceFrom + endOffset;
  const resolvedSourceTo = Number.isFinite(sourceTo) ? Math.max(sourceFrom, sourceTo) : null;
  const absoluteTo = Number.isFinite(resolvedSourceTo)
    ? Math.min(resolvedSourceTo, absoluteUnboundedTo)
    : absoluteUnboundedTo;

  if (!Number.isFinite(absoluteFrom) || !Number.isFinite(absoluteTo) || absoluteTo <= absoluteFrom) {
    return null;
  }

  return {
    from: absoluteFrom,
    to: absoluteTo,
    startLine,
    endLineExclusive
  };
}

export function annotateMarkdownTokensWithSourceRanges(tokens, source, sourceFrom, sourceTo = null) {
  if (!Array.isArray(tokens) || !Number.isFinite(sourceFrom)) {
    return {
      annotatedCount: 0,
      skippedCount: Array.isArray(tokens) ? tokens.length : 0
    };
  }

  const lineStartOffsets = buildLineStartOffsets(source);
  let annotatedCount = 0;
  let skippedCount = 0;

  for (const token of tokens) {
    if (!token || token.nesting === -1 || !Array.isArray(token.map)) {
      skippedCount += 1;
      continue;
    }

    const sourceRange = resolveSourceRangeFromTokenMap(
      token.map,
      lineStartOffsets,
      sourceFrom,
      sourceTo
    );

    if (!sourceRange) {
      skippedCount += 1;
      continue;
    }

    if (typeof token.attrSet === 'function') {
      token.attrSet('data-src-from', String(sourceRange.from));
      token.attrSet('data-src-to', String(sourceRange.to));
      annotatedCount += 1;
      continue;
    }

    skippedCount += 1;
  }

  return {
    annotatedCount,
    skippedCount
  };
}
