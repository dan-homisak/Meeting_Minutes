import DOMPurify from 'dompurify';

function escapeHtml(value) {
  const text = typeof value === 'string' ? value : '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractLeadingFrontmatter(source) {
  const text = typeof source === 'string' ? source : '';
  if (!text.startsWith('---\n')) {
    return null;
  }

  const closingFenceMatch = text.match(/\n---(?:\n|$)/);
  if (!closingFenceMatch || !Number.isFinite(closingFenceMatch.index)) {
    return null;
  }

  const closingStart = closingFenceMatch.index;
  const totalLength = closingStart + closingFenceMatch[0].length;
  const raw = text.slice(0, totalLength);
  const body = raw
    .replace(/^---\n/, '')
    .replace(/\n---(?:\n|$)$/, '')
    .replace(/\n$/, '');

  return {
    raw,
    body,
    totalLength
  };
}

function renderFrontmatterHtml(frontmatter, options = null) {
  if (!frontmatter || typeof frontmatter.body !== 'string') {
    return '';
  }

  const lines = frontmatter.body.split('\n');
  const sourceFrom = Number(options?.sourceFrom);
  const sourceTo = Number(options?.sourceTo);
  const hasSourceBounds = Number.isFinite(sourceFrom) && Number.isFinite(sourceTo) && sourceTo > sourceFrom;
  const sourceAttrs = hasSourceBounds
    ? ` data-src-from="${Math.trunc(sourceFrom)}" data-src-to="${Math.trunc(sourceTo)}"`
    : '';

  const entries = lines
    .map((line, index) => {
      const keyValueMatch = line.match(/^([^:]+):(.*)$/);
      if (!keyValueMatch) {
        return `<div class="frontmatter-entry frontmatter-entry-raw"><span class="frontmatter-value">${escapeHtml(line)}</span></div>`;
      }

      const key = keyValueMatch[1].trim();
      const value = keyValueMatch[2].trim();
      return `<div class="frontmatter-entry" data-frontmatter-line="${index + 1}"><span class="frontmatter-key">${escapeHtml(key)}</span><span class="frontmatter-separator">:</span><span class="frontmatter-value">${escapeHtml(value)}</span></div>`;
    })
    .join('');

  return `<section class="frontmatter-block"${sourceAttrs}><div class="frontmatter-label">Frontmatter</div>${entries}</section>`;
}

function transformObsidianSyntax(markdownText) {
  const source = typeof markdownText === 'string' ? markdownText : '';
  if (!source) {
    return source;
  }

  const replaceWikiLike = (match, bangPrefix, targetRaw, aliasRaw) => {
    const target = (targetRaw ?? '').trim();
    const alias = (aliasRaw ?? '').trim();
    if (!target) {
      return match;
    }

    const label = alias || target;
    const isImageEmbed = Boolean(
      bangPrefix &&
      /\.(png|jpg|jpeg|gif|svg|webp|avif)$/i.test(target)
    );

    if (isImageEmbed) {
      return `![${label}](${target})`;
    }

    const href = `#${encodeURIComponent(target)}`;
    return `[${label}](${href})`;
  };

  return source.replace(/(!)?\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g, replaceWikiLike);
}

function renderInlineMarkdown(markdownEngine, markdownText) {
  const source = typeof markdownText === 'string' ? markdownText : '';
  if (!source) {
    return '';
  }

  const transformed = transformObsidianSyntax(source);
  if (markdownEngine && typeof markdownEngine.renderInline === 'function') {
    return markdownEngine.renderInline(transformed);
  }

  return escapeHtml(source);
}

