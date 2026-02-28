import { createDocModel, createEmptyDocModel } from '../model/DocModel.js';
import { diffDocModels } from '../model/ModelDiff.js';
import {
  applyChangeSpansToText,
  classifyEditorTransaction as classifyEditorTransactionDefault
} from './TransactionClassifier.js';
import { createIncrementalMarkdownParser as createIncrementalMarkdownParserFactory } from '../parser/IncrementalMarkdownParser.js';

function safeReadDocumentText(docLike) {
  if (!docLike || typeof docLike.toString !== 'function') {
    return '';
  }

  try {
    return docLike.toString();
  } catch {
    return '';
  }
}

function normalizeBlockRange(block) {
  if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
    return null;
  }
  const from = Math.max(0, Math.trunc(block.from));
  const to = Math.max(from, Math.trunc(block.to));
  if (to <= from) {
    return null;
  }
  return { from, to };
}

function readOverlapLength(left, right) {
  if (!left || !right) {
    return 0;
  }
  const from = Math.max(left.from, right.from);
  const to = Math.min(left.to, right.to);
  return Math.max(0, to - from);
}

function resolveStableBlockId(previousBlocks, nextBlock, usedIds) {
  const nextRange = normalizeBlockRange(nextBlock);
  if (!nextRange) {
    return null;
  }

  const previous = Array.isArray(previousBlocks) ? previousBlocks : [];

  for (const block of previous) {
    if (
      !block ||
      typeof block.id !== 'string' ||
      block.id.length === 0 ||
      usedIds.has(block.id) ||
      !Number.isFinite(block.from) ||
      !Number.isFinite(block.to)
    ) {
      continue;
    }

    if (block.from === nextRange.from && block.to === nextRange.to) {
      return block.id;
    }
  }

  let bestMatch = null;
  for (const block of previous) {
    if (
      !block ||
      typeof block.id !== 'string' ||
      block.id.length === 0 ||
      usedIds.has(block.id)
    ) {
      continue;
    }

    const previousRange = normalizeBlockRange(block);
    if (!previousRange) {
      continue;
    }

    const overlap = readOverlapLength(previousRange, nextRange);
    if (overlap <= 0) {
      continue;
    }

    const previousLength = previousRange.to - previousRange.from;
    const nextLength = nextRange.to - nextRange.from;
    const denominator = Math.max(previousLength, nextLength, 1);
    const coverage = overlap / denominator;
    const startDelta = Math.abs(previousRange.from - nextRange.from);
    const endDelta = Math.abs(previousRange.to - nextRange.to);

    if (!bestMatch) {
      bestMatch = {
        id: block.id,
        coverage,
        startDelta,
        endDelta
      };
      continue;
    }

    const betterCoverage = coverage > bestMatch.coverage;
    const sameCoverage = coverage === bestMatch.coverage;
    const betterStartDelta = startDelta < bestMatch.startDelta;
    const sameStartDelta = startDelta === bestMatch.startDelta;
    const betterEndDelta = endDelta < bestMatch.endDelta;

    if (
      betterCoverage ||
      (sameCoverage && betterStartDelta) ||
      (sameCoverage && sameStartDelta && betterEndDelta)
    ) {
      bestMatch = {
        id: block.id,
        coverage,
        startDelta,
        endDelta
      };
    }
  }

  if (!bestMatch) {
    return null;
  }

  if (bestMatch.coverage >= 0.45 || bestMatch.startDelta === 0) {
    return bestMatch.id;
  }

  return null;
}

function assignStableBlockIds(previousBlocks, nextBlocks) {
  if (!Array.isArray(nextBlocks) || nextBlocks.length === 0) {
    return [];
  }

  const usedIds = new Set();
  const assignedBlocks = [];

  for (const block of nextBlocks) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }

    if (typeof block.id === 'string' && block.id.length > 0 && !usedIds.has(block.id)) {
      usedIds.add(block.id);
      assignedBlocks.push(block);
      continue;
    }

    const resolvedId = resolveStableBlockId(previousBlocks, block, usedIds);
    if (resolvedId) {
      usedIds.add(resolvedId);
      assignedBlocks.push({
        ...block,
        id: resolvedId
      });
      continue;
    }

    assignedBlocks.push(block);
  }

  return assignedBlocks;
}

export function createDocumentSession({
  markdownEngine,
  parser = null,
  classifyEditorTransaction = classifyEditorTransactionDefault
} = {}) {
  const resolvedParser =
    parser ??
    createIncrementalMarkdownParserFactory({
      markdownEngine
    });
  let model = createEmptyDocModel();

  function commitModel(nextText, parsed, reason = 'unknown') {
    const previousModel = model;
    const parsedBlocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
    const stableBlocks = assignStableBlockIds(previousModel.blocks, parsedBlocks);
    const nextModel = createDocModel({
      version: previousModel.version + 1,
      text: nextText,
      blocks: stableBlocks,
      inlineSpans: parsed?.inlineSpans ?? [],
      meta: {
        ...(parsed?.meta ?? {}),
        reason
      }
    });

    const diff = diffDocModels(previousModel, nextModel);
    model = nextModel;
    return {
      model: nextModel,
      diff
    };
  }

  function setText(text, metadata = null) {
    const source = typeof text === 'string' ? text : '';
    const parsed = resolvedParser.parseFull(source, metadata);
    return commitModel(source, parsed, metadata?.reason ?? 'set-text');
  }

  function ensureText(text) {
    const source = typeof text === 'string' ? text : '';
    if (source === model.text) {
      return {
        model,
        diff: null,
        classification: null
      };
    }

    const result = setText(source, {
      reason: 'ensure-text-sync'
    });
    return {
      ...result,
      classification: null
    };
  }

  function applyEditorTransaction(transaction) {
    const classification = classifyEditorTransaction(transaction);
    if (!classification.docChanged) {
      return {
        model,
        diff: null,
        classification
      };
    }

    const startStateText = safeReadDocumentText(transaction?.startState?.doc);
    if (startStateText !== model.text) {
      setText(startStateText, {
        reason: 'transaction-resync-start-state'
      });
    }

    const fallbackNextText = safeReadDocumentText(transaction?.state?.doc);
    const nextText =
      classification.changeSpans.length > 0
        ? applyChangeSpansToText(model.text, classification.changeSpans)
        : fallbackNextText;

    let parsed = null;
    try {
      parsed = resolvedParser.parseIncremental({
        previousModel: model,
        nextText,
        changeRanges: classification.changeRanges,
        mapPosition: (position, assoc) =>
          typeof transaction?.changes?.mapPos === 'function'
            ? transaction.changes.mapPos(position, assoc)
            : position
      });
    } catch {
      parsed = resolvedParser.parseFull(nextText, {
        reason: 'incremental-parse-failed'
      });
    }

    const result = commitModel(nextText, parsed, parsed?.meta?.reason ?? 'apply-transaction');
    return {
      ...result,
      classification
    };
  }

  function getModel() {
    return model;
  }

  function getBlocks() {
    return Array.isArray(model.blocks) ? model.blocks : [];
  }

  function getInlineSpans() {
    return Array.isArray(model.inlineSpans) ? model.inlineSpans : [];
  }

  return {
    setText,
    ensureText,
    applyEditorTransaction,
    getModel,
    getBlocks,
    getInlineSpans
  };
}
