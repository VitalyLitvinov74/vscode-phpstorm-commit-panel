'use strict';

class StagingBatch {
  constructor() {
    this.pathStatesByRoot = new Map();
  }

  add(root, paths, checked, requestId) {
    const normalizedRoot = String(root || '');

    if (!normalizedRoot || !Array.isArray(paths)) {
      return;
    }

    let rootState = this.pathStatesByRoot.get(normalizedRoot);

    if (!rootState) {
      rootState = {
        pathStates: new Map(),
        requestIds: new Set()
      };
      this.pathStatesByRoot.set(normalizedRoot, rootState);
    }

    paths.forEach(function (relativePath) {
      const normalizedPath = String(relativePath || '');

      if (normalizedPath) {
        rootState.pathStates.set(normalizedPath, Boolean(checked));
      }
    });

    const normalizedRequestId = String(requestId || '');

    if (normalizedRequestId) {
      rootState.requestIds.add(normalizedRequestId);
    }

    if (rootState.pathStates.size === 0) {
      this.pathStatesByRoot.delete(normalizedRoot);
    }
  }

  hasPending() {
    for (const rootState of this.pathStatesByRoot.values()) {
      if (rootState.pathStates.size > 0) {
        return true;
      }
    }

    return false;
  }

  take() {
    const batches = [];

    for (const [root, rootState] of this.pathStatesByRoot.entries()) {
      const stagePaths = [];
      const unstagePaths = [];

      for (const [relativePath, checked] of rootState.pathStates.entries()) {
        if (checked) {
          stagePaths.push(relativePath);
        } else {
          unstagePaths.push(relativePath);
        }
      }

      if (stagePaths.length > 0 || unstagePaths.length > 0) {
        batches.push({
          root,
          stagePaths,
          unstagePaths,
          requestIds: Array.from(rootState.requestIds)
        });
      }
    }

    this.clear();
    return batches;
  }

  clear() {
    this.pathStatesByRoot.clear();
  }
}

module.exports = {
  StagingBatch
};
