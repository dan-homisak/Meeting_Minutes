export function lineIndexToPos(doc, lineIndex) {
  if (lineIndex <= 0) {
    return 0;
  }

  if (lineIndex >= doc.lines) {
    return doc.length;
  }

  return doc.line(lineIndex + 1).from;
}

export function collectTopLevelBlocksFromTokens(doc, tokens) {
  const candidateBlocks = [];
  const seen = new Set();

  for (const token of tokens) {
    if (!token.block || !token.map || token.level !== 0 || token.nesting === -1) {
      continue;
    }

    const [startLine, endLine] = token.map;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || endLine <= startLine) {
      continue;
    }

    const key = `${startLine}:${endLine}`;
    if (seen.has(key)) {
      continue;
    }

    const from = lineIndexToPos(doc, startLine);
    const to = lineIndexToPos(doc, endLine);
    if (to <= from) {
      continue;
    }

    const source = doc.sliceString(from, to);
    if (!source.trim()) {
      continue;
    }

    candidateBlocks.push({ from, to });
    seen.add(key);
  }

  candidateBlocks.sort((a, b) => a.from - b.from || a.to - b.to);

  const mergedBlocks = [];
  for (const block of candidateBlocks) {
    const previous = mergedBlocks[mergedBlocks.length - 1];
    if (!previous) {
      mergedBlocks.push({ ...block });
      continue;
    }

    if (block.from < previous.to) {
      if (block.to > previous.to) {
        previous.to = block.to;
      }
      continue;
    }

    mergedBlocks.push({ ...block });
  }

  return mergedBlocks;
}

export function collectTopLevelBlocks(doc, parseTokens) {
  const tokens = parseTokens(doc.toString());
  return collectTopLevelBlocksFromTokens(doc, tokens);
}
