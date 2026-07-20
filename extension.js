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
const DISABLED_SOUND_SETTINGS = [
  ['accessibility.signalOptions.volume', 0],
  ['accessibility.signals.sound', 'never'],
  ['accessibility.signals.chatEditModifiedFile.sound', 'never'],
  ['accessibility.signals.chatRequestSent.sound', 'never'],
  ['accessibility.signals.chatResponseReceived.sound', 'never'],
  ['accessibility.signals.chatUserActionRequired.sound', 'never'],
  ['accessibility.signals.clear.sound', 'never'],
  ['accessibility.signals.codeActionApplied.sound', 'never'],
  ['accessibility.signals.codeActionTriggered.sound', 'never'],
  ['accessibility.signals.diffLineDeleted.sound', 'never'],
  ['accessibility.signals.diffLineModified.sound', 'never'],
  ['accessibility.signals.editsKept.sound', 'never'],
  ['accessibility.signals.editsUndone.sound', 'never'],
  ['accessibility.signals.format.sound', 'never'],
  ['accessibility.signals.lineHasBreakpoint.sound', 'never'],
  ['accessibility.signals.lineHasError.sound', 'never'],
  ['accessibility.signals.lineHasFoldedArea.sound', 'never'],
  ['accessibility.signals.lineHasInlineSuggestion.sound', 'never'],
  ['accessibility.signals.lineHasWarning.sound', 'never'],
  ['accessibility.signals.nextEditSuggestion.sound', 'never'],
  ['accessibility.signals.noInlayHints.sound', 'never'],
  ['accessibility.signals.notebookCellCompleted.sound', 'never'],
  ['accessibility.signals.notebookCellFailed.sound', 'never'],
  ['accessibility.signals.onDebugBreak.sound', 'never'],
  ['accessibility.signals.positionHasError.sound', 'never'],
  ['accessibility.signals.positionHasWarning.sound', 'never'],
  ['accessibility.signals.progress.sound', 'never'],
  ['accessibility.signals.save.sound', 'never'],
  ['accessibility.signals.taskCompleted.sound', 'never'],
  ['accessibility.signals.taskFailed.sound', 'never'],
  ['accessibility.signals.terminalBell.sound', 'never'],
  ['accessibility.signals.terminalCommandFailed.sound', 'never'],
  ['accessibility.signals.terminalCommandSucceeded.sound', 'never'],
  ['accessibility.signals.terminalQuickFix.sound', 'never'],
  ['accessibility.signals.voiceRecordingStarted.sound', 'never'],
  ['accessibility.signals.voiceRecordingStopped.sound', 'never'],
  ['terminal.integrated.enableBell', false]
];

