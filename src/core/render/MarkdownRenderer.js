import DOMPurify from 'dompurify';
import { extractLeadingFrontmatter } from '../model/BlockSemantics.js';

export function createMarkdownRenderer({
  markdownEngine,
  previewElement,
  annotateMarkdownTokensWithSourceRanges
} = {}) {
  function escapeHtml(value) {
    const text = typeof value === 'string' ? value : '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  const sanitizerInstance = (() => {
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
  })();

  function sanitizeHtml(rendered) {
    if (sanitizerInstance && typeof sanitizerInstance.sanitize === 'function') {
      return sanitizerInstance.sanitize(rendered, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['data-task-source-from', 'data-src-from', 'data-src-to']
      });
    }

    return rendered;
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

      const classMatch = openTag.match(/\bclass=\"([^\"]*)\"/i);
      if (classMatch) {
        const classValue = classMatch[1];
        if (/\btask-list-item\b/.test(classValue)) {
          return openTag;
        }
        return openTag.replace(
          /\bclass=\"([^\"]*)\"/i,
          `class="${classValue} task-list-item"`
        );
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

      segments.push(html.slice(cursor, listItemStart));

      if (!markerMatch) {
        segments.push(html.slice(listItemStart, bounds.closeTagEnd));
        cursor = bounds.closeTagEnd;
        continue;
      }

      const leadingWhitespace = markerMatch[1] ?? '';
      const marker = markerMatch[2] ?? ' ';
      const content = markerMatch[3] ?? '';
      const nestedListIndex = content.search(/\n?\s*<(ul|ol)\b/i);
      const contentText = nestedListIndex >= 0 ? content.slice(0, nestedListIndex) : content;
      const nestedListHtml = nestedListIndex >= 0 ? content.slice(nestedListIndex) : '';
      const sourceFromMatch = openTag.match(/\sdata-src-from=\"(\d+)\"/i);
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

  function renderMarkdownHtml(markdownText, options = null) {
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
    if (shouldAnnotateSourceRanges) {
      const tokens = markdownEngine.parse(contentWithoutFrontmatter, {});
      if (typeof annotateMarkdownTokensWithSourceRanges === 'function') {
        annotateMarkdownTokensWithSourceRanges(tokens, contentWithoutFrontmatter, markdownSourceFrom, sourceTo);
      }
      rendered = markdownEngine.renderer.render(tokens, markdownEngine.options, {});
    } else {
      rendered = markdownEngine.render(contentWithoutFrontmatter);
    }

    const taskAugmented = augmentTaskListHtml(rendered, options);
    return sanitizeHtml(frontmatterHtml + taskAugmented);
  }

  function renderPreview(markdownText, options = null) {
    const rendered = renderMarkdownHtml(markdownText, options);

    if (previewElement) {
      previewElement.innerHTML = rendered;
    }

    return rendered;
  }

  return {
    renderMarkdownHtml,
    renderPreview
  };
}
