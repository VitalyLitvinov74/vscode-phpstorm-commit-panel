'use strict';

const path = require('path');
const vscode = require('vscode');
const git = require('./src/git');
const { renderWebview, resolveActiveFileIconTheme } = require('./src/webview');

const VIEW_ID = 'phpstormGitPanel.changes';
const VIRTUAL_SCHEME = 'phpstorm-git-panel';
const COMMIT_LANGUAGE_STORAGE_KEY = 'commitLanguage';
const COMMIT_LANGUAGE_OPTIONS = new Set(['auto', 'en', 'ru']);

class PhpStormCommitPanelProvider {
  constructor(context) {
    this.context = context;
    this.operation = Promise.resolve();
    this.pendingRefreshTimer = undefined;
    this.pendingStagingOperations = 0;
    this.refreshing = false;
    this.view = undefined;
    const commitLanguage = normalizeCommitLanguage(
      this.context.globalState.get(COMMIT_LANGUAGE_STORAGE_KEY, 'auto')
    );

    this.state = {
      repositories: [],
      selectedRoot: undefined,
      repoName: '',
      changes: [],
      message: '',
      amend: false,
      lastCommit: '',
      commitLanguage,
      busy: false,
      busyText: '',
      statusText: 'Open a folder with a Git repository.',
      errorText: '',
      stagedCount: 0,
      totalCount: 0,
      canGenerate: false
    };

    this.context.subscriptions.push(
      {
        dispose: () => this.clearScheduledRefresh()
      },
      vscode.workspace.onDidChangeConfiguration(
        (event) => {
          if (event.affectsConfiguration('workbench.iconTheme')) {
            this.renderPanelWebview();
            this.refresh();
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

    this.refresh();
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
    this.view.webview.html = renderWebview(this.view.webview, fileIconTheme);
  }

  async handleMessage(message) {
    switch (message?.type) {
      case 'ready':
        await this.refresh();
        return;
      case 'refresh':
        await this.refresh({ force: true });
        return;
      case 'selectRepository':
        this.state.selectedRoot = message.root;
        await this.refresh({ force: true });
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
    if (this.pendingStagingOperations > 0 && !options.force) {
      this.scheduleRefresh(700);
      return;
    }

    if (this.refreshing) {
      return;
    }

    if (options.force) {
      this.clearScheduledRefresh();
    }

    this.refreshing = true;
    this.state = {
      ...this.state,
      errorText: '',
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
          lastCommit: '',
          statusText: 'Open a folder with a Git repository.',
          stagedCount: 0,
          totalCount: 0,
          canGenerate: false
        };
        return;
      }

      const [changes, lastCommit] = await Promise.all([
        git.getStatus(selectedRoot),
        git.getLastCommitSummary(selectedRoot)
      ]);
      const stagedCount = changes.filter((change) => change.staged).length;
      const totalCount = changes.length;

      this.state = {
        ...this.state,
        repositories,
        selectedRoot,
        repoName: path.basename(selectedRoot),
        changes,
        lastCommit,
        statusText: formatStatusText(stagedCount, totalCount),
        stagedCount,
        totalCount,
        canGenerate: stagedCount > 0
      };
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

    this.applyOptimisticStaging(paths, checked);
    this.enqueueStagingOperation(this.state.selectedRoot, paths, checked);
  }

  applyOptimisticStaging(paths, checked) {
    const pathSet = new Set(paths);
    let changed = false;
    const changes = this.state.changes.map((change) => {
      if (!pathSet.has(change.path) || change.staged === checked) {
        return change;
      }

      changed = true;
      return {
        ...change,
        staged: checked
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

  enqueueStagingOperation(root, paths, checked) {
    this.pendingStagingOperations += 1;
    this.operation = this.operation.catch(() => {}).then(async () => {
      try {
        if (checked) {
          await git.stagePaths(root, paths);
        } else {
          await git.unstagePaths(root, paths);
        }

        this.state = {
          ...this.state,
          errorText: ''
        };
      } catch (error) {
        this.state = {
          ...this.state,
          errorText: formatError(error)
        };
      } finally {
        this.pendingStagingOperations = Math.max(0, this.pendingStagingOperations - 1);
        this.scheduleRefresh(this.state.errorText ? 0 : 650);
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

    const leftPath = change.originalPath ?? change.path;
    const left = createVirtualUri({
      root,
      ref: 'HEAD',
      path: leftPath,
      label: 'HEAD'
    }, `${path.basename(leftPath)} (HEAD)`);
    let right;

    if (change.staged) {
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
      `${change.path} (${change.staged ? 'checked' : 'working tree'})`
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

  scheduleRefresh(delayMs) {
    this.clearScheduledRefresh();
    this.pendingRefreshTimer = setTimeout(() => {
      this.pendingRefreshTimer = undefined;
      this.refresh();
    }, delayMs);
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

function activate(context) {
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
  normalizeCommitLanguage,
  PhpStormCommitPanelProvider,
  sanitizeGeneratedCommitMessage
};
