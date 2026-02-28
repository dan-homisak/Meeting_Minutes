import { createDocumentSession } from '../../core/document/DocumentSession.js';
import { toLiveDocModel, createEmptyLiveDocModel } from '../model/LiveDocModel.js';
import { diffLiveDocModels } from '../model/ModelDiff.js';

export function createObsidianCoreParser({ markdownEngine } = {}) {
  const session = createDocumentSession({
    markdownEngine
  });

  let liveModel = createEmptyLiveDocModel();

  function commit(legacyResult) {
    const nextLiveModel = toLiveDocModel(legacyResult?.model, liveModel.version + 1);
    const diff = diffLiveDocModels(liveModel, nextLiveModel);
    liveModel = nextLiveModel;
    return {
      model: nextLiveModel,
      diff
    };
  }

  function ensureText(text) {
    if (text === liveModel.text) {
      return {
        model: liveModel,
        diff: null
      };
    }
    const legacyResult = session.ensureText(text);
    return commit(legacyResult);
  }

  function setText(text, reason = 'set-text') {
    const legacyResult = session.setText(text, { reason });
    return commit(legacyResult);
  }

  function applyEditorTransaction(transaction) {
    const legacyResult = session.applyEditorTransaction(transaction);
    if (!legacyResult?.classification?.docChanged && legacyResult?.model) {
      const synced = toLiveDocModel(legacyResult.model, liveModel.version);
      liveModel = synced;
      return {
        model: liveModel,
        diff: null,
        classification: legacyResult.classification
      };
    }

    const committed = commit(legacyResult);
    return {
      ...committed,
      classification: legacyResult?.classification ?? null
    };
  }

  function getModel() {
    return liveModel;
  }

  return {
    ensureText,
    setText,
    applyEditorTransaction,
    getModel
  };
}
