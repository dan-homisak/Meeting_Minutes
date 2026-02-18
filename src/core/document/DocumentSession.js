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
    const nextModel = createDocModel({
      version: previousModel.version + 1,
      text: nextText,
      blocks: parsed?.blocks ?? [],
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
