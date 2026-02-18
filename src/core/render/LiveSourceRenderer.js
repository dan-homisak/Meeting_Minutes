function parseFenceMarker(lineText) {
  if (typeof lineText !== 'string') {
    return null;
  }

  const match = lineText.match(/^\s*([`~]{3,})/);
  if (!match) {
    return null;
  }

  const marker = match[1];
  return {
    marker,
    markerChar: marker[0],
    markerLength: marker.length,
    markerIndex: lineText.indexOf(marker)
  };
}

function pushTokenSpan(tokenSpans, fromOffset, toOffset, className) {
  if (!Array.isArray(tokenSpans) || !Number.isFinite(fromOffset) || !Number.isFinite(toOffset)) {
    return;
  }

  const from = Math.max(0, Math.trunc(fromOffset));
  const to = Math.max(from, Math.trunc(toOffset));
  if (to <= from) {
    return;
  }

  tokenSpans.push({
    fromOffset: from,
    toOffset: to,
    className
  });
}

export function computeFenceStateByLine(doc) {
  const states = [];
  if (!doc || !Number.isFinite(doc.lines) || doc.lines <= 0) {
    return states;
  }

  let openFence = null;
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const lineText = doc.sliceString(line.from, line.to);
    const marker = parseFenceMarker(lineText);
    const state = {
      lineNumber,
      insideFence: false,
      markerLine: false,
      openingFenceLineNumber: null,
      closingFenceLineNumber: null,
      markerFromOffset: null,
      markerToOffset: null
    };

    if (!openFence) {
      if (marker) {
        openFence = {
          markerChar: marker.markerChar,
          markerLength: marker.markerLength,
          lineNumber
        };
        state.insideFence = true;
        state.markerLine = true;
        state.openingFenceLineNumber = lineNumber;
        state.markerFromOffset = marker.markerIndex;
        state.markerToOffset = marker.markerIndex + marker.markerLength;
      }
      states.push(state);
      continue;
    }

    state.insideFence = true;
    state.openingFenceLineNumber = openFence.lineNumber;

    if (
      marker &&
      marker.markerChar === openFence.markerChar &&
      marker.markerLength >= openFence.markerLength
    ) {
      state.markerLine = true;
      state.closingFenceLineNumber = lineNumber;
      state.markerFromOffset = marker.markerIndex;
      state.markerToOffset = marker.markerIndex + marker.markerLength;
      openFence = null;
    }

    states.push(state);
  }

  return states;
}

function classifyHeadingLine(lineText, lineClasses, tokenSpans, activeLine) {
  const headingMatch = lineText.match(/^(\s{0,3})(#{1,6})(\s+)/);
  if (!headingMatch) {
    return false;
  }

  const headingLevel = headingMatch[2].length;
  lineClasses.push('cm-live-heading-line');
  lineClasses.push(`cm-live-heading-${headingLevel}`);

  if (!activeLine) {
    const markerStart = headingMatch[1].length;
    const markerEnd = markerStart + headingMatch[2].length;
    pushTokenSpan(tokenSpans, markerStart, markerEnd, 'cm-live-md-token');
  }

  return true;
}

function classifyQuoteLine(lineText, lineClasses, tokenSpans, activeLine) {
  const quoteMatch = lineText.match(/^(\s*>\s?)/);
  if (!quoteMatch) {
    return false;
  }

  lineClasses.push('cm-live-blockquote-line');
  if (!activeLine) {
    pushTokenSpan(tokenSpans, 0, quoteMatch[1].length, 'cm-live-md-token');
  }
  return true;
}

function classifyListLine(lineText, lineClasses, tokenSpans, activeLine) {
  const listMatch = lineText.match(/^(\s*(?:[-+*]|\d+\.)\s+)(\[(?: |x|X)\]\s+)?/);
  if (!listMatch) {
    return false;
  }

  lineClasses.push('cm-live-list-line');
  const taskMarker = listMatch[2] ?? null;
  if (taskMarker) {
    lineClasses.push('cm-live-task-line');
    if (/\[[xX]\]\s+/.test(taskMarker)) {
      lineClasses.push('cm-live-task-checked');
    }
  }

  if (!activeLine) {
    pushTokenSpan(tokenSpans, 0, listMatch[1].length, 'cm-live-md-token');
    if (taskMarker) {
      pushTokenSpan(
        tokenSpans,
        listMatch[1].length,
        listMatch[1].length + taskMarker.length,
        'cm-live-md-token cm-live-task-token'
      );
    }
  }
  return true;
}

function classifyTableLine(lineText, lineClasses) {
  const pipeCount = (lineText.match(/\|/g) ?? []).length;
  if (pipeCount < 2) {
    return false;
  }

  lineClasses.push('cm-live-table-line');
  return true;
}

function rangeIntersectsAny(ranges, fromOffset, toOffset) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return false;
  }

  return ranges.some(
    (range) =>
      Number.isFinite(range?.from) &&
      Number.isFinite(range?.to) &&
      fromOffset < range.to &&
      toOffset > range.from
  );
}

function pushInlineCodeTokenSpans(lineText, tokenSpans, activeLine, blockedRanges) {
  const inlineCodePattern = /`([^`\n]+)`/g;
  for (const match of lineText.matchAll(inlineCodePattern)) {
    const fullMatch = match[0] ?? '';
    const matchIndex = Number(match.index);
    if (!fullMatch || !Number.isFinite(matchIndex)) {
      continue;
    }

    const from = matchIndex;
    const to = from + fullMatch.length;
    if (to <= from || rangeIntersectsAny(blockedRanges, from, to)) {
      continue;
    }

    blockedRanges.push({ from, to });
    const contentFrom = from + 1;
    const contentTo = to - 1;

    if (!activeLine) {
      pushTokenSpan(tokenSpans, from, from + 1, 'cm-live-md-token');
      pushTokenSpan(tokenSpans, contentTo, to, 'cm-live-md-token');
    }

    pushTokenSpan(tokenSpans, contentFrom, contentTo, 'cm-live-inline-code');
  }
}

function pushInlineLinkTokenSpans(lineText, tokenSpans, activeLine, blockedRanges) {
  const inlineLinkPattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  for (const match of lineText.matchAll(inlineLinkPattern)) {
    const fullMatch = match[0] ?? '';
    const linkText = match[1] ?? '';
    const linkUrl = match[2] ?? '';
    const matchIndex = Number(match.index);
    if (!fullMatch || !linkText || !linkUrl || !Number.isFinite(matchIndex)) {
      continue;
    }

    const from = matchIndex;
    const to = from + fullMatch.length;
    if (to <= from || rangeIntersectsAny(blockedRanges, from, to)) {
      continue;
    }

    const linkTextFrom = from + 1;
    const linkTextTo = linkTextFrom + linkText.length;
    const linkUrlFrom = linkTextTo + 2;
    const linkUrlTo = linkUrlFrom + linkUrl.length;

    if (!activeLine) {
      pushTokenSpan(tokenSpans, from, from + 1, 'cm-live-md-token');
      pushTokenSpan(tokenSpans, linkTextTo, linkTextTo + 2, 'cm-live-md-token');
      pushTokenSpan(tokenSpans, linkUrlTo, linkUrlTo + 1, 'cm-live-md-token');
      pushTokenSpan(tokenSpans, linkUrlFrom, linkUrlTo, 'cm-live-link-url cm-live-md-token');
    } else {
      pushTokenSpan(tokenSpans, linkUrlFrom, linkUrlTo, 'cm-live-link-url');
    }

    pushTokenSpan(tokenSpans, linkTextFrom, linkTextTo, 'cm-live-link-text');
  }
}

function pushInlineStrongTokenSpans(lineText, tokenSpans, activeLine, blockedRanges) {
  const strongPatterns = [/\*\*([^\n*]+)\*\*/g, /__([^\n_]+)__/g];
  for (const pattern of strongPatterns) {
    for (const match of lineText.matchAll(pattern)) {
      const fullMatch = match[0] ?? '';
      const content = match[1] ?? '';
      const matchIndex = Number(match.index);
      if (!fullMatch || !content || !Number.isFinite(matchIndex)) {
        continue;
      }

      const from = matchIndex;
      const to = from + fullMatch.length;
      if (to <= from || rangeIntersectsAny(blockedRanges, from, to)) {
        continue;
      }

      blockedRanges.push({ from, to });
      const markerLength = 2;
      const contentFrom = from + markerLength;
      const contentTo = to - markerLength;

      if (!activeLine) {
        pushTokenSpan(tokenSpans, from, from + markerLength, 'cm-live-md-token');
        pushTokenSpan(tokenSpans, to - markerLength, to, 'cm-live-md-token');
      }
      pushTokenSpan(tokenSpans, contentFrom, contentTo, 'cm-live-strong-text');
    }
  }
}

function pushInlineEmphasisTokenSpans(lineText, tokenSpans, activeLine, blockedRanges) {
  const emphasisPatterns = [
    /(^|[^*])\*([^*\n]+)\*(?!\*)/g,
    /(^|[^_])_([^_\n]+)_(?!_)/g
  ];

  for (const pattern of emphasisPatterns) {
    for (const match of lineText.matchAll(pattern)) {
      const prefix = match[1] ?? '';
      const content = match[2] ?? '';
      const fullMatch = match[0] ?? '';
      const matchIndex = Number(match.index);
      if (!fullMatch || !content || !Number.isFinite(matchIndex)) {
        continue;
      }

      const markerFrom = matchIndex + prefix.length;
      const contentFrom = markerFrom + 1;
      const contentTo = contentFrom + content.length;
      const markerTo = contentTo + 1;
      if (markerTo <= markerFrom || rangeIntersectsAny(blockedRanges, markerFrom, markerTo)) {
        continue;
      }

      blockedRanges.push({ from: markerFrom, to: markerTo });
      if (!activeLine) {
        pushTokenSpan(tokenSpans, markerFrom, markerFrom + 1, 'cm-live-md-token');
        pushTokenSpan(tokenSpans, markerTo - 1, markerTo, 'cm-live-md-token');
      }
      pushTokenSpan(tokenSpans, contentFrom, contentTo, 'cm-live-em-text');
    }
  }
}

function classifyInlineMarkdownTokenSpans(lineText, tokenSpans, activeLine) {
  if (!Array.isArray(tokenSpans) || typeof lineText !== 'string' || lineText.length === 0) {
    return;
  }

  const blockedRanges = [];
  pushInlineCodeTokenSpans(lineText, tokenSpans, activeLine, blockedRanges);
  pushInlineLinkTokenSpans(lineText, tokenSpans, activeLine, blockedRanges);
  pushInlineStrongTokenSpans(lineText, tokenSpans, activeLine, blockedRanges);
  pushInlineEmphasisTokenSpans(lineText, tokenSpans, activeLine, blockedRanges);
}

function classifyHrLine(lineText, lineClasses, tokenSpans, activeLine) {
  if (!/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(lineText)) {
    return false;
  }

  lineClasses.push('cm-live-hr-line');
  if (!activeLine) {
    pushTokenSpan(tokenSpans, 0, lineText.length, 'cm-live-md-token');
  }
  return true;
}

export function classifyLiveSourceLine({
  lineText,
  activeLine = false,
  fenceState = null
} = {}) {
  const lineClasses = [];
  const tokenSpans = [];

  if (fenceState?.insideFence) {
    if (fenceState.markerLine) {
      lineClasses.push('cm-live-fence-marker-line');
      if (Number.isFinite(fenceState.markerFromOffset) && Number.isFinite(fenceState.markerToOffset)) {
        pushTokenSpan(
          tokenSpans,
          fenceState.markerFromOffset,
          fenceState.markerToOffset,
          'cm-live-md-token cm-live-fence-token'
        );
      }
    } else {
      lineClasses.push('cm-live-fence-line');
    }

    return {
      lineClasses,
      tokenSpans
    };
  }

  classifyHeadingLine(lineText, lineClasses, tokenSpans, activeLine);
  classifyQuoteLine(lineText, lineClasses, tokenSpans, activeLine);
  classifyListLine(lineText, lineClasses, tokenSpans, activeLine);
  classifyTableLine(lineText, lineClasses);
  classifyHrLine(lineText, lineClasses, tokenSpans, activeLine);
  classifyInlineMarkdownTokenSpans(lineText, tokenSpans, activeLine);

  if (lineClasses.length === 0 && lineText.trim().length > 0) {
    lineClasses.push('cm-live-paragraph-line');
  }

  return {
    lineClasses,
    tokenSpans
  };
}

export function buildSourceFirstDecorationPlan(doc, activeLineNumber) {
  if (!doc || !Number.isFinite(doc.lines) || doc.lines <= 0) {
    return {
      lineDecorations: [],
      tokenDecorations: [],
      fenceStates: [],
      stats: {
        lineDecorationCount: 0,
        tokenDecorationCount: 0,
        headingLineCount: 0,
        paragraphLineCount: 0,
        quoteLineCount: 0,
        listLineCount: 0,
        taskLineCount: 0,
        tableLineCount: 0,
        hrLineCount: 0,
        fenceLineCount: 0,
        fenceMarkerLineCount: 0
      }
    };
  }

  const fenceStates = computeFenceStateByLine(doc);
  const lineDecorations = [];
  const tokenDecorations = [];

  let fenceLineCount = 0;
  let fenceMarkerLineCount = 0;
  let headingLineCount = 0;
  let paragraphLineCount = 0;
  let quoteLineCount = 0;
  let listLineCount = 0;
  let taskLineCount = 0;
  let tableLineCount = 0;
  let hrLineCount = 0;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const lineText = doc.sliceString(line.from, line.to);
    const fenceState = fenceStates[lineNumber - 1] ?? null;
    const activeLine = lineNumber === activeLineNumber;
    const classification = classifyLiveSourceLine({
      lineText,
      activeLine,
      fenceState
    });

    if (fenceState?.insideFence) {
      fenceLineCount += 1;
    }
    if (fenceState?.markerLine) {
      fenceMarkerLineCount += 1;
    }
    if (classification.lineClasses.includes('cm-live-heading-line')) {
      headingLineCount += 1;
    }
    if (classification.lineClasses.includes('cm-live-paragraph-line')) {
      paragraphLineCount += 1;
    }
    if (classification.lineClasses.includes('cm-live-blockquote-line')) {
      quoteLineCount += 1;
    }
    if (classification.lineClasses.includes('cm-live-list-line')) {
      listLineCount += 1;
    }
    if (classification.lineClasses.includes('cm-live-task-line')) {
      taskLineCount += 1;
    }
    if (classification.lineClasses.includes('cm-live-table-line')) {
      tableLineCount += 1;
    }
    if (classification.lineClasses.includes('cm-live-hr-line')) {
      hrLineCount += 1;
    }

    if (classification.lineClasses.length > 0) {
      lineDecorations.push({
        lineNumber,
        className: classification.lineClasses.join(' ')
      });
    }

    for (const tokenSpan of classification.tokenSpans) {
      tokenDecorations.push({
        from: line.from + tokenSpan.fromOffset,
        to: line.from + tokenSpan.toOffset,
        className: tokenSpan.className
      });
    }
  }

  return {
    lineDecorations,
    tokenDecorations,
    fenceStates,
    stats: {
      lineDecorationCount: lineDecorations.length,
      tokenDecorationCount: tokenDecorations.length,
      headingLineCount,
      paragraphLineCount,
      quoteLineCount,
      listLineCount,
      taskLineCount,
      tableLineCount,
      hrLineCount,
      fenceLineCount,
      fenceMarkerLineCount
    }
  };
}
