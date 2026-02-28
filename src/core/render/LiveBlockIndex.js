import {
  blockContainsLine,
  isFencedCodeBlock
} from './LiveBlockHelpers.js';

function firstMeaningfulLineInBlock(doc, block) {
  if (!doc || !block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
    return null;
  }

  const start = Math.max(0, Math.min(block.from, block.to));
  const end = Math.min(doc.length, Math.max(block.from, block.to));
  if (end <= start) {
    return null;
  }

  let cursor = start;
  while (cursor < end) {
    const line = doc.lineAt(cursor);
    const lineText = doc.sliceString(line.from, line.to);
    if (lineText.trim().length > 0) {
      return {
        line,
        text: lineText
      };
    }

    cursor = line.to + 1;
  }

  return null;
}

function detectListLikeLine(text) {
  return /^\s*(?:[-+*]\s+|\d+\.\s+)/.test(text);
}

function detectHeadingLikeLine(text) {
  return /^\s{0,3}#{1,6}\s+/.test(text);
}

function detectQuoteLikeLine(text) {
  return /^\s*>\s?/.test(text);
}

function detectTableLikeLines(currentLineText, nextLineText) {
  if (typeof currentLineText !== 'string' || !currentLineText.includes('|')) {
    return false;
  }

  if (typeof nextLineText !== 'string') {
    return false;
  }

  return /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(nextLineText.trim());
}

export function detectLiveBlockType(doc, block) {
  if (isFencedCodeBlock(doc, block)) {
    return 'fence';
  }

  const firstLine = firstMeaningfulLineInBlock(doc, block);
  if (!firstLine) {
    return 'unknown';
  }

  const { line, text } = firstLine;
  if (detectHeadingLikeLine(text)) {
    return 'heading';
  }

  if (detectListLikeLine(text)) {
    return 'list';
  }

  if (detectQuoteLikeLine(text)) {
    return 'blockquote';
  }

  const nextLineNumber = Math.min(doc.lines, line.number + 1);
  const nextLineText = nextLineNumber > line.number
    ? doc.sliceString(doc.line(nextLineNumber).from, doc.line(nextLineNumber).to)
    : '';
  if (detectTableLikeLines(text, nextLineText)) {
    return 'table';
  }

  return 'paragraph';
}

export function buildLiveBlockIndex(doc, blocks) {
  if (!doc || !Array.isArray(blocks) || blocks.length === 0) {
    return [];
  }

  const index = [];
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }

    const from = Math.max(0, Math.min(block.from, block.to));
    const to = Math.min(doc.length, Math.max(block.from, block.to));
    if (to <= from) {
      continue;
    }

    const startLine = doc.lineAt(from);
    const endLine = doc.lineAt(Math.max(from, to - 1));
    const type = detectLiveBlockType(doc, { from, to });
    index.push({
      index: blockIndex,
      id: `${blockIndex}:${from}-${to}:${type}`,
      from,
      to,
      type,
      startLineNumber: startLine.number,
      endLineNumber: endLine.number,
      lineCount: Math.max(1, endLine.number - startLine.number + 1)
    });
  }

  return index;
}

export function findIndexedBlockAtPosition(blockIndex, position) {
  if (!Array.isArray(blockIndex) || !Number.isFinite(position)) {
    return null;
  }

  for (const entry of blockIndex) {
    if (!entry || !Number.isFinite(entry.from) || !Number.isFinite(entry.to)) {
      continue;
    }

    if (position >= entry.from && position < entry.to) {
      return entry;
    }
  }

  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const entry of blockIndex) {
    if (!entry || !Number.isFinite(entry.from) || !Number.isFinite(entry.to)) {
      continue;
    }

    const max = entry.to > entry.from ? entry.to - 1 : entry.from;
    const distance = position < entry.from
      ? entry.from - position
      : position > max
        ? position - max
        : 0;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = entry;
    }
  }

  if (nearest && nearestDistance <= 1) {
    return nearest;
  }

  return null;
}

export function findBlockContainingPosition(blocks, position) {
  if (!Array.isArray(blocks) || !Number.isFinite(position)) {
    return null;
  }

  for (const block of blocks) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }

    const from = Math.min(block.from, block.to);
    const to = Math.max(block.from, block.to);
    if (position >= from && position < to) {
      return block;
    }
  }

  return null;
}

export function readFenceVisibilityState(doc, blocks, selectionHead) {
  if (!doc || !Array.isArray(blocks)) {
    return {
      insideFence: false,
      activeLineNumber: null,
      blockFrom: null,
      blockTo: null,
      openingFenceLineNumber: null,
      closingFenceLineNumber: null,
      openingFenceVisible: false,
      closingFenceVisible: false
    };
  }

  const clampedSelectionHead = Math.max(0, Math.min(doc.length, Number(selectionHead) || 0));
  const activeLine = doc.lineAt(clampedSelectionHead);
  const blockForLine = blocks.find((candidate) => blockContainsLine(candidate, activeLine)) ??
    findBlockContainingPosition(blocks, clampedSelectionHead);

  if (!blockForLine || !isFencedCodeBlock(doc, blockForLine)) {
    return {
      insideFence: false,
      activeLineNumber: activeLine.number,
      blockFrom: blockForLine?.from ?? null,
      blockTo: blockForLine?.to ?? null,
      openingFenceLineNumber: null,
      closingFenceLineNumber: null,
      openingFenceVisible: false,
      closingFenceVisible: false
    };
  }

  const openingFenceLine = doc.lineAt(blockForLine.from);
  const closingFenceLine = doc.lineAt(Math.max(blockForLine.from, blockForLine.to - 1));
  const insideFence = (
    activeLine.number >= openingFenceLine.number &&
    activeLine.number <= closingFenceLine.number
  );

  // In hybrid live mode, fence markers remain part of editable source lines.
  return {
    insideFence,
    activeLineNumber: activeLine.number,
    blockFrom: blockForLine.from,
    blockTo: blockForLine.to,
    openingFenceLineNumber: openingFenceLine.number,
    closingFenceLineNumber: closingFenceLine.number,
    openingFenceVisible: true,
    closingFenceVisible: true
  };
}