function renderListLikeBlock(markdownText, options = null, markdownEngine = null) {
  const source = typeof markdownText === 'string' ? markdownText.replace(/\n+$/, '') : '';
  const blockType = options?.blockType;
  if (!source || (blockType !== 'list' && blockType !== 'task')) {
    return null;
  }

  const sourceFrom = Number(options?.sourceFrom);
  const sourceTo = Number(options?.sourceTo);
  const hasSourceBounds = Number.isFinite(sourceFrom) && Number.isFinite(sourceTo) && sourceTo > sourceFrom;
  const sourceAttrs = hasSourceBounds
    ? ` data-src-from="${Math.trunc(sourceFrom)}" data-src-to="${Math.trunc(sourceTo)}"`
    : '';

  const baseDepth = Number.isFinite(options?.blockDepth)
    ? Math.max(0, Math.trunc(options.blockDepth))
    : Number.isFinite(options?.blockAttrs?.depth)
      ? Math.max(0, Math.trunc(options.blockAttrs.depth))
      : 0;
  const depthAttr = ` data-list-depth="${baseDepth}"`;

  const taskMatch = source.match(/^(\s*)([-+*]|\d+\.)\s+\[( |x|X)\](?:\s+(.*))?$/);
  if (taskMatch) {
    const checked = String(taskMatch[3] ?? '').toLowerCase() === 'x';
    const contentHtml = renderInlineMarkdown(markdownEngine, taskMatch[4] ?? '');
    const taskSourceAttr = Number.isFinite(sourceFrom)
      ? ` data-task-source-from="${Math.trunc(sourceFrom)}"`
      : '';
    const checkedAttr = checked ? ' checked' : '';
    return `<div class="mm-live-list-row task-list-item"${depthAttr}${sourceAttrs}><label class="task-list-control"><input type="checkbox"${taskSourceAttr}${checkedAttr}><span class="task-list-content">${contentHtml}</span></label></div>`;
  }

  const listMatch = source.match(/^(\s*)([-+*]|\d+\.)(?:\s+(.*))?$/);
  if (!listMatch) {
    return null;
  }

  const marker = listMatch[2] ?? '-';
  const bullet = /^\d+\.$/.test(marker) ? marker : '&bull;';
  const contentHtml = renderInlineMarkdown(markdownEngine, listMatch[3] ?? '');
  return `<div class="mm-live-list-row"${depthAttr}${sourceAttrs}><span class="list-bullet">${bullet}</span><span class="list-content">${contentHtml}</span></div>`;
}

