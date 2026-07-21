'use strict';

const path = require('path');
const vscode = require('vscode');
const git = require('./src/git');
const { StagingBatch } = require('./src/stagingBatch');
const { renderWebview, resolveActiveFileIconTheme } = require('./src/webview');

const VIEW_ID = 'phpstormGitPanel.changes';
const VIRTUAL_SCHEME = 'phpstorm-git-panel';
const COMMIT_LANGUAGE_STORAGE_KEY = 'commitLanguage';
const COMMIT_LANGUAGE_OPTIONS = new Set(['auto', 'en', 'ru']);
const DIFF_IGNORE_POLICIES = new Set(['none', 'trim', 'all', 'all-and-empty', 'formatting']);
const DEFAULT_LANGUAGE_MODEL_TIMEOUT_MS = 45_000;
const VISIBILITY_REFRESH_DELAY_MS = 75;
let virtualDocumentVersion = 0;

class PhpStormCommitPanelProvider {
  constructor(context) {
    this.context = context;
    this.operation = Promise.resolve();
    this.pendingRefreshTimer = undefined;
    this.stagingFlushTimer = undefined;
    this.stagingBatch = new StagingBatch();
    this.pendingStagingOperations = 0;
    this.stagingErrorText = '';
    this.stagingStateVersion = 0;
    this.refreshing = false;
    this.pendingRefreshOptions = undefined;
    this.refreshPromise = undefined;
    this.refreshGeneration = 0;
    this.refreshAbortController = undefined;
    this.repositoryCandidatesKey = undefined;
    this.repositoryRootsCache = [];
    this.repositoryRootsCacheAt = 0;
    this.lastDiffRefreshAt = 0;
    this.diffRequestId = 0;
    this.diffAbortController = undefined;
    this.lastPostedStateSnapshot = undefined;
    this.feedbackVersion = 0;
    this.failedStagingPaths = new Map();
    this.repositorySelectionVersion = 0;
    this.repositorySelectionPending = false;
    this.languageModelTimeoutMs = DEFAULT_LANGUAGE_MODEL_TIMEOUT_MS;
    this.userOperationPending = false;
    this.viewDisposables = [];
    this.disposed = false;
    this.view = undefined;
    const commitLanguage = normalizeCommitLanguage(
      this.context.globalState.get(COMMIT_LANGUAGE_STORAGE_KEY, 'auto')
    );

    this.state = {
      repositories: [],
      selectedRoot: undefined,
      repoName: '',
      changes: [],
      ignoredFiles: [],
      showIgnored: false,
      diffPreviewEnabled: false,
      selectedPath: '',
      diffPreview: undefined,
      diffLoading: false,
      diffIgnorePolicy: 'none',
      showBlame: false,
      message: '',
      messageVersion: 0,
      amend: false,
      amendVersion: 0,
      settledRepositorySelectionRequestId: '',
      lastCommit: '',
      commitLanguage,
      busy: false,
      busyText: '',
      statusText: 'Open a folder with a Git repository.',
      errorText: '',
      confirmedStagingRequestIds: [],
      failedStagingRequestIds: [],
      stagedCount: 0,
      totalCount: 0,
      canGenerate: false
    };

    this.context.subscriptions.push(
      {
        dispose: () => {
          this.disposed = true;
          this.clearScheduledRefresh();
          this.clearStagingFlushTimer();
          this.abortRefreshRequest();
          this.abortDiffPreviewRequest();
          this.disposeViewListeners();
          this.view = undefined;
        }
      },
      vscode.workspace.onDidChangeConfiguration(
        (event) => {
          if (event.affectsConfiguration('workbench.iconTheme')) {
            this.renderPanelWebview();
          }
        }
      )
    );
  }

  resolveWebviewView(webviewView) {
    if (this.disposed) {
      return;
    }

    this.disposeViewListeners();
    this.view = webviewView;
    this.renderPanelWebview();

    this.viewDisposables = [
      webviewView.webview.onDidReceiveMessage(
        (message) => {
          void this.handleMessage(message).catch(
            (error) => {
              this.reportPanelError(error, 'Panel action failed');
            }
          );
        }
      ),
      webviewView.onDidChangeVisibility(
        () => {
          if (webviewView.visible) {
            this.scheduleRefresh(
              VISIBILITY_REFRESH_DELAY_MS,
              { force: true },
              () => this.view === webviewView && webviewView.visible
            );
          }
        }
      ),
      webviewView.onDidDispose(
        () => {
          this.releaseWebviewView(webviewView);
        }
      )
    ];
  }

  releaseWebviewView(webviewView) {
    if (this.view !== webviewView) {
      return;
    }

    this.view = undefined;
    this.lastPostedStateSnapshot = undefined;
    this.clearScheduledRefresh();
    this.pendingRefreshOptions = undefined;
    this.abortRefreshRequest();
    this.abortDiffPreviewRequest();
    this.disposeViewListeners();
  }

  disposeViewListeners() {
    for (const disposable of this.viewDisposables) {
      disposable.dispose();
    }

    this.viewDisposables = [];
  }

  renderPanelWebview() {
    if (!this.view || this.disposed) {
      return;
    }

    const fileIconTheme = resolveActiveFileIconTheme();
    const localResourceRoots = [this.context.extensionUri];

    if (fileIconTheme?.extensionUri) {
      localResourceRoots.push(fileIconTheme.extensionUri);
    }

    this.view.webview.options = {
      enableScripts: true,
      localResourceRoots
    };
    this.lastPostedStateSnapshot = undefined;
    this.view.webview.html = renderWebview(this.view.webview, fileIconTheme, this.context.extensionUri);
  }

