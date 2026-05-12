import { Decoration, WidgetType } from "@codemirror/view";
import { RenderedBlockWidget } from "./render/WidgetFactory.js";
import { buildLiveProjection } from "./LiveProjection.js";

function clampRangeToDoc(state, from, to) {
  if (!state?.doc || !Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  const max = Math.max(0, Math.trunc(state.doc.length));
  const rangeFrom = Math.max(0, Math.min(max, Math.trunc(from)));
  const rangeTo = Math.max(rangeFrom, Math.min(max, Math.trunc(to)));
  if (rangeTo <= rangeFrom) {
    return null;
  }

  return {
    from: rangeFrom,
    to: rangeTo,
  };
}

function resolveReplacementRange(state, sourceFrom, sourceTo) {
  return clampRangeToDoc(state, sourceFrom, sourceTo);
}

function buildWidgetDecorations(state, renderedBlocks) {
  const decorations = [];
  let previousRangeTo = -1;

  const sortedBlocks = [
    ...(Array.isArray(renderedBlocks) ? renderedBlocks : []),
  ]
    .filter(
      (entry) =>
        entry &&
        Number.isFinite(entry.sourceFrom) &&
        Number.isFinite(entry.sourceTo) &&
        entry.sourceTo > entry.sourceFrom,
    )
    .sort(
      (left, right) =>
        left.sourceFrom - right.sourceFrom || left.sourceTo - right.sourceTo,
    );

  for (const entry of sortedBlocks) {
    const replacement = resolveReplacementRange(
      state,
      entry.sourceFrom,
      entry.sourceTo,
    );
    if (!replacement) {
      continue;
    }

    let rangeFrom = replacement.from;
    const rangeTo = replacement.to;
    if (rangeFrom < previousRangeTo) {
      rangeFrom = previousRangeTo;
    }
    if (rangeTo <= rangeFrom) {
      continue;
    }

    decorations.push(
      Decoration.replace({
        widget: new RenderedBlockWidget({
          html: entry.html,
          fragmentId: entry.fragmentId,
          blockId: entry.blockId,
          sourceFrom: entry.sourceFrom,
          sourceTo: entry.sourceTo,
        }),
        block: false,
        inclusive: false,
      }).range(rangeFrom, rangeTo),
    );

    previousRangeTo = rangeTo;
  }

  return decorations;
}

class InlineListPrefixWidget extends WidgetType {
  constructor({
    markerText = "",
    markerDisplayText = "",
    markerKind = "bullet",
  } = {}) {
    super();
    this.markerText = typeof markerText === "string" ? markerText : "";
    this.markerDisplayText =
      typeof markerDisplayText === "string"
        ? markerDisplayText
        : this.markerText;
    this.markerKind = markerKind === "ordered" ? "ordered" : "bullet";
  }

  eq(other) {
    return (
      other instanceof InlineListPrefixWidget &&
      this.markerText === other.markerText &&
      this.markerDisplayText === other.markerDisplayText &&
      this.markerKind === other.markerKind
    );
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "mm-live-v4-inline-list-prefix";
    wrapper.setAttribute("data-mm-list-kind", this.markerKind);

    const sizer = document.createElement("span");
    sizer.className = "mm-live-v4-inline-prefix-sizer";
    sizer.textContent = this.markerText;

    const display = document.createElement("span");
    display.className = "mm-live-v4-inline-prefix-display";
    display.textContent = this.markerDisplayText;

    wrapper.appendChild(sizer);
    wrapper.appendChild(display);
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

class InlineTaskPrefixWidget extends WidgetType {
  constructor({
    sourceFrom,
    checked = false,
    sizerText = "    ",
    listKind = "bullet",
  } = {}) {
    super();
    this.sourceFrom = sourceFrom;
    this.checked = Boolean(checked);
    this.sizerText =
      typeof sizerText === "string" && sizerText.length > 0
        ? sizerText
        : "    ";
    this.listKind = listKind === "ordered" ? "ordered" : "bullet";
  }

  eq(other) {
    return (
      other instanceof InlineTaskPrefixWidget &&
      this.sourceFrom === other.sourceFrom &&
      this.checked === other.checked &&
      this.sizerText === other.sizerText &&
      this.listKind === other.listKind
    );
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "mm-live-v4-inline-task-prefix";
    wrapper.setAttribute("data-mm-list-kind", this.listKind);

    const sizer = document.createElement("span");
    sizer.className = "mm-live-v4-inline-prefix-sizer";
    sizer.textContent = this.sizerText;

    const display = document.createElement("span");
    display.className = "mm-live-v4-inline-task-display";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.setAttribute("data-task-source-from", String(this.sourceFrom));

    display.appendChild(checkbox);

    wrapper.appendChild(sizer);
    wrapper.appendChild(display);
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

class FrontmatterLabelWidget extends WidgetType {
  eq(other) {
    return other instanceof FrontmatterLabelWidget;
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "mm-live-v4-frontmatter-label-pill";
    wrapper.textContent = "Properties";
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

class InlineImagePlaceholderWidget extends WidgetType {
  constructor({ label = "", source = "" } = {}) {
    super();
    this.label =
      typeof label === "string" && label.trim().length > 0
        ? label.trim()
        : "image";
    this.source = typeof source === "string" ? source.trim() : "";
  }

  eq(other) {
    return (
      other instanceof InlineImagePlaceholderWidget &&
      this.label === other.label &&
      this.source === other.source
    );
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className =
      "mm-live-v4-image-placeholder mm-live-v4-inline-image-placeholder";
    wrapper.textContent = this.label;
    if (this.source) {
      wrapper.setAttribute("title", this.source);
    }
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

function extractCopyTextForCodeBlock(state, sourceFrom, sourceTo) {
  if (
    !state?.doc ||
    !Number.isFinite(sourceFrom) ||
    !Number.isFinite(sourceTo) ||
    sourceTo <= sourceFrom
  ) {
    return "";
  }

  const source = state.doc.sliceString(sourceFrom, sourceTo);
  const lines = source.split("\n");
  if (lines.length < 2) {
    return source;
  }

  const firstTrimmed = String(lines[0] ?? "").trimStart();
  const lastTrimmed = String(lines[lines.length - 1] ?? "").trimStart();
  const firstFenceMatch = firstTrimmed.match(/^([`~]{3,})/);
  const lastFenceMatch = lastTrimmed.match(/^([`~]{3,})\s*$/);

  if (!firstFenceMatch || !lastFenceMatch) {
    return source;
  }

  const openFenceChar = firstFenceMatch[1][0];
  const closeFenceChar = lastFenceMatch[1][0];
  if (openFenceChar !== closeFenceChar) {
    return source;
  }

  return lines.slice(1, -1).join("\n");
}

class CodeCopyButtonWidget extends WidgetType {
  constructor({ sourceFrom, sourceTo, copyText = "" } = {}) {
    super();
    this.sourceFrom = sourceFrom;
    this.sourceTo = sourceTo;
    this.copyText = typeof copyText === "string" ? copyText : "";
  }

  eq(other) {
    return (
      other instanceof CodeCopyButtonWidget &&
      this.sourceFrom === other.sourceFrom &&
      this.sourceTo === other.sourceTo &&
      this.copyText === other.copyText
    );
  }

  toDOM() {
    const focusEditor = (target) => {
      const hostEditor = target?.closest?.(".cm-editor");
      const focusTarget =
        hostEditor?.querySelector?.(".cm-content") ?? hostEditor ?? null;
      focusTarget?.focus?.();
    };

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mm-live-v4-code-copy-button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code block");
    button.setAttribute("data-src-from", String(this.sourceFrom));
    button.setAttribute("data-src-to", String(this.sourceTo));
    button.tabIndex = -1;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      focusEditor(event.currentTarget);
    });
    button.addEventListener("focus", (event) => {
      event.preventDefault();
      focusEditor(event.currentTarget);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      focusEditor(event.currentTarget);
    });

    const copyText = this.copyText;
    let resetTimer = null;

    const setLabel = (label) => {
      button.textContent = label;
      if (resetTimer) {
        clearTimeout(resetTimer);
      }
      if (label !== "Copy") {
        resetTimer = window.setTimeout(() => {
          button.textContent = "Copy";
          resetTimer = null;
        }, 1200);
      }
    };

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(copyText);
        } else {
          const temp = document.createElement("textarea");
          temp.value = copyText;
          temp.setAttribute("readonly", "readonly");
          temp.style.position = "fixed";
          temp.style.opacity = "0";
          document.body.appendChild(temp);
          temp.select();
          document.execCommand("copy");
          document.body.removeChild(temp);
        }
        setLabel("Copied");
      } catch {
        setLabel("Failed");
      }
    });

    return button;
  }

  ignoreEvent() {
    return true;
  }
}

function normalizeListMarker(marker) {
  if (typeof marker !== "string" || marker.length === 0) {
    return "•";
  }
  return /^\d+\.$/.test(marker) ? marker : "•";
}

function toListMarkerDisplayText(markerText, listMarker) {
  const text = typeof markerText === "string" ? markerText : "";
  if (!text) {
    return "";
  }

  const markerLabel = normalizeListMarker(listMarker);
  const isOrdered = /^\d+\.$/.test(String(listMarker ?? ""));
  const match = text.match(/^(\s*)([-+*]|\d+\.)(\s*)$/);
  if (!match) {
    return isOrdered ? text : `${text} `;
  }

  const trailingSpace = isOrdered ? (match[3] ?? "") : " ";
  return `${match[1]}${markerLabel}${trailingSpace}`;
}

function buildTaskSizerText() {
  return "[] ";
}

function normalizeInlineSpan(span) {
  if (!span || !Number.isFinite(span.from) || !Number.isFinite(span.to)) {
    return null;
  }
  const from = Math.trunc(span.from);
  const to = Math.trunc(span.to);
  if (to <= from) {
    return null;
  }
  return {
    from,
    to,
    type: typeof span.type === "string" ? span.type : "inline",
  };
}

function resolveImagePlaceholder(text) {
  if (typeof text !== "string" || !text.startsWith("!")) {
    return null;
  }

  const markdownImageMatch = text.match(/^!\[([^\]\n]*)\]\(([^)\n]+)\)$/);
  if (markdownImageMatch) {
    const alt = markdownImageMatch[1] ?? "";
    const source = markdownImageMatch[2] ?? "";
    return {
      label: alt.trim() || source.trim() || "image",
      source,
    };
  }

  const obsidianImageMatch = text.match(
    /^!\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]$/,
  );
  if (obsidianImageMatch) {
    const target = obsidianImageMatch[1] ?? "";
    const alias = obsidianImageMatch[2] ?? "";
    return {
      label: alias.trim() || target.trim() || "image",
      source: target,
    };
  }

  return null;
}