let editorSoundsDisabledPromise;

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
    this.diffRequestId = 0;
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
      amend: false,
      lastCommit: '',
      commitLanguage,
      busy: false,
      busyText: '',
      statusText: 'Open a folder with a Git repository.',
      errorText: '',
      confirmedStagingRequestIds: [],
      stagedCount: 0,
      totalCount: 0,
      canGenerate: false
    };

    this.context.subscriptions.push(
      {
        dispose: () => {
          this.clearScheduledRefresh();
          this.clearStagingFlushTimer();
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
    this.view = webviewView;
    this.renderPanelWebview();

    this.context.subscriptions.push(
      webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message)),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this.refresh();
        }
      })
    );
  }

  renderPanelWebview() {
    if (!this.view) {
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
    this.view.webview.html = renderWebview(this.view.webview, fileIconTheme, this.context.extensionUri);
  }

  async handleMessage(message) {
    switch (message?.type) {
      case 'ready':
        this.restoreWebviewUiState(message.ui);
        await this.refresh();
        return;
      case 'refresh':
        await this.refresh({ force: true });
        return;
      case 'selectRepository':
        this.state.selectedRoot = message.root;
        this.state.selectedPath = '';
        this.state.diffPreview = undefined;
        await this.refresh({ force: true });
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
        await this.selectChange(String(message.path ?? ''));
        return;
      case 'toggleHunk':
        await this.toggleHunk(String(message.path ?? ''), String(message.hunkId ?? ''), Boolean(message.checked));
        return;
      case 'setMessage':
        this.state.message = String(message.message ?? '');
        this.postState();
        return;
      case 'setAmend':
        this.state.amend = Boolean(message.amend);
        this.postState();
        return;
      case 'setCommitLanguage':
        await this.setCommitLanguage(message.language);
        return;
      case 'toggleChange':
        await this.toggleChange(String(message.path ?? ''), Boolean(message.checked));
        return;
      case 'toggleChanges':
        await this.toggleChanges(message.paths, Boolean(message.checked));
        return;
      case 'applyStagingBatch':
        await this.applyStagingBatch(message.changes, String(message.requestId ?? ''));
        return;
      case 'stageAll':
        await this.stageAll();
        return;
      case 'unstageAll':
        await this.unstageAll();
        return;
      case 'openDiff':
        await this.openDiffByPath(String(message.path ?? ''));
        return;
      case 'openFile':
        await this.openFileByPath(String(message.path ?? ''));
        return;
      case 'locateActiveFile':
        await this.locateActiveFile();
        return;
      case 'rollbackChange':
        await this.rollbackChange(String(message.path ?? ''));
        return;
      case 'shelveChange':
        await this.shelveChange(String(message.path ?? ''));
        return;
      case 'generateCommitMessage':
        await this.generateCommitMessage();
        return;
      case 'commit':
        await this.commit(false);
        return;
      case 'commitAndPush':
        await this.commit(true);
        return;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'phpstormGitPanel');
        return;
      default:
        return;
    }
  }

  async refresh(options = {}) {
    if (this.hasPendingStagingWork() && !options.force) {
      this.scheduleRefresh(700, options);
      return;
    }

    if (this.refreshing) {
      return;
    }

    const stagingStateVersion = this.stagingStateVersion;

    if (options.force) {
      this.clearScheduledRefresh();

      if (typeof options.preserveErrorText !== 'string') {
        this.stagingErrorText = '';
      }
    }

    const preservedErrorText = typeof options.preserveErrorText === 'string'
      ? options.preserveErrorText
      : this.stagingErrorText;
    this.refreshing = true;
    this.state = {
      ...this.state,
      errorText: preservedErrorText,
      statusText: this.state.busy ? this.state.statusText : 'Changes updating...'
    };
    this.postState();

    try {
      const roots = await this.resolveRepositories();
      const selectedRoot = this.pickSelectedRoot(roots);
      const repositories = roots.map((root) => ({
        root,
        name: path.basename(root)
      }));

      if (!selectedRoot) {
        this.state = {
          ...this.state,
          repositories,
          selectedRoot: undefined,
          repoName: '',
          changes: [],
          ignoredFiles: [],
          selectedPath: '',
          diffPreview: undefined,
          lastCommit: '',
          statusText: 'Open a folder with a Git repository.',
          stagedCount: 0,
          totalCount: 0,
          canGenerate: false
        };
        return;
      }

      const [changes, lastCommit, ignoredFiles] = await Promise.all([
        git.getStatus(selectedRoot),
        git.getLastCommitSummary(selectedRoot),
        this.state.showIgnored ? git.listIgnoredFiles(selectedRoot) : Promise.resolve([])
      ]);

      if (stagingStateVersion !== this.stagingStateVersion) {
        return;
      }

      const stagedCount = changes.filter((change) => change.staged).length;
      const totalCount = changes.length;

      this.state = {
        ...this.state,
        repositories,
        selectedRoot,
        repoName: path.basename(selectedRoot),
        changes,
        ignoredFiles,
        lastCommit,
        statusText: formatStatusText(stagedCount, totalCount),
        stagedCount,
        totalCount,
        canGenerate: stagedCount > 0
      };

      if (this.state.diffPreviewEnabled) {
        const selectedStillExists = changes.some((change) => change.path === this.state.selectedPath);
        this.state.selectedPath = selectedStillExists
          ? this.state.selectedPath
          : changes[0]?.path || '';
        await this.loadDiffPreview({ post: false });
      } else {
        this.state.diffPreview = undefined;
      }
    } catch (error) {
      this.reportPanelError(error, 'Git status failed');
    } finally {
      this.refreshing = false;
      this.postState();
    }
  }

  async resolveRepositories() {
    const candidates = [];
    const activeEditor = vscode.window.activeTextEditor;

    if (activeEditor) {
      const folder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
      if (folder) {
        candidates.push(folder.uri.fsPath);
      }
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      candidates.push(folder.uri.fsPath);
    }

    const repositories = [];
    const seen = new Set();

    for (const candidate of candidates) {
      const root = await git.findRepositoryRoot(candidate);
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

    return repositories;
  }

  pickSelectedRoot(roots) {
    if (roots.length === 0) {
      return undefined;
    }

    if (this.state.selectedRoot && roots.includes(this.state.selectedRoot)) {
      return this.state.selectedRoot;
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

  async setDiffPreviewEnabled(enabled) {
    this.state.diffPreviewEnabled = enabled;

    if (!enabled) {
      this.diffRequestId += 1;
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
    const requestId = ++this.diffRequestId;
    const root = this.state.selectedRoot;
    const change = this.findChange(this.state.selectedPath);

    if (!this.state.diffPreviewEnabled || !root || !change) {
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
      const [preview, blame] = await Promise.all([
        git.getFileDiff(root, change, {
          contextLines: 3,
          ignorePolicy: this.state.diffIgnorePolicy
        }),
        this.state.showBlame ? git.getBlame(root, change.path) : Promise.resolve({})
      ]);
      preview.blame = blame;

      if (this.diffRequestId === requestId
        && this.state.diffPreviewEnabled
        && this.state.selectedRoot === root
        && this.state.selectedPath === requestedPath) {
        this.state.diffPreview = preview;
      }
    } catch (error) {
      if (this.diffRequestId === requestId
        && this.state.diffPreviewEnabled
        && this.state.selectedRoot === root
        && this.state.selectedPath === requestedPath) {
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
      if (this.diffRequestId === requestId
        && this.state.diffPreviewEnabled
        && this.state.selectedRoot === root
        && this.state.selectedPath === requestedPath) {
        this.state.diffLoading = false;
      }

      if (options.post !== false) {
        this.postState();
      }
    }
  }

  async toggleHunk(relativePath, hunkId, checked) {
    const root = this.state.selectedRoot;
    const change = this.findChange(relativePath);

    if (!root || !change || !hunkId) {
      return;
    }

    await this.enqueueOperation('Updating included changes...', async () => {
      await git.setHunkIncluded(root, change, hunkId, checked, {
        contextLines: 3,
        ignorePolicy: this.state.diffIgnorePolicy
      });
    });
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

  async rollbackChange(relativePath) {
    const root = this.state.selectedRoot;
    const change = this.findChange(relativePath);

    if (!root || !change) {
      return;
    }

    await this.enqueueOperation('Rolling back selected change...', async () => {
      await git.rollbackPath(root, change);
    });
  }

  async shelveChange(relativePath) {
    const root = this.state.selectedRoot;
    const change = this.findChange(relativePath);

    if (!root || !change) {
      return;
    }

    await this.enqueueOperation('Shelving selected change...', async () => {
      await git.shelvePath(root, change);
    });
  }

  async toggleChange(relativePath, checked) {
    await this.toggleChanges([relativePath], checked);
  }

  async toggleChanges(relativePaths, checked) {
    if (!Array.isArray(relativePaths) || !this.state.selectedRoot) {
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

    this.applyOptimisticStagingStates(pathStates);
    this.queueStagingStates(this.state.selectedRoot, pathStates);
  }

  async applyStagingBatch(changeStates, requestId) {
    if (!Array.isArray(changeStates) || !this.state.selectedRoot) {
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
      return;
    }

    this.applyOptimisticStagingStates(pathStates);
    this.queueStagingStates(
      this.state.selectedRoot,
      pathStates,
      {
        flushNow: true,
        requestId: String(requestId || '').slice(0, 200)
      }
    );
  }

  applyOptimisticStaging(paths, checked) {
    this.applyOptimisticStagingStates(new Map(paths.map((relativePath) => [relativePath, checked])));
  }

  applyOptimisticStagingStates(pathStates) {
    let changed = false;
    const changes = this.state.changes.map((change) => {
      if (!pathStates.has(change.path)) {
        return change;
      }

      const checked = pathStates.get(change.path);

      if (change.staged === checked && !change.partiallyStaged) {
        return change;
      }

      changed = true;
      return {
        ...change,
        staged: checked,
        hasStaged: checked,
        hasUnstaged: !checked,
        partiallyStaged: false
      };
    });

    if (!changed) {
      return;
    }

    const stagedCount = changes.filter((change) => change.staged).length;
    const totalCount = changes.length;
    this.state = {
      ...this.state,
      changes,
      stagedCount,
      totalCount,
      canGenerate: stagedCount > 0,
      statusText: formatStatusText(stagedCount, totalCount),
      errorText: ''
    };
    this.postState();
  }

  queueStagingOperation(root, paths, checked) {
    this.queueStagingStates(
      root,
      new Map(paths.map((relativePath) => [relativePath, checked]))
    );
  }

  queueStagingStates(root, pathStates, options = {}) {
    const startingFresh = !this.hasPendingStagingWork();
    const requestId = String(options.requestId || '');

    this.clearScheduledRefresh();
    this.stagingStateVersion += 1;
    this.state = {
      ...this.state,
      confirmedStagingRequestIds: []
    };

    if (startingFresh) {
      this.stagingErrorText = '';
    }

    for (const [relativePath, checked] of pathStates.entries()) {
      this.stagingBatch.add(root, [relativePath], checked, requestId);
    }

    if (this.stagingBatch.hasPending()) {
      if (options.flushNow) {
        this.flushQueuedStagingOperations();
      } else {
        this.scheduleStagingFlush();
      }
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
    this.operation = this.operation.catch(() => {}).then(async () => {
      const confirmedStagingRequestIds = [];

      try {
        for (const batch of batches) {
          if (batch.stagePaths.length > 0) {
            await git.stagePaths(batch.root, batch.stagePaths);
          }

          if (batch.unstagePaths.length > 0) {
            await git.unstagePaths(batch.root, batch.unstagePaths);
          }

          confirmedStagingRequestIds.push(...batch.requestIds);
        }

        if (!this.stagingErrorText) {
          this.state = {
            ...this.state,
            confirmedStagingRequestIds: [...new Set(confirmedStagingRequestIds)],
            errorText: ''
          };
        }
      } catch (error) {
        this.stagingErrorText = formatError(error);
        this.state = {
          ...this.state,
          confirmedStagingRequestIds: [],
          errorText: this.stagingErrorText
        };
      } finally {
        this.pendingStagingOperations = Math.max(0, this.pendingStagingOperations - 1);

        if (this.pendingStagingOperations === 0) {
          if (this.stagingBatch.hasPending()) {
            this.scheduleStagingFlush(0);
          } else {
            const stagingErrorText = this.stagingErrorText;
            this.scheduleRefresh(
              stagingErrorText ? 0 : 650,
              { preserveErrorText: stagingErrorText }
            );
          }
        }

        this.postState();
      }
    });
  }

  async stageAll() {
    if (!this.state.selectedRoot) {
      return;
    }

    await this.enqueueOperation('Checking all changes...', async () => {
      await git.stageAll(this.state.selectedRoot);
    });
  }

  async unstageAll() {
    if (!this.state.selectedRoot) {
      return;
    }

    await this.enqueueOperation('Unchecking all changes...', async () => {
      await git.unstageAll(this.state.selectedRoot);
    });
  }

  async generateCommitMessage() {
    const root = this.state.selectedRoot;
    if (!root) {
      this.reportPanelWarning('Open a Git repository first.');
      return;
    }

    if (!this.state.canGenerate) {
      this.reportPanelWarning('Check at least one change before generating a commit message.');
      return;
    }

    await this.enqueueOperation('Generating commit message...', async () => {
      const diff = await git.getStagedDiff(root);
      if (!diff.trim()) {
        throw new Error('No checked changes are staged for commit message generation.');
      }

      const generated = await generateCommitMessageWithLanguageModel({
        diff,
        changes: this.state.changes.filter((change) => change.staged),
        lastCommit: this.state.lastCommit,
        commitLanguage: this.state.commitLanguage
      });

      this.state.message = generated;
    }, { refreshAfter: false });
  }

  async commit(pushAfterCommit) {
    const root = this.state.selectedRoot;
    const message = this.state.message.trim();

    if (!root) {
      this.reportPanelWarning('Open a Git repository first.');
      return;
    }

    if (!message) {
      this.reportPanelWarning('Commit message is required.');
      return;
    }

    await this.enqueueOperation(pushAfterCommit ? 'Committing and pushing...' : 'Committing...', async () => {
      if (!this.state.amend && !await git.hasStagedChanges(root)) {
        throw new Error('No checked changes to commit.');
      }

      await git.commit(root, message, { amend: this.state.amend });

      if (pushAfterCommit) {
        await git.push(root);
      }

      this.state.message = '';
      this.state.amend = false;
    });
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

    await ensureEditorSoundsDisabled();

    const leftPath = change.originalPath ?? change.path;
    const left = createVirtualUri({
      root,
      ref: 'HEAD',
      path: leftPath,
      label: 'HEAD'
    }, `${path.basename(leftPath)} (HEAD)`);
    let right;

    if (change.staged && !change.partiallyStaged) {
      if (change.deletedInView) {
        right = createEmptyUri(`${path.basename(change.path)} (deleted)`);
      } else {
        right = createVirtualUri({
          root,
          ref: 'INDEX',
          path: change.path,
          label: 'INDEX'
        }, `${path.basename(change.path)} (index)`);
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
    const refreshAfter = options.refreshAfter !== false;
    this.clearScheduledRefresh();

    this.operation = this.operation.catch(() => {}).then(async () => {
      this.stagingErrorText = '';
      this.state = {
        ...this.state,
        busy: true,
        busyText: label,
        errorText: ''
      };
      this.postState();

      try {
        await operation();
        if (refreshAfter) {
          await this.refresh();
        }
      } catch (error) {
        this.reportPanelError(error, `${label} failed`);
      } finally {
        this.state = {
          ...this.state,
          busy: false,
          busyText: ''
        };
        this.postState();
      }
    });

    await this.operation;
  }

  reportPanelWarning(message) {
    this.state = {
      ...this.state,
      errorText: '',
      statusText: message
    };
    this.postState();
  }

  reportPanelError(error, statusText) {
    this.state = {
      ...this.state,
      errorText: typeof error === 'string' ? error : formatError(error),
      statusText: statusText || this.state.statusText
    };
    this.postState();
  }

  scheduleRefresh(delayMs, options = {}) {
    this.clearScheduledRefresh();
    this.pendingRefreshTimer = setTimeout(
      () => {
        this.pendingRefreshTimer = undefined;
        this.refresh(options);
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

  postState() {
    if (!this.view) {
      return;
    }

    this.view.webview.postMessage({
      type: 'state',
      state: this.state
    });
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

async function generateCommitMessageWithLanguageModel({ diff, changes, lastCommit, commitLanguage }) {
  if (!vscode.lm?.selectChatModels || !vscode.LanguageModelChatMessage) {
    throw new Error('VS Code Language Model API is not available in this VS Code build.');
  }

  let models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (models.length === 0) {
    models = await vscode.lm.selectChatModels();
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
  const tokenSource = new vscode.CancellationTokenSource();

  try {
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {},
      tokenSource.token
    );
    let text = '';

    for await (const fragment of response.text) {
      text += fragment;
    }

    return sanitizeGeneratedCommitMessage(text);
  } finally {
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
  return createVirtualUri({
    kind: 'empty'
  }, label);
}

function createVirtualUri(payload, label) {
  return vscode.Uri.from({
    scheme: VIRTUAL_SCHEME,
    authority: 'git',
    path: `/${encodeURIComponent(label)}`,
    query: encodePayload(payload)
  });
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
  const details = error?.stderr || error?.message || String(error);
  return `PhpStorm Git Panel: ${details.trim()}`;
}

function ensureEditorSoundsDisabled() {
  if (!editorSoundsDisabledPromise) {
    editorSoundsDisabledPromise = disableEditorSounds();
  }

  return editorSoundsDisabledPromise;
}

async function disableEditorSounds() {
  const configuration = vscode.workspace.getConfiguration();

  for (const [key, value] of DISABLED_SOUND_SETTINGS) {
    try {
      if (isSameSettingValue(configuration.get(key), value)) {
        continue;
      }

      await configuration.update(key, value, vscode.ConfigurationTarget.Global);
    } catch (_) {
      // Ignore settings that are unavailable or policy-controlled in this VS Code host.
    }
  }
}

function isSameSettingValue(currentValue, expectedValue) {
  return JSON.stringify(currentValue) === JSON.stringify(expectedValue);
}

function activate(context) {
  void ensureEditorSoundsDisabled();

  const provider = new PhpStormCommitPanelProvider(context);
  const virtualDocuments = new GitVirtualDocumentProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }),
    vscode.workspace.registerTextDocumentContentProvider(VIRTUAL_SCHEME, virtualDocuments),
    vscode.commands.registerCommand('phpstormGitPanel.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('phpstormGitPanel.stageAll', () => provider.stageAll()),
    vscode.commands.registerCommand('phpstormGitPanel.unstageAll', () => provider.unstageAll()),
    vscode.commands.registerCommand('phpstormGitPanel.generateCommitMessage', () => provider.generateCommitMessage()),
    vscode.commands.registerCommand('phpstormGitPanel.commit', () => provider.commit(false)),
    vscode.commands.registerCommand('phpstormGitPanel.commitAndPush', () => provider.commit(true)),
    vscode.commands.registerCommand('phpstormGitPanel.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', 'phpstormGitPanel')),
    vscode.workspace.onDidSaveTextDocument(() => provider.refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    vscode.window.onDidChangeActiveTextEditor(() => provider.refresh())
  );

  const interval = getRefreshInterval();
  const intervalHandle = setInterval(() => {
    if (provider.view?.visible) {
      provider.refresh();
    }
  }, interval);

  context.subscriptions.push({
    dispose() {
      clearInterval(intervalHandle);
    }
  });
}

function getRefreshInterval() {
  return vscode.workspace
    .getConfiguration('phpstormGitPanel')
    .get('autoRefreshIntervalMs', 3000);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  formatCommitLanguageInstruction,
  disableEditorSounds,
  ensureEditorSoundsDisabled,
  normalizeCommitLanguage,
  PhpStormCommitPanelProvider,
  sanitizeGeneratedCommitMessage
};