  async handleMessage(message) {
    switch (message?.type) {
      case 'ready':
        this.restoreWebviewUiState(message.ui);
        this.lastPostedStateSnapshot = undefined;
        await this.refresh({ force: true, showProgress: false });
        return;
      case 'refresh':
        await this.refresh({ force: true });
        return;
      case 'selectRepository':
        await this.selectRepository(
          String(message.root ?? ''),
          String(message.requestId ?? '')
        );
        return;
      case 'setShowIgnored':
        this.state.showIgnored = Boolean(message.showIgnored);
        await this.refresh({ force: true });
        return;
      case 'setDiffPreviewEnabled':
        await this.setDiffPreviewEnabled(Boolean(message.enabled));
        return;
      case 'setDiffOptions':
        await this.setDiffOptions(message.ignorePolicy);
        return;
      case 'setDiffBlame':
        await this.setDiffBlame(Boolean(message.enabled));
        return;
      case 'selectChange':
        if (!this.isCurrentRepositoryRequest(message.root)) {
          return;
        }
        await this.selectChange(String(message.path ?? ''));
        return;
      case 'toggleHunk':
        await this.toggleHunk(
          String(message.root ?? ''),
          String(message.path ?? ''),
          String(message.hunkId ?? ''),
          Boolean(message.checked),
          String(message.requestId ?? '')
        );
        return;
      case 'setMessage':
        this.setMessage(
          String(message.message ?? ''),
          Number(message.messageVersion)
        );
        return;
      case 'setAmend':
        this.setAmend(
          String(message.root ?? ''),
          Boolean(message.amend),
          Number(message.amendVersion)
        );
        return;
      case 'setCommitLanguage':
        await this.setCommitLanguage(message.language);
        return;
      case 'toggleChange':
        if (!this.isCurrentRepositoryRequest(message.root)) {
          return;
        }
        await this.toggleChange(String(message.path ?? ''), Boolean(message.checked));
        return;
      case 'toggleChanges':
        if (!this.isCurrentRepositoryRequest(message.root)) {
          return;
        }
        await this.toggleChanges(message.paths, Boolean(message.checked));
        return;
      case 'applyStagingBatch':
        await this.applyStagingBatch(
          message.changes,
          String(message.requestId ?? ''),
          String(message.root ?? '')
        );
        return;
      case 'stageAll':
        if (!this.isCurrentRepositoryRequest(message.root)) {
          return;
        }
        await this.stageAll();
        return;
      case 'unstageAll':
        if (!this.isCurrentRepositoryRequest(message.root)) {
          return;
        }
        await this.unstageAll();
        return;
      case 'openDiff':
        if (!this.isCurrentRepositoryRequest(message.root)) {
          return;
        }
        await this.openDiffByPath(String(message.path ?? ''));
        return;
      case 'openFile':
        if (!this.isCurrentRepositoryRequest(message.root)) {
          return;
        }
        await this.openFileByPath(String(message.path ?? ''));
        return;
      case 'locateActiveFile':
        if (!this.isCurrentRepositoryRequest(message.root)) {
          return;
        }
        await this.locateActiveFile();
        return;
      case 'rollbackChange':
        await this.rollbackChange(
          String(message.root ?? ''),
          String(message.path ?? '')
        );
        return;
      case 'shelveChange':
        await this.shelveChange(
          String(message.root ?? ''),
          String(message.path ?? '')
        );
        return;
      case 'generateCommitMessage':
        if (!this.isCurrentRepositoryRequest(message.root)) {
          return;
        }
        await this.generateCommitMessage();
        return;
      case 'commit':
        if (!this.isCurrentRepositoryRequest(message.root)) {
          return;
        }
        await this.commit(false);
        return;
      case 'commitAndPush':
        if (!this.isCurrentRepositoryRequest(message.root)) {
          return;
        }
        await this.commit(true);
        return;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'phpstormGitPanel');
        return;
      default:
        return;
    }
  }

  async selectRepository(root, requestId) {
    const normalizedRequestId = String(requestId || '').slice(0, 200);
    const selectionVersion = ++this.repositorySelectionVersion;
    this.repositorySelectionPending = true;

    try {
      const repositoryExists = this.state.repositories.some(
        (repository) => repository.root === root
      );

      if (!repositoryExists) {
        this.settleRepositorySelection(normalizedRequestId);
        return;
      }

      if (this.userOperationPending) {
        this.settleRepositorySelection(normalizedRequestId);
        return;
      }

      if (root === this.state.selectedRoot) {
        if (this.refreshPromise) {
          await this.refreshPromise;
        }

        if (selectionVersion === this.repositorySelectionVersion) {
          this.settleRepositorySelection(normalizedRequestId);
        }
        return;
      }

      await this.flushPendingStagingWork();

      if (selectionVersion !== this.repositorySelectionVersion) {
        return;
      }

      if (this.userOperationPending
        || !this.state.repositories.some((repository) => repository.root === root)) {
        this.settleRepositorySelection(normalizedRequestId);
        return;
      }

      this.abortDiffPreviewRequest();
      this.stagingErrorText = '';
      this.failedStagingPaths.clear();
      this.lastDiffRefreshAt = 0;
      this.state = {
        ...this.state,
        selectedRoot: root,
        repoName: path.basename(root),
        changes: [],
        ignoredFiles: [],
        selectedPath: '',
        diffPreview: undefined,
        diffLoading: false,
        amend: false,
        amendVersion: this.state.amendVersion + 1,
        lastCommit: '',
        statusText: 'Changes updating...',
        errorText: '',
        confirmedStagingRequestIds: [],
        failedStagingRequestIds: [],
        stagedCount: 0,
        totalCount: 0,
        canGenerate: false
      };
      await this.refresh({ force: true });

      if (selectionVersion === this.repositorySelectionVersion) {
        this.settleRepositorySelection(normalizedRequestId);
      }
    } finally {
      if (selectionVersion === this.repositorySelectionVersion) {
        this.repositorySelectionPending = false;
      }
    }
  }

  settleRepositorySelection(requestId) {
    this.state = {
      ...this.state,
      settledRepositorySelectionRequestId: requestId
    };
    this.postState(true);
  }

  async refresh(options = {}) {
    if (this.disposed) {
      return;
    }

    if (this.userOperationPending && options.allowDuringOperation !== true) {
      this.scheduleRefresh(250, options);
      return this.refreshPromise;
    }

    if (options.force) {
      this.invalidateRefreshWork();

      if (typeof options.preserveErrorText !== 'string'
        && this.failedStagingPaths.size === 0) {
        this.stagingErrorText = '';
      }

      if (this.hasPendingStagingWork()) {
        await this.flushPendingStagingWork();
        this.clearScheduledRefresh();
      }
    } else if (this.hasPendingStagingWork()) {
      this.scheduleRefresh(700, options);
      return this.refreshPromise;
    }

    const requestedOptions = {
      ...options,
      refreshDiff: options.refreshDiff ?? Boolean(options.force)
    };
    this.pendingRefreshOptions = mergeRefreshOptions(this.pendingRefreshOptions, requestedOptions);

    if (!this.refreshPromise) {
      this.refreshPromise = this.drainRefreshQueue();
    }

    return this.refreshPromise;
  }

  invalidateRefreshWork() {
    this.refreshGeneration += 1;
    this.pendingRefreshOptions = undefined;
    this.abortRefreshRequest();
    this.abortDiffPreviewRequest();
    this.clearScheduledRefresh();
  }

  refreshWhenVisible(options = {}) {
    if (!this.view?.visible || this.disposed) {
      return undefined;
    }

    return this.refresh(options);
  }

  async drainRefreshQueue() {
    this.refreshing = true;

    try {
      while (this.pendingRefreshOptions) {
        const options = this.pendingRefreshOptions;
        const generation = this.refreshGeneration;
        const abortController = new AbortController();
        this.pendingRefreshOptions = undefined;
        this.refreshAbortController = abortController;

        try {
          await this.performRefresh(
            options,
            generation,
            abortController.signal
          );
        } finally {
          if (this.refreshAbortController === abortController) {
            this.refreshAbortController = undefined;
          }
        }
      }
    } finally {
      this.refreshing = false;
      this.refreshPromise = undefined;
    }
  }

  abortRefreshRequest() {
    if (this.refreshAbortController) {
      this.refreshAbortController.abort();
      this.refreshAbortController = undefined;
    }
  }

  async performRefresh(options, generation, signal) {
    const stagingStateVersion = this.stagingStateVersion;
    const feedbackVersion = this.feedbackVersion;
    const preservedErrorText = typeof options.preserveErrorText === 'string'
      ? options.preserveErrorText
      : this.stagingErrorText;

    if (options.force && options.showProgress !== false) {
      this.state = {
        ...this.state,
        errorText: preservedErrorText,
        statusText: this.state.busy ? this.state.statusText : 'Changes updating...'
      };
      this.postState();
    }

    try {
      const roots = await this.resolveRepositories(
        {
          force: Boolean(options.force),
          signal
        }
      );

      if (!this.isRefreshCurrent(generation) || signal.aborted) {
        return;
      }

      const selectedRoot = this.pickSelectedRoot(roots);
      const selectedRootChanged = Boolean(this.state.selectedRoot)
        && this.state.selectedRoot !== selectedRoot;

      if (selectedRootChanged) {
        this.failedStagingPaths.clear();
        this.stagingErrorText = '';
      }

      const repositoryCandidates = roots.map(
        (root) => ({
          root,
          name: path.basename(root)
        })
      );
      const repositories = areChangeListsEqual(
        this.state.repositories,
        repositoryCandidates
      )
        ? this.state.repositories
        : repositoryCandidates;

      if (!selectedRoot) {
        this.abortDiffPreviewRequest();
        this.state = {
          ...this.state,
          repositories,
          selectedRoot: undefined,
          repoName: '',
          changes: this.state.changes.length === 0 ? this.state.changes : [],
          ignoredFiles: this.state.ignoredFiles.length === 0 ? this.state.ignoredFiles : [],
          selectedPath: '',
          diffPreview: undefined,
          diffLoading: false,
          lastCommit: '',
          errorText: feedbackVersion === this.feedbackVersion
            ? this.stagingErrorText || (this.failedStagingPaths.size > 0 ? preservedErrorText : '')
            : this.state.errorText,
          statusText: feedbackVersion === this.feedbackVersion
            ? 'Open a folder with a Git repository.'
            : this.state.statusText,
          amend: selectedRootChanged ? false : this.state.amend,
          amendVersion: selectedRootChanged
            ? this.state.amendVersion + 1
            : this.state.amendVersion,
          confirmedStagingRequestIds: [],
          failedStagingRequestIds: [],
          stagedCount: 0,
          totalCount: 0,
          canGenerate: false
        };
        this.postState();
        return;
      }

      const previousChanges = this.state.changes;
      const previousIgnoredFiles = this.state.ignoredFiles;
      const previousSelectedPath = this.state.selectedPath;
      const [changes, lastCommit, ignoredFiles] = await Promise.all(
        [
          git.getStatus(selectedRoot, { signal }),
          git.getLastCommitSummary(selectedRoot, { signal }),
          this.state.showIgnored
            ? git.listIgnoredFiles(selectedRoot, { signal })
            : Promise.resolve([])
        ]
      );

      if (!this.isRefreshCurrent(generation)
        || signal.aborted
        || stagingStateVersion !== this.stagingStateVersion) {
        return;
      }

      this.reconcileFailedStagingPaths(changes);
      const changeListChanged = !areChangeListsEqual(previousChanges, changes);
      const nextChanges = changeListChanged ? changes : previousChanges;
      const nextIgnoredFiles = areChangeListsEqual(previousIgnoredFiles, ignoredFiles)
        ? previousIgnoredFiles
        : ignoredFiles;
      const stagedCount = nextChanges.filter((change) => change.staged).length;
      const totalCount = nextChanges.length;
      const feedbackChanged = feedbackVersion !== this.feedbackVersion;

      this.state = {
        ...this.state,
        repositories,
        selectedRoot,
        repoName: path.basename(selectedRoot),
        changes: nextChanges,
        ignoredFiles: nextIgnoredFiles,
        lastCommit,
        errorText: feedbackChanged
          ? this.state.errorText
          : this.stagingErrorText || (this.failedStagingPaths.size > 0 ? preservedErrorText : ''),
        statusText: feedbackChanged
          ? this.state.statusText
          : formatStatusText(stagedCount, totalCount),
        amend: selectedRootChanged ? false : this.state.amend,
        amendVersion: selectedRootChanged
          ? this.state.amendVersion + 1
          : this.state.amendVersion,
        confirmedStagingRequestIds: selectedRootChanged
          ? []
          : this.state.confirmedStagingRequestIds,
        failedStagingRequestIds: selectedRootChanged
          ? []
          : this.state.failedStagingRequestIds,
        stagedCount,
        totalCount,
        canGenerate: stagedCount > 0
      };

      if (this.state.diffPreviewEnabled) {
        const selectedStillExists = nextChanges.some(
          (change) => change.path === this.state.selectedPath
        );
        this.state.selectedPath = selectedStillExists
          ? this.state.selectedPath
          : nextChanges[0]?.path || '';
        const diffNeedsRefresh = selectedRootChanged
          || options.refreshDiff
          || !this.state.diffPreview
          || previousSelectedPath !== this.state.selectedPath
          || changeListChanged
          || Date.now() - this.lastDiffRefreshAt >= 15_000;

        if (diffNeedsRefresh) {
          await this.loadDiffPreview({ post: false });
          this.lastDiffRefreshAt = Date.now();
        }
      } else {
        this.state.diffPreview = undefined;
      }

      if (this.isRefreshCurrent(generation) && !signal.aborted) {
        this.postState();
      }
    } catch (error) {
      const shouldReport = this.isRefreshCurrent(generation)
        && !signal.aborted
        && !isAbortError(error);

      if (this.refreshAbortController?.signal === signal) {
        this.refreshAbortController.abort();
      }

      if (shouldReport) {
        this.reportPanelError(error, 'Git status failed');
      }
    }
  }

  isRefreshCurrent(generation) {
    return !this.disposed && generation === this.refreshGeneration;
  }

  async resolveRepositories(options = {}) {
    const candidates = [];
    const seenCandidates = new Set();
    const addCandidate = (candidate) => {
      const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;

      if (!seenCandidates.has(key)) {
        seenCandidates.add(key);
        candidates.push(candidate);
      }
    };
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      addCandidate(folder.uri.fsPath);
    }

    const activeEditor = vscode.window.activeTextEditor;

    if (activeEditor) {
      const folder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
      if (folder) {
        addCandidate(folder.uri.fsPath);
      }
    }

    const candidatesKey = candidates
      .map(
        (candidate) => process.platform === 'win32'
          ? candidate.toLowerCase()
          : candidate
      )
      .join('\0');

    if (!options.force
      && candidatesKey === this.repositoryCandidatesKey
      && Date.now() - this.repositoryRootsCacheAt < 15_000) {
      return [...this.repositoryRootsCache];
    }

    const repositories = [];
    const seen = new Set();
    const roots = await Promise.all(
      candidates.map(
        (candidate) => git.findRepositoryRoot(
          candidate,
          { signal: options.signal }
        )
      )
    );

    for (const root of roots) {
      if (!root) {
        continue;
      }

      const key = process.platform === 'win32' ? root.toLowerCase() : root;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      repositories.push(root);
    }

    if (!options.signal?.aborted) {
      this.repositoryCandidatesKey = candidatesKey;
      this.repositoryRootsCache = [...repositories];
      this.repositoryRootsCacheAt = Date.now();
    }

    return repositories;
  }

  reconcileFailedStagingPaths(changes) {
    if (this.failedStagingPaths.size === 0) {
      return;
    }

    const changesByPath = new Map(changes.map((change) => [change.path, change]));

    for (const [relativePath, checked] of this.failedStagingPaths.entries()) {
      const change = changesByPath.get(relativePath);
      const matchesRequestedState = !change
        || (checked
          ? change.staged && !change.partiallyStaged
          : !change.staged);

      if (matchesRequestedState) {
        this.failedStagingPaths.delete(relativePath);
      }
    }

    if (this.failedStagingPaths.size === 0) {
      this.stagingErrorText = '';
    }
  }

  clearStagingFailures() {
    if (this.failedStagingPaths.size > 0 || this.stagingErrorText) {
      this.feedbackVersion += 1;
    }

    this.failedStagingPaths.clear();
    this.stagingErrorText = '';
  }

  pickSelectedRoot(roots) {
    if (roots.length === 0) {
      return undefined;
    }

    if (this.state.selectedRoot && roots.includes(this.state.selectedRoot)) {
      return this.state.selectedRoot;
    }

    const activeFilePath = vscode.window.activeTextEditor?.document?.uri?.fsPath;

    if (activeFilePath) {
      const activeRoots = roots.filter(
        (root) => {
          const relativePath = path.relative(root, activeFilePath);
          return relativePath === ''
            || (relativePath !== '..'
              && !relativePath.startsWith(`..${path.sep}`)
              && !path.isAbsolute(relativePath));
        }
      );

      if (activeRoots.length > 0) {
        return activeRoots.reduce(
          (mostSpecificRoot, root) => root.length > mostSpecificRoot.length
            ? root
            : mostSpecificRoot
        );
      }
    }

    return roots[0];
  }

  restoreWebviewUiState(ui) {
    if (!ui || typeof ui !== 'object') {
      return;
    }

    this.state.showIgnored = Boolean(ui.showIgnored);
    this.state.diffPreviewEnabled = Boolean(ui.diffPreviewEnabled);
    this.state.selectedPath = typeof ui.selectedPath === 'string' ? ui.selectedPath : '';

    if (DIFF_IGNORE_POLICIES.has(ui.diffIgnorePolicy)) {
      this.state.diffIgnorePolicy = ui.diffIgnorePolicy;
    }

    this.state.showBlame = Boolean(ui.showBlame);
  }

  setMessage(message, messageVersion) {
    const currentVersion = Number.isSafeInteger(this.state.messageVersion)
      ? this.state.messageVersion
      : 0;
    const hasVersion = Number.isSafeInteger(messageVersion) && messageVersion >= 0;

    if (hasVersion && messageVersion < currentVersion) {
      return;
    }

    this.state.message = message;
    this.state.messageVersion = hasVersion
      ? messageVersion
      : currentVersion + 1;
  }

  isCurrentRepositoryRequest(requestedRoot) {
    return !this.repositorySelectionPending
      && Boolean(requestedRoot)
      && requestedRoot === this.state.selectedRoot;
  }

  setAmend(requestedRoot, amend, amendVersion) {
    if (!this.isCurrentRepositoryRequest(requestedRoot)) {
      return;
    }

    const currentVersion = Number.isSafeInteger(this.state.amendVersion)
      ? this.state.amendVersion
      : 0;
    const hasVersion = Number.isSafeInteger(amendVersion) && amendVersion >= 0;

    if (hasVersion && amendVersion < currentVersion) {
      return;
    }

    this.state.amend = amend;
    this.state.amendVersion = hasVersion
      ? amendVersion
      : currentVersion + 1;
    this.postState();
  }

  async setDiffPreviewEnabled(enabled) {
    this.state.diffPreviewEnabled = enabled;

    if (!enabled) {
      this.abortDiffPreviewRequest();
      this.state.diffLoading = false;
      this.state.diffPreview = undefined;
      this.postState();
      return;
    }

    if (!this.findChange(this.state.selectedPath)) {
      this.state.selectedPath = this.state.changes[0]?.path || '';
    }

    await this.loadDiffPreview();
  }

  async setDiffOptions(ignorePolicy) {
    const normalizedPolicy = DIFF_IGNORE_POLICIES.has(ignorePolicy) ? ignorePolicy : 'none';

    if (this.state.diffIgnorePolicy === normalizedPolicy) {
      return;
    }

    this.state.diffIgnorePolicy = normalizedPolicy;

    if (this.state.diffPreviewEnabled) {
      await this.loadDiffPreview();
    } else {
      this.postState();
    }
  }

  async setDiffBlame(enabled) {
    this.state.showBlame = enabled;

    if (this.state.diffPreviewEnabled) {
      await this.loadDiffPreview();
    } else {
      this.postState();
    }
  }

  async selectChange(relativePath) {
    const change = this.findChange(relativePath);

    if (!change) {
      return;
    }

    this.state.selectedPath = change.path;

    if (this.state.diffPreviewEnabled) {
      await this.loadDiffPreview();
    } else {
      this.postState();
    }
  }

  async loadDiffPreview(options = {}) {
    this.abortDiffPreviewRequest();
    const requestId = ++this.diffRequestId;
    const abortController = new AbortController();
    this.diffAbortController = abortController;
    const root = this.state.selectedRoot;
    const change = this.findChange(this.state.selectedPath);

    if (!this.state.diffPreviewEnabled || !root || !change) {
      this.diffAbortController = undefined;
      this.state.diffLoading = false;
      this.state.diffPreview = undefined;

      if (options.post !== false) {
        this.postState();
      }
      return;
    }

    const requestedPath = change.path;
    this.state.diffLoading = true;

    if (options.post !== false) {
      this.postState();
    }

    try {
      const [preview, blame] = await Promise.all(
        [
          abortable(
            git.getFileDiff(
              root,
              change,
              {
                contextLines: 3,
                ignorePolicy: this.state.diffIgnorePolicy,
                signal: abortController.signal
              }
            ),
            abortController.signal
          ),
          this.state.showBlame
            ? abortable(
              git.getBlame(
                root,
                change.path,
                { signal: abortController.signal }
              ),
              abortController.signal
            )
            : Promise.resolve({})
        ]
      );
      preview.blame = blame;

      if (this.isCurrentDiffRequest(requestId, root, requestedPath)) {
        this.state.diffPreview = preview;
        this.lastDiffRefreshAt = Date.now();
      }
    } catch (error) {
      abortController.abort();

      if (!isAbortError(error) && this.isCurrentDiffRequest(requestId, root, requestedPath)) {
        this.state.diffPreview = {
          path: requestedPath,
          hunks: [],
          differenceCount: 0,
          includedCount: 0,
          canToggleFile: true,
          canToggleHunks: false,
          message: formatError(error)
        };
      }
    } finally {
      const isCurrent = this.isCurrentDiffRequest(requestId, root, requestedPath);

      if (isCurrent) {
        this.state.diffLoading = false;
        this.diffAbortController = undefined;
      }

      if (isCurrent && options.post !== false) {
        this.postState();
      }
    }
  }

  abortDiffPreviewRequest() {
    if (this.diffAbortController) {
      this.diffAbortController.abort();
      this.diffAbortController = undefined;
    }

    this.diffRequestId += 1;
    this.state.diffLoading = false;
  }

  isCurrentDiffRequest(requestId, root, relativePath) {
    return !this.disposed
      && this.diffRequestId === requestId
      && this.state.diffPreviewEnabled
      && this.state.selectedRoot === root
      && this.state.selectedPath === relativePath;
  }

  async toggleHunk(requestedRoot, relativePath, hunkId, checked, requestId) {
    const normalizedRequestId = String(requestId || '').slice(0, 200);

    if (!await this.flushPendingStagingWork()) {
      this.acknowledgeStagingRequest(normalizedRequestId, false);
      return;
    }

    const root = this.state.selectedRoot;
    const change = this.findChange(relativePath);

    if (!root
      || requestedRoot !== root
      || !this.state.repositories.some((repository) => repository.root === requestedRoot)
      || !change
      || !hunkId) {
      this.acknowledgeStagingRequest(normalizedRequestId, false);
      return;
    }

    const succeeded = await this.enqueueOperation(
      'Updating included changes...',
      async () => {
        await git.setHunkIncluded(
          root,
          change,
          hunkId,
          checked,
          {
            contextLines: 3,
            ignorePolicy: this.state.diffIgnorePolicy
          }
        );
      }
    );

    this.acknowledgeStagingRequest(normalizedRequestId, succeeded);
  }

  acknowledgeStagingRequest(requestId, succeeded) {
    if (!requestId || this.disposed) {
      return;
    }

    this.state = {
      ...this.state,
      confirmedStagingRequestIds: succeeded ? [requestId] : [],
      failedStagingRequestIds: succeeded ? [] : [requestId]
    };
    this.postState();
  }

  async locateActiveFile() {
    const root = this.state.selectedRoot;
    const activeEditor = vscode.window.activeTextEditor;

    if (!root || !activeEditor || activeEditor.document.uri.scheme !== 'file') {
      this.reportPanelWarning('Open a changed file to locate it in the panel.');
      return;
    }

    const relativePath = path.relative(root, activeEditor.document.uri.fsPath).replace(/\\/g, '/');
    const outsideRepository = relativePath === '..'
      || relativePath.startsWith('../')
      || path.isAbsolute(relativePath);

    if (outsideRepository || !this.findChange(relativePath)) {
      this.reportPanelWarning('The active file has no local changes in this repository.');
      return;
    }

    await this.selectChange(relativePath);
  }

  async rollbackChange(requestedRoot, relativePath) {
    if (requestedRoot !== this.state.selectedRoot) {
      return;
    }

    if (!await this.flushPendingStagingWork()) {
      return;
    }

    const root = this.state.selectedRoot;
    const change = this.findChange(relativePath);

    if (!root || root !== requestedRoot || !change) {
      return;
    }

    await this.enqueueOperation(
      'Rolling back selected change...',
      async () => {
        await git.rollbackPath(root, change);
      }
    );
  }

  async shelveChange(requestedRoot, relativePath) {
    if (requestedRoot !== this.state.selectedRoot) {
      return;
    }

    if (!await this.flushPendingStagingWork()) {
      return;
    }
    const root = this.state.selectedRoot;
    const change = this.findChange(relativePath);

    if (!root || root !== requestedRoot || !change) {
      return;
    }

    await this.enqueueOperation(
      'Shelving selected change...',
      async () => {
        await git.shelvePath(root, change);
      }
    );
  }

  async toggleChange(relativePath, checked) {
    await this.toggleChanges([relativePath], checked);
  }

  async toggleChanges(relativePaths, checked) {
    if (this.userOperationPending
      || !Array.isArray(relativePaths)
      || !this.state.selectedRoot) {
      return;
    }

    const knownPaths = new Set(this.state.changes.map((change) => change.path));
    const paths = relativePaths
      .map((relativePath) => String(relativePath ?? ''))
      .filter((relativePath) => knownPaths.has(relativePath));

    if (paths.length === 0) {
      return;
    }

    const pathStates = new Map(paths.map((relativePath) => [relativePath, checked]));

    this.queueStagingStates(this.state.selectedRoot, pathStates);
  }

  async applyStagingBatch(changeStates, requestId, requestedRoot) {
    const root = String(requestedRoot || '');
    const normalizedRequestId = String(requestId || '').slice(0, 200);
    const knownRepository = this.state.repositories.some((repository) => repository.root === root);

    if (this.userOperationPending
      || this.repositorySelectionPending
      || !Array.isArray(changeStates)
      || !root
      || !knownRepository
      || root !== this.state.selectedRoot) {
      this.acknowledgeStagingRequest(normalizedRequestId, false);
      return;
    }

    const knownPaths = new Set(this.state.changes.map((change) => change.path));
    const pathStates = new Map();

    for (const changeState of changeStates) {
      const relativePath = String(changeState?.path ?? '');

      if (knownPaths.has(relativePath)) {
        pathStates.set(relativePath, Boolean(changeState.checked));
      }
    }

    if (pathStates.size === 0) {
      this.acknowledgeStagingRequest(normalizedRequestId, false);
      return;
    }

    this.queueStagingStates(
      root,
      pathStates,
      {
        requestId: normalizedRequestId
      }
    );
  }

  async refreshStagingRoots(touchedRoots) {
    const root = this.state.selectedRoot;

    if (!root || !touchedRoots.has(root)) {
      return { ok: true };
    }

    try {
      const changes = await git.getStatus(root, { timeout: 5_000 });

      if (this.state.selectedRoot !== root) {
        return {
          ok: false,
          error: new Error('The selected repository changed while Git status was updating.')
        };
      }

      this.reconcileFailedStagingPaths(changes);
      const nextChanges = areChangeListsEqual(this.state.changes, changes)
        ? this.state.changes
        : changes;
      const stagedCount = nextChanges.filter((change) => change.staged).length;
      const selectedPath = nextChanges.some(
        (change) => change.path === this.state.selectedPath
      )
        ? this.state.selectedPath
        : nextChanges[0]?.path || '';

      this.state = {
        ...this.state,
        changes: nextChanges,
        selectedPath,
        stagedCount,
        totalCount: nextChanges.length,
        canGenerate: stagedCount > 0,
        statusText: formatStatusText(stagedCount, nextChanges.length)
      };

      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  queueStagingOperation(root, paths, checked) {
    this.queueStagingStates(
      root,
      new Map(paths.map((relativePath) => [relativePath, checked]))
    );
  }

  queueStagingStates(root, pathStates, options = {}) {
    const requestId = String(options.requestId || '');

    this.invalidateRefreshWork();
    this.stagingStateVersion += 1;
    this.state = {
      ...this.state,
      confirmedStagingRequestIds: [],
      failedStagingRequestIds: []
    };

    for (const [relativePath, checked] of pathStates.entries()) {
      this.stagingBatch.add(root, [relativePath], checked, requestId);
    }

    if (this.stagingBatch.hasPending()) {
      this.scheduleStagingFlush();
    }
  }

  scheduleStagingFlush(delayMs = 90) {
    if (this.pendingStagingOperations > 0) {
      return;
    }

    this.clearStagingFlushTimer();
    this.stagingFlushTimer = setTimeout(
      () => {
        this.stagingFlushTimer = undefined;
        this.flushQueuedStagingOperations();
      },
      delayMs
    );
  }

  clearStagingFlushTimer() {
    if (!this.stagingFlushTimer) {
      return;
    }

    clearTimeout(this.stagingFlushTimer);
    this.stagingFlushTimer = undefined;
  }

  hasPendingStagingWork() {
    return this.pendingStagingOperations > 0
      || Boolean(this.stagingFlushTimer)
      || this.stagingBatch.hasPending();
  }

  flushQueuedStagingOperations() {
    if (this.pendingStagingOperations > 0) {
      return;
    }

    this.clearStagingFlushTimer();
    const batches = this.stagingBatch.take();

    if (batches.length === 0) {
      return;
    }

    this.pendingStagingOperations += 1;
    const previousOperation = this.operation.catch(() => {});
    this.operation = previousOperation.then(
      async () => {
        const confirmedStagingRequestIds = [];
        const failedStagingRequestIds = [];
        const completedBatches = [];
        const touchedRoots = new Set();
        let firstError;
        const previousFailureCount = this.failedStagingPaths.size;

        try {
          for (const batch of batches) {
            touchedRoots.add(batch.root);

            try {
              await git.setPathsStaged(
                batch.root,
                batch.stagePaths,
                batch.unstagePaths
              );
              completedBatches.push(batch);
            } catch (error) {
              firstError ??= error;

              for (const relativePath of batch.stagePaths) {
                this.failedStagingPaths.set(relativePath, true);
              }

              for (const relativePath of batch.unstagePaths) {
                this.failedStagingPaths.set(relativePath, false);
              }

              failedStagingRequestIds.push(...batch.requestIds);
            }
          }

          const statusResult = await this.refreshStagingRoots(touchedRoots);

          if (statusResult.ok) {
            const changesByOutcomePath = stagingOutcomeMap(this.state.changes);

            for (const batch of completedBatches) {
              if (stagingBatchMatchesStatus(batch, changesByOutcomePath)) {
                for (const relativePath of [...batch.stagePaths, ...batch.unstagePaths]) {
                  this.failedStagingPaths.delete(relativePath);
                }

                confirmedStagingRequestIds.push(...batch.requestIds);
                continue;
              }

              firstError ??= new Error(
                'Files changed again before their Git index state could be confirmed. Review the refreshed changes and try again.'
              );

              for (const relativePath of batch.stagePaths) {
                this.failedStagingPaths.set(relativePath, true);
              }

              for (const relativePath of batch.unstagePaths) {
                this.failedStagingPaths.set(relativePath, false);
              }

              failedStagingRequestIds.push(...batch.requestIds);
            }
          } else {
            firstError ??= new Error(
              `Git changes were updated, but their status could not be refreshed: ${errorDetails(statusResult.error)}`
            );

            for (const batch of completedBatches) {
              for (const relativePath of batch.stagePaths) {
                this.failedStagingPaths.set(relativePath, true);
              }

              for (const relativePath of batch.unstagePaths) {
                this.failedStagingPaths.set(relativePath, false);
              }

              failedStagingRequestIds.push(...batch.requestIds);
            }
          }

          if (firstError) {
            this.stagingErrorText = formatError(firstError);
            this.feedbackVersion += 1;
          } else if (this.failedStagingPaths.size === 0) {
            if (previousFailureCount > 0 || this.stagingErrorText) {
              this.feedbackVersion += 1;
            }

            this.stagingErrorText = '';
          }

          this.state = {
            ...this.state,
            confirmedStagingRequestIds: [...new Set(confirmedStagingRequestIds)],
            failedStagingRequestIds: [...new Set(failedStagingRequestIds)],
            errorText: this.stagingErrorText
          };
        } finally {
          this.pendingStagingOperations = Math.max(
            0,
            this.pendingStagingOperations - 1
          );

          if (!this.disposed && this.pendingStagingOperations === 0) {
            if (this.stagingBatch.hasPending()) {
              this.scheduleStagingFlush(0);
            } else {
              const stagingErrorText = this.stagingErrorText;
              this.scheduleRefresh(
                stagingErrorText ? 0 : 650,
                { preserveErrorText: stagingErrorText, refreshDiff: true }
              );
            }
          }

          if (!this.disposed) {
            this.postState();
          }
        }
      }
    );
  }

  async flushPendingStagingWork() {
    this.clearStagingFlushTimer();

    while (this.stagingBatch.hasPending() || this.pendingStagingOperations > 0) {
      if (this.pendingStagingOperations === 0 && this.stagingBatch.hasPending()) {
        this.flushQueuedStagingOperations();
      }

      const activeOperation = this.operation;
      await activeOperation.catch(() => {});
      this.clearStagingFlushTimer();

      if (activeOperation === this.operation
        && this.pendingStagingOperations === 0
        && !this.stagingBatch.hasPending()) {
        break;
      }
    }

    return this.failedStagingPaths.size === 0;
  }

  async stageAll() {
    const root = this.state.selectedRoot;
    await this.flushPendingStagingWork();

    if (!root || this.state.selectedRoot !== root) {
      return;
    }

    await this.enqueueOperation(
      'Checking all changes...',
      async () => {
        await git.stageAll(root);
        this.clearStagingFailures();
      }
    );
  }

  async unstageAll() {
    const root = this.state.selectedRoot;
    await this.flushPendingStagingWork();

    if (!root || this.state.selectedRoot !== root) {
      return;
    }

    await this.enqueueOperation(
      'Unchecking all changes...',
      async () => {
        await git.unstageAll(root);
        this.clearStagingFailures();
      }
    );
  }

  async generateCommitMessage() {
    const root = this.state.selectedRoot;
    const messageVersionAtStart = this.state.messageVersion;

    if (!await this.flushPendingStagingWork()) {
      return;
    }

    if (!root || this.state.selectedRoot !== root) {
      this.reportPanelWarning('Open a Git repository first.');
      return;
    }

    if (!this.state.canGenerate) {
      this.reportPanelWarning('Check at least one change before generating a commit message.');
      return;
    }

    await this.enqueueOperation(
      'Generating commit message...',
      async () => {
        const diff = await git.getStagedDiff(root);
        if (!diff.trim()) {
          throw new Error('No checked changes are staged for commit message generation.');
        }

        const generated = await generateCommitMessageWithLanguageModel(
          {
            diff,
            changes: this.state.changes.filter((change) => change.staged),
            lastCommit: this.state.lastCommit,
            commitLanguage: this.state.commitLanguage,
            timeoutMs: this.languageModelTimeoutMs
          }
        );

        if (this.state.messageVersion !== messageVersionAtStart) {
          this.reportPanelWarning(
            'The draft changed while the commit message was being generated, so the newer draft was kept.'
          );
          return;
        }

        this.state.message = generated;
        this.state.messageVersion += 1;
      },
      { refreshAfter: false }
    );
  }

  async commit(pushAfterCommit) {
    const root = this.state.selectedRoot;
    const message = this.state.message.trim();
    const messageVersionAtStart = this.state.messageVersion;
    const amendAtStart = this.state.amend;
    const amendVersionAtStart = this.state.amendVersion;

    if (!await this.flushPendingStagingWork()) {
      return;
    }

    if (!root || this.state.selectedRoot !== root) {
      this.reportPanelWarning('Open a Git repository first.');
      return;
    }

    if (!message) {
      this.reportPanelWarning('Commit message is required.');
      return;
    }

    await this.enqueueOperation(
      pushAfterCommit ? 'Committing and pushing...' : 'Committing...',
      async () => {
        if (!amendAtStart && !await git.hasStagedChanges(root)) {
          throw new Error('No checked changes to commit.');
        }

        await git.commit(root, message, { amend: amendAtStart });

        if (this.state.messageVersion === messageVersionAtStart) {
          this.state.message = '';
          this.state.messageVersion += 1;
        }

        if (this.state.amendVersion === amendVersionAtStart) {
          this.state.amend = false;
          this.state.amendVersion += 1;
        }

        if (pushAfterCommit) {
          try {
            await git.push(root);
          } catch (error) {
            await this.refresh({ refreshDiff: true, allowDuringOperation: true });
            throw new Error(`Commit was created locally, but push failed: ${errorDetails(error)}`);
          }
        }
      }
    );
  }

  async openFileByPath(relativePath) {
    const change = this.findChange(relativePath);
    if (!change || !this.state.selectedRoot) {
      return;
    }

    const uri = vscode.Uri.file(path.join(this.state.selectedRoot, change.path));

    if (git.fileExists(this.state.selectedRoot, change.path)) {
      await vscode.commands.executeCommand('vscode.open', uri);
      return;
    }

    await this.openDiff(change);
  }

  async openDiffByPath(relativePath) {
    const change = this.findChange(relativePath);
    if (change) {
      await this.openDiff(change);
    }
  }

  async openDiff(change) {
    const root = this.state.selectedRoot;
    if (!root) {
      return;
    }

    const leftPath = change.originalPath ?? change.path;
    const left = createVirtualUri(
      {
        root,
        ref: 'HEAD',
        path: leftPath,
        label: 'HEAD'
      },
      `${path.basename(leftPath)} (HEAD)`
    );
    let right;

    if (change.staged && !change.partiallyStaged) {
      if (change.deletedInView) {
        right = createEmptyUri(`${path.basename(change.path)} (deleted)`);
      } else {
        right = createVirtualUri(
          {
            root,
            ref: 'INDEX',
            path: change.path,
            label: 'INDEX'
          },
          `${path.basename(change.path)} (index)`
        );
      }
    } else if (change.deletedInView) {
      right = createEmptyUri(`${path.basename(change.path)} (deleted)`);
    } else {
      right = vscode.Uri.file(path.join(root, change.path));
    }

    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${change.path} (${change.staged && !change.partiallyStaged ? 'checked' : 'working tree'})`
    );
  }

  findChange(relativePath) {
    return this.state.changes.find((change) => change.path === relativePath);
  }

  async setCommitLanguage(language) {
    const commitLanguage = normalizeCommitLanguage(language);

    this.state = {
      ...this.state,
      commitLanguage
    };

    await this.context.globalState.update(COMMIT_LANGUAGE_STORAGE_KEY, commitLanguage);
    this.postState();
  }

  async enqueueOperation(label, operation, options = {}) {
    if (this.disposed
      || this.userOperationPending
      || this.repositorySelectionPending) {
      return false;
    }

    this.userOperationPending = true;
    const refreshAfter = options.refreshAfter !== false;
    this.invalidateRefreshWork();

    const previousOperation = this.operation.catch(() => {});
    this.operation = previousOperation.then(
      async () => {
        this.feedbackVersion += 1;
        this.state = {
          ...this.state,
          busy: true,
          busyText: label,
          errorText: this.stagingErrorText
        };
        this.postState();

        try {
          await operation();
          if (refreshAfter) {
            this.clearScheduledRefresh();
            await this.refresh({ refreshDiff: true, allowDuringOperation: true });
          }
          return true;
        } catch (error) {
          this.reportPanelError(error, `${label} failed`);
          return false;
        } finally {
          this.state = {
            ...this.state,
            busy: false,
            busyText: ''
          };

          if (!this.disposed) {
            this.postState();
          }
        }
      }
    );

    try {
      return await this.operation;
    } finally {
      this.userOperationPending = false;
    }
  }

  reportPanelWarning(message) {
    if (this.disposed) {
      return;
    }

    this.feedbackVersion += 1;
    this.state = {
      ...this.state,
      errorText: this.stagingErrorText,
      statusText: message
    };
    this.postState();
  }

  reportPanelError(error, statusText) {
    if (this.disposed) {
      return;
    }

    this.feedbackVersion += 1;
    const operationErrorText = typeof error === 'string' ? error : formatError(error);
    const errorText = this.stagingErrorText && this.stagingErrorText !== operationErrorText
      ? `${this.stagingErrorText}\n${operationErrorText}`
      : operationErrorText;
    this.state = {
      ...this.state,
      errorText,
      statusText: statusText || this.state.statusText
    };
    this.postState();
  }

  scheduleRefresh(delayMs, options = {}, shouldRun) {
    if (this.disposed) {
      return;
    }

    this.clearScheduledRefresh();
    this.pendingRefreshTimer = setTimeout(
      () => {
        this.pendingRefreshTimer = undefined;

        if (shouldRun && !shouldRun()) {
          return;
        }

        void this.refresh(options).catch(
          (error) => {
            this.reportPanelError(error, 'Git status failed');
          }
        );
      },
      delayMs
    );
  }

  clearScheduledRefresh() {
    if (!this.pendingRefreshTimer) {
      return;
    }

    clearTimeout(this.pendingRefreshTimer);
    this.pendingRefreshTimer = undefined;
  }

  postState(force = false) {
    if (!this.view || this.disposed) {
      return;
    }

    const stateSnapshot = { ...this.state };
    const previousSnapshot = this.lastPostedStateSnapshot;
    const stateKeys = Object.keys(stateSnapshot);
    const removedKey = previousSnapshot
      ? Object.keys(previousSnapshot).some(
        (key) => !Object.prototype.hasOwnProperty.call(stateSnapshot, key)
      )
      : false;
    const changedKeys = previousSnapshot
      ? stateKeys.filter(
        (key) => !Object.is(previousSnapshot[key], stateSnapshot[key])
      )
      : stateKeys;

    if (!force && changedKeys.length === 0 && !removedKey) {
      return;
    }

    const partial = !force
      && Boolean(previousSnapshot)
      && !removedKey
      && changedKeys.length > 0;
    const statePayload = partial
      ? Object.fromEntries(changedKeys.map((key) => [key, this.state[key]]))
      : this.state;
    const wireStatePayload = Object.fromEntries(
      Object.entries(statePayload).map(
        ([key, value]) => [key, value === undefined ? null : value]
      )
    );
    this.lastPostedStateSnapshot = stateSnapshot;

    const delivery = this.view.webview.postMessage(
      {
        type: 'state',
        state: wireStatePayload,
        partial
      }
    );

    Promise.resolve(delivery).then(
      (delivered) => {
        if (!delivered && this.lastPostedStateSnapshot === stateSnapshot) {
          this.lastPostedStateSnapshot = undefined;
        }
      },
      () => {
        if (this.lastPostedStateSnapshot === stateSnapshot) {
          this.lastPostedStateSnapshot = undefined;
        }
      }
    );
  }
}

class GitVirtualDocumentProvider {
  async provideTextDocumentContent(uri) {
    const payload = decodePayload(uri.query);

    if (payload.kind === 'empty') {
      return '';
    }

    return git.getObjectText(payload.root, payload.ref, payload.path);
  }
}

async function generateCommitMessageWithLanguageModel({
  diff,
  changes,
  lastCommit,
  commitLanguage,
  timeoutMs = DEFAULT_LANGUAGE_MODEL_TIMEOUT_MS
}) {
  if (!vscode.lm?.selectChatModels || !vscode.LanguageModelChatMessage) {
    throw new Error('VS Code Language Model API is not available in this VS Code build.');
  }

  const tokenSource = new vscode.CancellationTokenSource();
  const configuredTimeoutMs = Number(timeoutMs);
  const normalizedTimeoutMs = Number.isFinite(configuredTimeoutMs)
    ? Math.min(600_000, Math.max(1, configuredTimeoutMs))
    : DEFAULT_LANGUAGE_MODEL_TIMEOUT_MS;
  const timeoutError = new Error(
    `Language model request timed out after ${Math.ceil(normalizedTimeoutMs / 1000)} seconds.`
  );
  timeoutError.code = 'LANGUAGE_MODEL_TIMEOUT';
  let timeoutHandle;
  let timedOut = false;
  const timeoutPromise = new Promise(
    (_resolve, reject) => {
      timeoutHandle = setTimeout(
        () => {
          timedOut = true;
          tokenSource.cancel();
          reject(timeoutError);
        },
        normalizedTimeoutMs
      );
    }
  );
  const throwIfTimedOut = () => {
    if (timedOut) {
      throw timeoutError;
    }
  };
  const runRequest = async () => {
    let models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    throwIfTimedOut();

    if (models.length === 0) {
      models = await vscode.lm.selectChatModels();
      throwIfTimedOut();
    }

    if (models.length === 0) {
      throw new Error('No VS Code language model provider is available. Sign in to GitHub Copilot Chat or another VS Code LM provider.');
    }

    const model = models[0];
    const limitedDiff = limitDiff(diff, model.maxInputTokens);
    const files = changes
      .slice(0, 80)
      .map((change) => `- ${change.kind}: ${change.path}`)
      .join('\n');
    const truncatedNote = limitedDiff.length < diff.length
      ? '\n\nNote: the diff was truncated to fit the model context.'
      : '';
    const prompt = [
      'Generate one Git commit message for the staged diff below.',
      'Requirements:',
      '- First line: concise imperative subject, 72 characters or fewer.',
      '- Use a conventional commit prefix when it clearly fits, otherwise use a plain imperative subject.',
      '- Add a short body only if it materially improves clarity.',
      '- Return only the commit message text.',
      '- Do not wrap the answer in quotes, markdown, or code fences.',
      '- Do not mention AI or tooling.',
      `- ${formatCommitLanguageInstruction(commitLanguage)}`,
      '',
      `Previous commit for style context: ${lastCommit || 'none'}`,
      '',
      'Staged files:',
      files || '- staged files unavailable',
      '',
      'Diff:',
      limitedDiff,
      truncatedNote
    ].join('\n');
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {},
      tokenSource.token
    );
    throwIfTimedOut();
    let text = '';

    for await (const fragment of response.text) {
      throwIfTimedOut();
      text += fragment;
    }

    throwIfTimedOut();
    return sanitizeGeneratedCommitMessage(text);
  };
  const requestPromise = runRequest();

  try {
    return await Promise.race(
      [requestPromise, timeoutPromise]
    );
  } finally {
    clearTimeout(timeoutHandle);
    tokenSource.dispose();
  }
}

function limitDiff(diff, maxInputTokens) {
  const tokenBudget = Math.max(2000, Math.min(maxInputTokens || 8000, 12000));
  const charBudget = tokenBudget * 3;

  if (diff.length <= charBudget) {
    return diff;
  }

  return diff.slice(0, charBudget);
}

function sanitizeGeneratedCommitMessage(value) {
  let text = String(value ?? '').trim();
  text = text.replace(/^```(?:git|text|markdown)?\s*/i, '').replace(/```$/i, '').trim();
  text = text.replace(/^commit message:\s*/i, '').trim();

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, '').trimEnd());

  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }

  if (lines.length === 0) {
    throw new Error('The language model returned an empty commit message.');
  }

  lines[0] = stripWrappingQuotes(lines[0].trim());

  return lines.slice(0, 12).join('\n').trim();
}

function normalizeCommitLanguage(language) {
  const value = String(language || 'auto').trim().toLowerCase();

  return COMMIT_LANGUAGE_OPTIONS.has(value) ? value : 'auto';
}

function formatCommitLanguageInstruction(language) {
  switch (normalizeCommitLanguage(language)) {
    case 'en':
      return 'Write the commit message in English.';
    case 'ru':
      return 'Write the natural-language commit message text in Russian; keep conventional commit prefixes, scopes, file names, commands, and code identifiers unchanged.';
    default:
      return 'Use the repository commit history language when it is clear; otherwise write the commit message in English.';
  }
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('`') && value.endsWith('`'))
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function formatStatusText(stagedCount, totalCount) {
  if (totalCount === 0) {
    return 'No changes.';
  }

  return `${stagedCount}/${totalCount} checked`;
}

function createEmptyUri(label) {
  return createVirtualUri(
    {
      kind: 'empty'
    },
    label
  );
}

function createVirtualUri(payload, label) {
  return vscode.Uri.from(
    {
      scheme: VIRTUAL_SCHEME,
      authority: 'git',
      path: `/${encodeURIComponent(label)}`,
      query: encodePayload(payload),
      fragment: String(++virtualDocumentVersion)
    }
  );
}

function encodePayload(payload) {
  return Buffer
    .from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodePayload(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function formatError(error) {
  return `PhpStorm Git Panel: ${errorDetails(error)}`;
}

function errorDetails(error) {
  const details = error?.stderr || error?.message || String(error);
  return String(details).trim();
}

function mergeRefreshOptions(current, next) {
  if (!current) {
    return { ...next };
  }

  const merged = {
    ...current,
    ...next,
    force: Boolean(current.force || next.force),
    refreshDiff: Boolean(current.refreshDiff || next.refreshDiff)
  };

  if (!next.force
    && typeof next.preserveErrorText !== 'string'
    && typeof current.preserveErrorText === 'string') {
    merged.preserveErrorText = current.preserveErrorText;
  } else if (next.force && typeof next.preserveErrorText !== 'string') {
    delete merged.preserveErrorText;
  }

  if (next.force && typeof next.showProgress !== 'boolean') {
    delete merged.showProgress;
  }

  return merged;
}

function stagingOutcomeMap(changes) {
  const outcomes = new Map();

  for (const change of changes || []) {
    outcomes.set(change.path, change);
  }

  for (const change of changes || []) {
    const rename = change.kind === 'renamed'
      || change.indexStatus === 'R'
      || change.worktreeStatus === 'R';

    if (rename && change.originalPath && !outcomes.has(change.originalPath)) {
      outcomes.set(change.originalPath, change);
    }
  }

  return outcomes;
}

function stagingBatchMatchesStatus(batch, changesByOutcomePath) {
  const stagedPathsMatch = batch.stagePaths.every(
    (relativePath) => {
      const change = changesByOutcomePath.get(relativePath);
      return Boolean(change?.staged) && !change.partiallyStaged;
    }
  );

  if (!stagedPathsMatch) {
    return false;
  }

  return batch.unstagePaths.every(
    (relativePath) => {
      const change = changesByOutcomePath.get(relativePath);
      return !change || !change.staged;
    }
  );
}

function areChangeListsEqual(first, second) {
  if (first === second) {
    return true;
  }

  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
    return false;
  }

  for (let index = 0; index < first.length; index += 1) {
    if (!areStateSnapshotsShallowEqual(first[index], second[index])) {
      return false;
    }
  }

  return true;
}

function areStateSnapshotsShallowEqual(first, second) {
  if (!first) {
    return false;
  }

  const keys = Object.keys(second);

  if (Object.keys(first).length !== keys.length) {
    return false;
  }

  return keys.every((key) => Object.is(first[key], second[key]));
}

function abortable(value, signal) {
  if (!signal) {
    return Promise.resolve(value);
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise(
    (resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(createAbortError());
      };
      const cleanup = () => signal.removeEventListener('abort', onAbort);

      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(value).then(
        (result) => {
          cleanup();
          resolve(result);
        },
        (error) => {
          cleanup();
          reject(error);
        }
      );
    }
  );
}

function createAbortError() {
  const error = new Error('Operation aborted.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function activate(context) {
  const provider = new PhpStormCommitPanelProvider(context);
  const virtualDocuments = new GitVirtualDocumentProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.workspace.registerTextDocumentContentProvider(VIRTUAL_SCHEME, virtualDocuments),
    vscode.commands.registerCommand(
      'phpstormGitPanel.refresh',
      () => provider.refresh({ force: true })
    ),
    vscode.commands.registerCommand('phpstormGitPanel.stageAll', () => provider.stageAll()),
    vscode.commands.registerCommand('phpstormGitPanel.unstageAll', () => provider.unstageAll()),
    vscode.commands.registerCommand(
      'phpstormGitPanel.generateCommitMessage',
      () => provider.generateCommitMessage()
    ),
    vscode.commands.registerCommand('phpstormGitPanel.commit', () => provider.commit(false)),
    vscode.commands.registerCommand(
      'phpstormGitPanel.commitAndPush',
      () => provider.commit(true)
    ),
    vscode.commands.registerCommand(
      'phpstormGitPanel.openSettings',
      () => vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'phpstormGitPanel'
      )
    ),
    vscode.workspace.onDidSaveTextDocument(
      () => provider.refreshWhenVisible({ refreshDiff: true })
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(
      () => provider.refreshWhenVisible({ force: true })
    )
  );

  let intervalHandle;
  const restartAutoRefresh = () => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
    }

    intervalHandle = setInterval(
      () => {
        if (provider.view?.visible) {
          void provider.refresh();
        }
      },
      getRefreshInterval()
    );
  };
  restartAutoRefresh();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(
      (event) => {
        if (event.affectsConfiguration('phpstormGitPanel.autoRefreshIntervalMs')) {
          restartAutoRefresh();
        }
      }
    ),
    {
      dispose() {
        if (intervalHandle) {
          clearInterval(intervalHandle);
          intervalHandle = undefined;
        }
      }
    }
  );
}

function getRefreshInterval() {
  const configuredValue = vscode.workspace
    .getConfiguration('phpstormGitPanel')
    .get('autoRefreshIntervalMs', 5000);
  const interval = Number(configuredValue);

  return Number.isFinite(interval)
    ? Math.min(3_600_000, Math.max(1000, interval))
    : 5000;
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  formatCommitLanguageInstruction,
  normalizeCommitLanguage,
  PhpStormCommitPanelProvider,
  sanitizeGeneratedCommitMessage
};