function resolveInlineStyleMeta(doc, span, contentFrom, contentTo) {
  if (
    !doc ||
    !span ||
    !Number.isFinite(contentFrom) ||
    !Number.isFinite(contentTo)
  ) {
    return null;
  }

  const rangeFrom = Math.trunc(contentFrom);
  const rangeTo = Math.trunc(contentTo);
  if (rangeTo <= rangeFrom) {
    return null;
  }

  const spanFrom = Math.trunc(span.from);
  const spanTo = Math.trunc(span.to);
  if (spanTo <= spanFrom || spanFrom < rangeFrom || spanTo > rangeTo) {
    return null;
  }

  const text = doc.sliceString(spanFrom, spanTo);
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }

  if (span.type === "image") {
    const image = resolveImagePlaceholder(text);
    if (!image) {
      return null;
    }
    return {
      widget: new InlineImagePlaceholderWidget(image),
      replaceFrom: spanFrom,
      replaceTo: spanTo,
      syntaxRanges: [],
    };
  }

  if (span.type === "escape") {
    if (!(text.startsWith("\\") && text.length === 2)) {
      return null;
    }
    return {
      contentFrom: spanFrom + 1,
      contentTo: spanTo,
      syntaxRanges: [{ from: spanFrom, to: spanFrom + 1 }],
    };
  }

  if (span.type === "hardbreak") {
    if (text !== "\\") {
      return null;
    }
    return {
      contentFrom: spanFrom,
      contentTo: spanFrom,
      syntaxRanges: [{ from: spanFrom, to: spanTo }],
    };
  }

  if (span.type === "strong-emphasis") {
    const isAsteriskStrongEmphasis =
      text.startsWith("***") && text.endsWith("***") && text.length > 6;
    const isUnderscoreStrongEmphasis =
      text.startsWith("___") && text.endsWith("___") && text.length > 6;
    if (!isAsteriskStrongEmphasis && !isUnderscoreStrongEmphasis) {
      return null;
    }
    return {
      className: "mm-live-v4-inline-strong mm-live-v4-inline-emphasis",
      contentFrom: spanFrom + 3,
      contentTo: spanTo - 3,
      syntaxRanges: [
        { from: spanFrom, to: spanFrom + 3 },
        { from: spanTo - 3, to: spanTo },
      ],
    };
  }

  if (span.type === "strong") {
    const isAsteriskStrong =
      text.startsWith("**") && text.endsWith("**") && text.length > 4;
    const isUnderscoreStrong =
      text.startsWith("__") && text.endsWith("__") && text.length > 4;
    if (!isAsteriskStrong && !isUnderscoreStrong) {
      return null;
    }
    return {
      className: "mm-live-v4-inline-strong",
      contentFrom: spanFrom + 2,
      contentTo: spanTo - 2,
      syntaxRanges: [
        { from: spanFrom, to: spanFrom + 2 },
        { from: spanTo - 2, to: spanTo },
      ],
    };
  }

  if (span.type === "emphasis") {
    const isAsteriskEmphasis =
      text.startsWith("*") &&
      text.endsWith("*") &&
      !text.startsWith("**") &&
      !text.endsWith("**") &&
      text.length > 2;
    const isUnderscoreEmphasis =
      text.startsWith("_") &&
      text.endsWith("_") &&
      !text.startsWith("__") &&
      !text.endsWith("__") &&
      text.length > 2;
    if (!isAsteriskEmphasis && !isUnderscoreEmphasis) {
      return null;
    }
    return {
      className: "mm-live-v4-inline-emphasis",
      contentFrom: spanFrom + 1,
      contentTo: spanTo - 1,
      syntaxRanges: [
        { from: spanFrom, to: spanFrom + 1 },
        { from: spanTo - 1, to: spanTo },
      ],
    };
  }

  if (span.type === "strike") {
    if (!(text.startsWith("~~") && text.endsWith("~~") && text.length > 4)) {
      return null;
    }
    return {
      className: "mm-live-v4-inline-strike",
      contentFrom: spanFrom + 2,
      contentTo: spanTo - 2,
      syntaxRanges: [
        { from: spanFrom, to: spanFrom + 2 },
        { from: spanTo - 2, to: spanTo },
      ],
    };
  }

  if (span.type === "highlight") {
    if (!(text.startsWith("==") && text.endsWith("==") && text.length > 4)) {
      return null;
    }
    return {
      className: "mm-live-v4-inline-highlight",
      contentFrom: spanFrom + 2,
      contentTo: spanTo - 2,
      syntaxRanges: [
        { from: spanFrom, to: spanFrom + 2 },
        { from: spanTo - 2, to: spanTo },
      ],
    };
  }

  if (span.type === "code") {
    const codeMatch = text.match(/^(`+)([\s\S]*)\1$/);
    if (!codeMatch || !codeMatch[1] || text.length <= codeMatch[1].length * 2) {
      return null;
    }
    const markerLength = codeMatch[1].length;
    return {
      className: "mm-live-v4-inline-code",
      contentFrom: spanFrom + markerLength,
      contentTo: spanTo - markerLength,
      syntaxRanges: [
        { from: spanFrom, to: spanFrom + markerLength },
        { from: spanTo - markerLength, to: spanTo },
      ],
    };
  }

  if (span.type === "link" || span.type === "reference-link") {
    const match = text.match(/^\[([^\]\n]+)\]\(([^)\n]+)\)$/);
    const referenceMatch =
      span.type === "reference-link"
        ? text.match(/^\[([^\]\n]+)\]\[([^\]\n]*)\]$/)
        : null;
    const labelText = match?.[1] ?? referenceMatch?.[1] ?? null;
    if (typeof labelText !== "string") {
      return null;
    }
    const labelFrom = spanFrom + 1;
    const labelTo = labelFrom + labelText.length;
    return {
      className: "mm-live-v4-inline-link",
      contentFrom: labelFrom,
      contentTo: labelTo,
      syntaxRanges: [
        { from: spanFrom, to: spanFrom + 1 },
        { from: labelTo, to: spanTo },
      ],
    };
  }

  if (span.type === "autolink") {
    if (!(text.startsWith("<") && text.endsWith(">") && text.length > 2)) {
      return null;
    }
    return {
      className: "mm-live-v4-inline-link",
      contentFrom: spanFrom + 1,
      contentTo: spanTo - 1,
      syntaxRanges: [
        { from: spanFrom, to: spanFrom + 1 },
        { from: spanTo - 1, to: spanTo },
      ],
    };
  }

  if (span.type === "bare-link") {
    return {
      className: "mm-live-v4-inline-link",
      contentFrom: spanFrom,
      contentTo: spanTo,
      syntaxRanges: [],
    };
  }

  if (span.type === "wikilink") {
    const match = text.match(/^\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]$/);
    if (!match || typeof match[1] !== "string") {
      return null;
    }

    const targetText = match[1];
    const aliasText = typeof match[2] === "string" ? match[2] : "";
    const innerStart = spanFrom + 2;

    if (aliasText.length > 0) {
      const aliasFrom = innerStart + targetText.length + 1;
      const aliasTo = aliasFrom + aliasText.length;
      return {
        className: "mm-live-v4-inline-link mm-live-v4-inline-wikilink",
        contentFrom: aliasFrom,
        contentTo: aliasTo,
        syntaxRanges: [
          { from: spanFrom, to: innerStart },
          { from: innerStart, to: aliasFrom },
          { from: spanTo - 2, to: spanTo },
        ],
      };
    }

    return {
      className: "mm-live-v4-inline-link mm-live-v4-inline-wikilink",
      contentFrom: innerStart,
      contentTo: spanTo - 2,
      syntaxRanges: [
        { from: spanFrom, to: innerStart },
        { from: spanTo - 2, to: spanTo },
      ],
    };
  }

  if (span.type === "footnote-ref") {
    const match = text.match(/^\[\^([^\]\n]+)\]$/);
    if (!match || typeof match[1] !== "string") {
      return null;
    }
    const labelFrom = spanFrom + 2;
    const labelTo = labelFrom + match[1].length;
    return {
      className: "mm-live-v4-inline-footnote-ref",
      contentFrom: labelFrom,
      contentTo: labelTo,
      syntaxRanges: [
        { from: spanFrom, to: spanFrom + 2 },
        { from: spanTo - 1, to: spanTo },
      ],
    };
  }

  return null;
}

function buildInlineSpanDecorations(state, meta, selectionHead) {
  if (
    !state?.doc ||
    !meta ||
    !Array.isArray(meta.inlineSpans) ||
    meta.inlineSpans.length === 0
  ) {
    return [];
  }

  const selection = state.selection.main;
  const selectionFrom = Math.min(selection.anchor, selection.head);
  const selectionTo = Math.max(selection.anchor, selection.head);
  const hasSelection = selectionTo > selectionFrom;
  const contentFrom = Number.isFinite(meta.contentFrom)
    ? Math.trunc(meta.contentFrom)
    : Math.trunc(meta.sourceFrom);
  const contentTo = Math.trunc(meta.sourceTo);
  if (
    !Number.isFinite(contentFrom) ||
    !Number.isFinite(contentTo) ||
    contentTo <= contentFrom
  ) {
    return [];
  }

  const spans = meta.inlineSpans
    .map((span) => normalizeInlineSpan(span))
    .filter(Boolean)
    .sort((left, right) => left.from - right.from || right.to - left.to);

  const decorations = [];
  for (const span of spans) {
    const styleMeta = resolveInlineStyleMeta(
      state.doc,
      span,
      contentFrom,
      contentTo,
    );
    if (!styleMeta) {
      continue;
    }

    const syntaxRanges = Array.isArray(styleMeta.syntaxRanges)
      ? styleMeta.syntaxRanges.filter(
          (range) =>
            range &&
            Number.isFinite(range.from) &&
            Number.isFinite(range.to) &&
            range.to > range.from,
        )
      : [];

    const selectionInsideSyntax = syntaxRanges.some(
      (range) =>
        selectionHead >= Math.trunc(range.from) &&
        selectionHead <= Math.trunc(range.to),
    );

    const replaceFrom = Number.isFinite(styleMeta.replaceFrom)
      ? Math.trunc(styleMeta.replaceFrom)
      : null;
    const replaceTo = Number.isFinite(styleMeta.replaceTo)
      ? Math.trunc(styleMeta.replaceTo)
      : null;
    const hasReplacement =
      styleMeta.widget &&
      Number.isFinite(replaceFrom) &&
      Number.isFinite(replaceTo) &&
      replaceTo > replaceFrom;
    const selectionInsideReplacement =
      hasReplacement &&
      selectionHead >= replaceFrom &&
      selectionHead <= replaceTo;

    if (hasReplacement && !selectionInsideReplacement) {
      decorations.push(
        Decoration.replace({
          widget: styleMeta.widget,
          inclusive: false,
        }).range(replaceFrom, replaceTo),
      );
      continue;
    }

    if (!selectionInsideSyntax) {
      for (const range of syntaxRanges) {
        decorations.push(
          Decoration.mark({
            class: "mm-live-v4-syntax-hidden",
          }).range(Math.trunc(range.from), Math.trunc(range.to)),
        );
      }

      if (
        styleMeta.contentTo > styleMeta.contentFrom &&
        typeof styleMeta.className === "string"
      ) {
        decorations.push(
          Decoration.mark({
            class: styleMeta.className,
          }).range(
            Math.trunc(styleMeta.contentFrom),
            Math.trunc(styleMeta.contentTo),
          ),
        );
      }

      const isInlineCode = styleMeta.className === "mm-live-v4-inline-code";
      const selectionOverlapFrom = Math.max(
        Math.trunc(styleMeta.contentFrom),
        selectionFrom,
      );
      const selectionOverlapTo = Math.min(
        Math.trunc(styleMeta.contentTo),
        selectionTo,
      );
      if (
        isInlineCode &&
        hasSelection &&
        selectionOverlapTo > selectionOverlapFrom
      ) {
        decorations.push(
          Decoration.mark({
            class: "mm-live-v4-inline-code-selected",
          }).range(selectionOverlapFrom, selectionOverlapTo),
        );
      }
    }
  }

  return decorations;
}

function resolveLineTransformMeta(state, transform) {
  if (
    !state?.doc ||
    !transform ||
    !Number.isFinite(transform.sourceFrom) ||
    !Number.isFinite(transform.sourceTo)
  ) {
    return null;
  }

  const range = clampRangeToDoc(
    state,
    transform.sourceFrom,
    transform.sourceTo,
  );
  if (!range) {
    return null;
  }

  const lineText = state.doc.sliceString(range.from, range.to);
  const indentation = /^\s*/.exec(lineText)?.[0]?.length ?? 0;
  const depth = Number.isFinite(transform?.depth)
    ? Math.max(0, Math.trunc(transform.depth))
    : Number.isFinite(transform?.attrs?.depth)
      ? Math.max(0, Math.trunc(transform.attrs.depth))
      : null;

  const base = {
    type: transform.type,
    sourceFrom: range.from,
    sourceTo: range.to,
    depth,
    isActive: Boolean(transform?.isActive),
    inlineSpans: Array.isArray(transform?.inlineSpans)
      ? transform.inlineSpans
      : [],
  };

  if (transform.type === "code") {
    return base;
  }

  if (transform.type === "definition") {
    return {
      ...base,
      contentFrom: range.from,
      contentClass: "mm-live-v4-source-content mm-live-v4-source-definition",
    };
  }

  if (transform.type === "paragraph") {
    return {
      ...base,
      contentFrom: range.from,
      contentClass: "mm-live-v4-source-content mm-live-v4-source-paragraph",
    };
  }

  if (transform.type === "heading") {
    const match = lineText.match(/^(\s{0,3}#{1,6}\s+)/);
    if (!match || !match[1]) {
      return null;
    }
    return {
      ...base,
      markerFrom: range.from,
      markerTo: range.from + match[1].length,
      contentFrom: range.from + match[1].length,
      contentClass: "mm-live-v4-source-content mm-live-v4-source-heading",
    };
  }

  if (transform.type === "blockquote") {
    const match = lineText.match(/^(\s*)((?:>\s?)*)/);
    if (!match || !match[2]) {
      return null;
    }
    const indentationText = match[1] ?? "";
    const markerText = match[2] ?? ">";
    const trailingSpaceText = markerText.match(/\s*$/)?.[0] ?? "";
    const markerCoreText = trailingSpaceText
      ? markerText.slice(0, -trailingSpaceText.length)
      : markerText;
    const markerCoreFrom = range.from + indentationText.length;
    const markerCoreTo = markerCoreFrom + markerCoreText.length;
    const markerTo = markerCoreFrom + markerText.length;
    return {
      ...base,
      markerFrom: range.from,
      markerTo,
      markerCoreFrom,
      markerCoreTo,
      contentFrom: markerTo,
      contentClass: "mm-live-v4-source-content mm-live-v4-source-quote",
    };
  }

  if (transform.type === "task") {
    const match = lineText.match(
      /^(\s*)([-+*]|\d+\.)(\s+)(\[)( |x|X)(\])(\s*)/,
    );
    if (!match || typeof match[0] !== "string") {
      return null;
    }
    const indentationText = match[1] ?? "";
    const listMarkerToken = match[2] ?? "-";
    const markerPrefixSpacing = match[3] ?? " ";
    const markerText = `${match[4] ?? "["}${match[5] ?? " "}${match[6] ?? "]"}`;
    const trailingSpaceText = match[7] ?? "";
    const markerCoreFrom = range.from + indentationText.length;
    const markerCoreTo =
      markerCoreFrom +
      listMarkerToken.length +
      markerPrefixSpacing.length +
      markerText.length;
    const markerTo = markerCoreTo + trailingSpaceText.length;
    if (markerCoreTo <= markerCoreFrom || markerTo <= range.from) {
      return null;
    }
    const listMarker = listMarkerToken;
    const normalizedDepth = Number.isFinite(depth)
      ? depth
      : Math.max(0, Math.floor(indentation / 2));
    return {
      ...base,
      markerFrom: range.from,
      markerTo,
      markerCoreFrom,
      markerCoreTo,
      contentFrom: markerTo,
      checked: String(match[5] ?? "").toLowerCase() === "x",
      markerText,
      markerChars: markerText.length,
      listMarker,
      depth: normalizedDepth,
      contentClass: "mm-live-v4-source-content mm-live-v4-source-task",
    };
  }

  if (transform.type === "list") {
    const match = lineText.match(/^(\s*)([-+*]|\d+\.)(\s*)/);
    if (!match || typeof match[2] !== "string") {
      return null;
    }
    const indentationText = match[1] ?? "";
    const markerText = match[2] ?? "-";
    const trailingSpaceText = match[3] ?? "";
    const markerCoreFrom = range.from + indentationText.length;
    const markerCoreTo = markerCoreFrom + markerText.length;
    const markerTo = markerCoreTo + trailingSpaceText.length;
    if (markerCoreTo <= markerCoreFrom || markerTo <= range.from) {
      return null;
    }
    const listMarker = /^\s*(\d+\.|[-+*])/.exec(lineText)?.[1] ?? "-";
    const normalizedDepth = Number.isFinite(depth)
      ? depth
      : Math.max(0, Math.floor(indentation / 2));
    return {
      ...base,
      markerFrom: range.from,
      markerTo,
      markerCoreFrom,
      markerCoreTo,
      contentFrom: markerTo,
      markerText,
      markerChars: markerText.length,
      listMarker,
      depth: normalizedDepth,
      contentClass: "mm-live-v4-source-content mm-live-v4-source-list",
    };
  }

  return null;
}

function buildCodeSourceLineDecorations(state, meta) {
  if (
    !state?.doc ||
    !meta ||
    !Number.isFinite(meta.sourceFrom) ||
    !Number.isFinite(meta.sourceTo) ||
    meta.sourceTo <= meta.sourceFrom
  ) {
    return [];
  }

  const doc = state.doc;
  const startLine = doc.lineAt(meta.sourceFrom);
  const endLine = doc.lineAt(Math.max(meta.sourceFrom, meta.sourceTo - 1));
  const startNumber = startLine.number;
  const endNumber = endLine.number;
  const isActive = Boolean(meta.isActive);
  const hasFenceLines = endNumber > startNumber;

  const decorations = [];
  const copyText = extractCopyTextForCodeBlock(
    state,
    meta.sourceFrom,
    meta.sourceTo,
  );
  decorations.push(
    Decoration.widget({
      widget: new CodeCopyButtonWidget({
        sourceFrom: meta.sourceFrom,
        sourceTo: meta.sourceTo,
        copyText,
      }),
      side: 1,
    }).range(startLine.from),
  );

  for (let lineNumber = startNumber; lineNumber <= endNumber; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const isFenceLine =
      !isActive &&
      hasFenceLines &&
      (lineNumber === startNumber || lineNumber === endNumber);
    const classes = ["mm-live-v4-source-code-line"];
    if (lineNumber === startNumber) {
      classes.push("mm-live-v4-source-code-line-start");
    }
    if (lineNumber === endNumber) {
      classes.push("mm-live-v4-source-code-line-end");
    }
    if (isFenceLine) {
      classes.push("mm-live-v4-source-code-fence-hidden");
    }
    if (isFenceLine) {
      if (line.to > line.from) {
        decorations.push(
          Decoration.mark({
            class: "mm-live-v4-syntax-hidden",
          }).range(line.from, line.to),
        );
      }
    }
    decorations.push(
      Decoration.line({
        attributes: {
          class: classes.join(" "),
          "data-src-from": String(line.from),
          "data-src-to": String(line.to),
          "data-mm-code-fence-hidden": isFenceLine ? "true" : "false",
        },
      }).range(line.from),
    );
  }

  return decorations;
}

function buildFrontmatterSourceLineDecorations(state, transform) {
  if (
    !state?.doc ||
    !transform ||
    !Number.isFinite(transform.sourceFrom) ||
    !Number.isFinite(transform.sourceTo) ||
    transform.sourceTo <= transform.sourceFrom ||
    transform.isActive
  ) {
    return [];
  }

  const range = clampRangeToDoc(
    state,
    transform.sourceFrom,
    transform.sourceTo,
  );
  if (!range) {
    return [];
  }

  const doc = state.doc;
  const startLine = doc.lineAt(range.from);
  const endLine = doc.lineAt(Math.max(range.from, range.to - 1));
  const decorations = [];

  for (
    let lineNumber = startLine.number;
    lineNumber <= endLine.number;
    lineNumber += 1
  ) {
    const line = doc.line(lineNumber);
    const lineText = doc.sliceString(line.from, line.to);
    const isStart = lineNumber === startLine.number;
    const isEnd = lineNumber === endLine.number;
    const lineClasses = ["mm-live-v4-source-frontmatter-line"];

    if (isStart) {
      lineClasses.push("mm-live-v4-source-frontmatter-line-start");
    }
    if (isEnd) {
      lineClasses.push("mm-live-v4-source-frontmatter-line-end");
    }

    decorations.push(
      Decoration.line({
        attributes: {
          class: lineClasses.join(" "),
          "data-mm-frontmatter-role": isStart || isEnd ? "fence" : "entry",
        },
      }).range(line.from),
    );

    if (isStart || isEnd) {
      if (line.to > line.from) {
        decorations.push(
          Decoration.mark({
            class: "mm-live-v4-syntax-hidden",
          }).range(line.from, line.to),
        );
      }

      if (isStart) {
        decorations.push(
          Decoration.widget({
            widget: new FrontmatterLabelWidget(),
            side: -1,
          }).range(line.from),
        );
      }
      continue;
    }

    const keyValueMatch = lineText.match(/^(\s*)([^:\s][^:]*?)(\s*:\s*)(.*)$/);
    if (keyValueMatch) {
      const indentationText = keyValueMatch[1] ?? "";
      const keyText = keyValueMatch[2] ?? "";
      const separatorText = keyValueMatch[3] ?? "";
      const keyFrom = line.from + indentationText.length;
      const keyTo = keyFrom + keyText.length;
      const separatorFrom = keyTo;
      const separatorTo = separatorFrom + separatorText.length;

      if (keyTo > keyFrom) {
        decorations.push(
          Decoration.mark({
            class: "mm-live-v4-frontmatter-key",
          }).range(keyFrom, keyTo),
        );
      }

      if (separatorTo > separatorFrom) {
        decorations.push(
          Decoration.mark({
            class: "mm-live-v4-frontmatter-separator",
          }).range(separatorFrom, separatorTo),
        );
      }

      if (line.to > separatorTo) {
        decorations.push(
          Decoration.mark({
            class: "mm-live-v4-frontmatter-value",
          }).range(separatorTo, line.to),
        );
      }
      continue;
    }

    if (line.to > line.from) {
      decorations.push(
        Decoration.mark({
          class:
            "mm-live-v4-frontmatter-value mm-live-v4-frontmatter-value-raw",
        }).range(line.from, line.to),
      );
    }
  }

  return decorations;
}

function buildSourceLineDecorations(state, sourceTransforms) {
  if (!Array.isArray(sourceTransforms) || sourceTransforms.length === 0) {
    return [];
  }

  const selectionHead = state.selection.main.head;
  const decorations = [];
  const sortedTransforms = [...sourceTransforms]
    .filter(
      (entry) =>
        Number.isFinite(entry?.sourceFrom) && Number.isFinite(entry?.sourceTo),
    )
    .sort(
      (left, right) =>
        left.sourceFrom - right.sourceFrom || left.sourceTo - right.sourceTo,
    );

  for (const transform of sortedTransforms) {
    if (transform?.type === "frontmatter") {
      decorations.push(
        ...buildFrontmatterSourceLineDecorations(state, transform),
      );
      continue;
    }

    const meta = resolveLineTransformMeta(state, transform);
    if (!meta) {
      continue;
    }

    if (meta.type === "code") {
      decorations.push(...buildCodeSourceLineDecorations(state, meta));
      continue;
    }

    if (meta.type === "definition") {
      if (!meta.isActive && meta.sourceTo > meta.sourceFrom) {
        decorations.push(
          Decoration.line({
            attributes: {
              class: "mm-live-v4-source-definition-line",
            },
          }).range(meta.sourceFrom),
        );
        decorations.push(
          Decoration.mark({
            class: "mm-live-v4-syntax-hidden",
          }).range(meta.sourceFrom, meta.sourceTo),
        );
      }
      continue;
    }

    const hasMarkerRange =
      Number.isFinite(meta.markerFrom) &&
      Number.isFinite(meta.markerTo) &&
      meta.markerTo > meta.markerFrom;
    const markerCoreFrom = hasMarkerRange
      ? Number.isFinite(meta.markerCoreFrom)
        ? meta.markerCoreFrom
        : meta.markerFrom
      : null;
    const markerCoreTo = hasMarkerRange
      ? Number.isFinite(meta.markerCoreTo)
        ? meta.markerCoreTo
        : meta.markerTo
      : null;
    let hideCoreMarker = false;

    if (
      hasMarkerRange &&
      Number.isFinite(markerCoreFrom) &&
      Number.isFinite(markerCoreTo)
    ) {
      const markerIncludesSelection =
        selectionHead >= markerCoreFrom && selectionHead <= markerCoreTo;
      hideCoreMarker = !markerIncludesSelection;
    }

    if (meta.type === "list" || meta.type === "task") {
      const listKind = /^\d+\.$/.test(String(meta.listMarker ?? ""))
        ? "ordered"
        : "bullet";
      const lineAttributes = {
        class:
          meta.type === "task"
            ? "mm-live-v4-source-task-line"
            : "mm-live-v4-source-list-line",
        "data-mm-list-depth": String(
          Number.isFinite(meta.depth) ? meta.depth : 0,
        ),
        "data-mm-marker-chars": String(
          Number.isFinite(meta.markerChars) ? meta.markerChars : 0,
        ),
        "data-mm-list-kind": listKind,
      };
      decorations.push(
        Decoration.line({
          attributes: lineAttributes,
        }).range(meta.sourceFrom),
      );
    }

    if (meta.type === "blockquote") {
      decorations.push(
        Decoration.line({
          attributes: {
            class: "mm-live-v4-source-quote-line",
            "data-mm-quote-rendered": hideCoreMarker ? "true" : "false",
          },
        }).range(meta.sourceFrom),
      );
    }

    if (
      hasMarkerRange &&
      Number.isFinite(markerCoreFrom) &&
      Number.isFinite(markerCoreTo)
    ) {
      // Keep indentation and trailing marker spacing hidden even when marker core syntax is shown.
      if (markerCoreFrom > meta.markerFrom) {
        decorations.push(
          Decoration.mark({
            class: "mm-live-v4-syntax-hidden",
          }).range(meta.markerFrom, markerCoreFrom),
        );
      }

      if (
        (hideCoreMarker ||
          meta.type === "blockquote" ||
          meta.type === "list" ||
          meta.type === "task") &&
        meta.markerTo > markerCoreTo
      ) {
        decorations.push(
          Decoration.mark({
            class: "mm-live-v4-syntax-hidden",
          }).range(markerCoreTo, meta.markerTo),
        );
      }

      if (hideCoreMarker && markerCoreTo > markerCoreFrom) {
        decorations.push(
          Decoration.mark({
            class: "mm-live-v4-syntax-hidden",
          }).range(markerCoreFrom, markerCoreTo),
        );
      } else if (meta.type === "blockquote" && markerCoreTo > markerCoreFrom) {
        decorations.push(
          Decoration.mark({
            class: "mm-live-v4-inline-quote-marker-visible",
          }).range(markerCoreFrom, markerCoreTo),
        );
      }
    }

    if (meta.contentFrom < meta.sourceTo) {
      const attributes = {
        class: meta.contentClass,
      };
      if (Number.isFinite(meta.depth)) {
        attributes["data-list-depth"] = String(meta.depth);
      }
      decorations.push(
        Decoration.mark({
          attributes,
        }).range(meta.contentFrom, meta.sourceTo),
      );
    }

    decorations.push(...buildInlineSpanDecorations(state, meta, selectionHead));

    if (!hasMarkerRange || !hideCoreMarker) {
      continue;
    }

    if (meta.type === "task") {
      decorations.push(
        Decoration.widget({
          widget: new InlineTaskPrefixWidget({
            sourceFrom: meta.sourceFrom,
            checked: meta.checked,
            sizerText: buildTaskSizerText(),
            listKind: /^\d+\.$/.test(String(meta.listMarker ?? ""))
              ? "ordered"
              : "bullet",
          }),
          side: -1,
        }).range(meta.contentFrom),
      );
      continue;
    }

    if (meta.type === "list") {
      decorations.push(
        Decoration.widget({
          widget: new InlineListPrefixWidget({
            markerText: meta.markerText,
            markerDisplayText: toListMarkerDisplayText(
              meta.markerText,
              meta.listMarker,
            ),
            markerKind: /^\d+\.$/.test(String(meta.listMarker ?? ""))
              ? "ordered"
              : "bullet",
          }),
          side: -1,
        }).range(meta.contentFrom),
      );
      continue;
    }
  }

  return decorations;
}

export function createLiveRenderer({
  liveDebug,
  renderMarkdownHtml,
  renderBudgetMaxBlocks = 180,
  virtualizationBufferBefore = 16,
  virtualizationBufferAfter = 16,
} = {}) {
  function buildRenderProjection(state, model, viewportWindow = null) {
    const projection = buildLiveProjection({
      state,
      model,
      renderMarkdownHtml,
      viewportWindow,
      renderBudgetMaxBlocks,
      virtualizationBufferBefore,
      virtualizationBufferAfter,
    });

    const widgetRanges = buildWidgetDecorations(
      state,
      projection.renderedBlocks,
    );
    const sourceRanges = buildSourceLineDecorations(
      state,
      projection.sourceTransforms,
    );
    const allRanges = [...widgetRanges, ...sourceRanges];

    liveDebug?.trace?.("live-v4.projection.built", {
      activeBlockId: projection.activeBlockId,
      renderedBlockCount: projection.metrics.renderedBlockCount,
      virtualizedBlockCount: projection.metrics.virtualizedBlockCount,
      budgetTruncated: projection.metrics.budgetTruncated,
      renderMs: projection.metrics.renderMs,
      viewportFrom: projection.viewportWindow?.from ?? null,
      viewportTo: projection.viewportWindow?.to ?? null,
    });
    liveDebug?.trace?.("decorations.hybrid-built", {
      blockCount: Array.isArray(model?.blocks) ? model.blocks.length : 0,
      activeBlockId: projection.activeBlockId,
      renderedFragmentCount: widgetRanges.length,
      sourceTransformDecorationCount: sourceRanges.length,
      virtualizedBlockCount: projection.metrics.virtualizedBlockCount,
      renderBudgetMaxBlocks,
      renderBudgetTruncated: projection.metrics.budgetTruncated,
    });

    return {
      ...projection,
      decorations:
        allRanges.length > 0
          ? Decoration.set(allRanges, true)
          : Decoration.none,
      atomicRanges:
        widgetRanges.length > 0
          ? Decoration.set(widgetRanges, true)
          : Decoration.none,
    };
  }

  return {
    buildRenderProjection,
  };
}