function createSanitizer() {
  if (typeof DOMPurify?.sanitize === 'function') {
    return DOMPurify;
  }

  if (typeof window !== 'undefined' && typeof DOMPurify === 'function') {
    try {
      const instance = DOMPurify(window);
      if (instance && typeof instance.sanitize === 'function') {
        return instance;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function augmentTaskListHtml(renderedHtml, options = null) {
  const html = typeof renderedHtml === 'string' ? renderedHtml : '';
  if (!html) {
    return html;
  }

  const fallbackSourceFrom = Number(options?.sourceFrom);
  let taskIndex = 0;

  function addTaskListClassToOpenTag(openTag) {
    if (typeof openTag !== 'string' || openTag.length === 0) {
      return '<li class="task-list-item">';
    }

    if (!openTag.startsWith('<li')) {
      return openTag;
    }

    const classMatch = openTag.match(/\bclass="([^"]*)"/i);
    if (classMatch) {
      const classValue = classMatch[1];
      if (/\btask-list-item\b/.test(classValue)) {
        return openTag;
      }
      return openTag.replace(/\bclass="([^"]*)"/i, `class="${classValue} task-list-item"`);
    }

    return openTag.replace('<li', '<li class="task-list-item"');
  }

  function findMatchingListItemClose(input, openTagStart) {
    if (typeof input !== 'string' || !Number.isFinite(openTagStart) || openTagStart < 0) {
      return null;
    }

    const liTagPattern = /<\/?li\b[^>]*>/gi;
    liTagPattern.lastIndex = openTagStart;
    let depth = 0;

    for (let match = liTagPattern.exec(input); match; match = liTagPattern.exec(input)) {
      const tag = match[0];
      const closing = tag.startsWith('</');
      if (!closing) {
        depth += 1;
        continue;
      }

      depth -= 1;
      if (depth === 0) {
        return {
          closeTagStart: match.index,
          closeTagEnd: liTagPattern.lastIndex
        };
      }
    }

    return null;
  }

  const segments = [];
  let cursor = 0;

  while (cursor < html.length) {
    const listItemStart = html.indexOf('<li', cursor);
    if (listItemStart < 0) {
      segments.push(html.slice(cursor));
      break;
    }

    const openTagEnd = html.indexOf('>', listItemStart);
    if (openTagEnd < 0) {
      segments.push(html.slice(cursor));
      break;
    }

    const bounds = findMatchingListItemClose(html, listItemStart);
    if (!bounds) {
      segments.push(html.slice(cursor));
      break;
    }

    const openTag = html.slice(listItemStart, openTagEnd + 1);
    const innerHtml = html.slice(openTagEnd + 1, bounds.closeTagStart);
    const markerMatch = innerHtml.match(/^(\s*)\[( |x|X)\]\s+([\s\S]*)$/);
    const paragraphMarkerMatch = markerMatch
      ? null
      : innerHtml.match(/^(\s*)<p>\s*\[( |x|X)\]\s+([\s\S]*?)<\/p>([\s\S]*)$/i);
    const taskMatch = markerMatch ?? paragraphMarkerMatch;

    segments.push(html.slice(cursor, listItemStart));

    if (!taskMatch) {
      segments.push(html.slice(listItemStart, bounds.closeTagEnd));
      cursor = bounds.closeTagEnd;
      continue;
    }

    const leadingWhitespace = taskMatch[1] ?? '';
    const marker = taskMatch[2] ?? ' ';
    const content = markerMatch
      ? (taskMatch[3] ?? '')
      : `${taskMatch[3] ?? ''}${taskMatch[4] ?? ''}`;
    const nestedListIndex = content.search(/\n?\s*<(ul|ol)\b/i);
    const contentText = nestedListIndex >= 0 ? content.slice(0, nestedListIndex) : content;
    const nestedListHtml = nestedListIndex >= 0 ? content.slice(nestedListIndex) : '';

    const sourceFromMatch = openTag.match(/\sdata-src-from="(\d+)"/i);
    const sourceFrom = sourceFromMatch
      ? Number(sourceFromMatch[1])
      : Number.isFinite(fallbackSourceFrom)
        ? fallbackSourceFrom + taskIndex
        : Number.NaN;

    const taskSourceAttr = Number.isFinite(sourceFrom)
      ? ` data-task-source-from="${Math.trunc(sourceFrom)}"`
      : '';

    const checked = marker.toLowerCase() === 'x';
    const checkedAttr = checked ? ' checked' : '';
    taskIndex += 1;

    const listItemOpen = addTaskListClassToOpenTag(openTag);
    const replacementInner = `${leadingWhitespace}<label class="task-list-control"><input type="checkbox"${taskSourceAttr}${checkedAttr}><span class="task-list-content">${contentText}</span></label>${nestedListHtml}`;
    segments.push(`${listItemOpen}${replacementInner}</li>`);
    cursor = bounds.closeTagEnd;
  }

  return segments.join('');
}

export function createMarkdownRenderer({
  markdownEngine,
  annotateMarkdownTokensWithSourceRanges
} = {}) {
  const sanitizer = createSanitizer();

  function sanitizeHtml(html) {
    if (!sanitizer || typeof sanitizer.sanitize !== 'function') {
      return html;
    }

    return sanitizer.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['data-task-source-from', 'data-src-from', 'data-src-to', 'data-list-depth']
    });
  }

  function renderMarkdownHtml(markdownText, options = null) {
    const listLikeRendered = renderListLikeBlock(markdownText, options, markdownEngine);
    if (typeof listLikeRendered === 'string') {
      return sanitizeHtml(listLikeRendered);
    }

    const transformedText = transformObsidianSyntax(markdownText);
    const sourceFrom = Number(options?.sourceFrom);
    const sourceTo = Number(options?.sourceTo);
    const shouldAnnotateSourceRanges = Number.isFinite(sourceFrom) && Number.isFinite(sourceTo);

    const frontmatter = extractLeadingFrontmatter(transformedText);
    const contentWithoutFrontmatter = frontmatter
      ? transformedText.slice(frontmatter.totalLength)
      : transformedText;

    const frontmatterHtml = frontmatter
      ? renderFrontmatterHtml(frontmatter, {
        sourceFrom,
        sourceTo: shouldAnnotateSourceRanges
          ? Math.min(sourceTo, sourceFrom + frontmatter.totalLength)
          : sourceFrom + frontmatter.totalLength
      })
      : '';

    const markdownSourceFrom = shouldAnnotateSourceRanges && frontmatter
      ? Math.min(sourceTo, sourceFrom + frontmatter.totalLength)
      : sourceFrom;

    let rendered = '';
    if (shouldAnnotateSourceRanges && markdownEngine && typeof markdownEngine.parse === 'function') {
      const tokens = markdownEngine.parse(contentWithoutFrontmatter, {});
      if (typeof annotateMarkdownTokensWithSourceRanges === 'function') {
        annotateMarkdownTokensWithSourceRanges(tokens, contentWithoutFrontmatter, markdownSourceFrom, sourceTo);
      }
      rendered = markdownEngine.renderer.render(tokens, markdownEngine.options, {});
    } else if (markdownEngine && typeof markdownEngine.render === 'function') {
      rendered = markdownEngine.render(contentWithoutFrontmatter);
    }

    const taskAugmented = augmentTaskListHtml(rendered, options);
    return sanitizeHtml(frontmatterHtml + taskAugmented);
  }

  return {
    renderMarkdownHtml
  };
}
