'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const listeners = {
  configuration: [],
  save: [],
  workspaceFolders: []
};
const registrations = {
  webviewProviders: []
};

const vscode = {
  CancellationTokenSource: class {
    constructor() {
      this.token = { isCancellationRequested: false };
    }

    cancel() {
      this.token.isCancellationRequested = true;
    }

    dispose() {}
  },
  ConfigurationTarget: {
    Global: 1
  },
  LanguageModelChatMessage: {
    User(value) {
      return value;
    }
  },
  Uri: {
    file(fsPath) {
      return { fsPath, scheme: 'file' };
    },
    from(value) {
      return value;
    }
  },
  commands: {
    executeCommand: async () => undefined,
    registerCommand: () => disposable()
  },
  lm: undefined,
  window: {
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: () => disposable(),
    registerWebviewViewProvider(viewId, provider) {
      registrations.webviewProviders.push({ provider, viewId });
      return disposable();
    }
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({
      get: (_key, fallback) => fallback
    }),
    getWorkspaceFolder: () => undefined,
    onDidChangeConfiguration(listener) {
      listeners.configuration.push(listener);
      return disposable();
    },
    onDidChangeWorkspaceFolders(listener) {
      listeners.workspaceFolders.push(listener);
      return disposable();
    },
    onDidSaveTextDocument(listener) {
      listeners.save.push(listener);
      return disposable();
    },
    registerTextDocumentContentProvider: () => disposable()
  }
};

function disposable() {
  return { dispose() {} };
}

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') {
    return vscode;
  }

  return originalLoad.call(this, request, parent, isMain);
};

const git = require('../src/git');
const extension = require('../extension');
Module._load = originalLoad;

const { PhpStormCommitPanelProvider } = extension;

async function run() {
  await testMessageTypingIsVersionedWithoutEchoingTheEntireState();
  await testPostStateDeduplicatesIdenticalSnapshots();
  await testDisposedWebviewStopsFurtherStateDelivery();
  await testVisibilityRestoreCoalescesWithWebviewReady();
  await testBackgroundWorkspaceEventsSkipClosedPanel();
  await testActiveEditorDoesNotReorderRepositoryDiscovery();
  await testStagingBatchRejectsAnotherRepository();
  await testCommitFlushesPendingStagingFirst();
  await testCommitUsesClickSnapshotWhileStagingFlushes();
  await testBulkStagingDoesNotCrossRepositoriesDuringFlush();
  await testGenerateFlushesBeforeCheckingAvailability();
  await testGenerationKeepsDraftEditedDuringStagingFlush();
  await testLanguageModelTimeoutCancelsAndReleasesBusyState();
  await testStagingFailureBlocksCommitAndGeneration();
  await testSuccessfulRenameUnstageRefreshesAuthoritativeShape();
  await testSuccessfulGitWriteRequiresAuthoritativeOutcome();
  await testUnrelatedStagingSuccessDoesNotHideEarlierFailure();
  await testNewerDraftSurvivesMessageGeneration();
  await testNewerDraftSurvivesCommit();
  await testPushFailureKeepsTheLocalCommitResult();
  await testRepositorySwitchFlushesOldRepositoryFirst();
  await testRepositorySwitchHidesOldStateUntilRefreshSettles();
  await testRepositorySelectionSettlesWhenTargetDisappears();
  await testLatestInvalidRepositorySelectionSupersedesPendingSwitch();
  await testRejectedRepositorySwitchIsAcknowledged();
  await testStaleRepositoryActionsCannotAffectTheReplacementRepository();
  await testHunkRequestIsScopedToTheSelectedRepository();
  await testDestructiveRequestsAreScopedToTheSelectedRepository();
  await testImplicitRepositoryFallbackClearsStagingFailureScope();
  await testNewestForcedRefreshWins();
  await testForcedRefreshAbortsTheCurrentGitRead();
  await testMutationAbortsStaleRefreshAndClearsDeferredDuplicate();
  await testRefreshRequestedWhileBusyIsNotDropped();
  await testSelectingAnotherFileAbortsTheStaleDiff();
  testExtensionDoesNotMutateGlobalSoundSettings();
}

async function testMessageTypingIsVersionedWithoutEchoingTheEntireState() {
  const { provider, posted } = createProvider();
  provider.state = repositoryState(provider.state, '/repo', [], ['/repo']);
  provider.postState();
  posted.length = 0;

  await provider.handleMessage(
    {
      type: 'setMessage',
      message: 'feat: fast typing',
      messageVersion: 2
    }
  );
  await provider.handleMessage(
    {
      type: 'setMessage',
      message: 'stale draft',
      messageVersion: 1
    }
  );
  await provider.handleMessage(
    { type: 'setAmend', root: '/repo', amend: true, amendVersion: 1 }
  );
  await provider.handleMessage(
    { type: 'setAmend', root: '/repo', amend: false, amendVersion: 0 }
  );

  // Приемочный свидетель: устаревшее состояние хоста не откатывает новый черновик.
  assert.equal(provider.state.message, 'feat: fast typing');
  assert.equal(provider.state.messageVersion, 2);
  assert.equal(provider.state.amend, true);
  assert.equal(provider.state.amendVersion, 1);
  assert.equal(posted.length, 1, 'amend acknowledgement must use one lightweight state patch');
  assert.equal(posted[0].partial, true);
  assert.deepEqual(
    posted[0].state,
    { message: 'feat: fast typing', messageVersion: 2, amend: true, amendVersion: 1 }
  );
  // Контрольный факт вне области изменения: typing itself still does not post on every keystroke.
}

async function testPostStateDeduplicatesIdenticalSnapshots() {
  const { provider, posted } = createProvider();

  provider.postState();
  provider.postState();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].partial, false);

  provider.state = { ...provider.state, statusText: 'Updated' };
  provider.postState();
  assert.equal(posted.length, 2);
  // Приемочный свидетель: лёгкий статус не копирует changes/diff через webview bridge.
  assert.equal(posted[1].partial, true);
  assert.deepEqual(posted[1].state, { statusText: 'Updated' });

  provider.postState(true);
  assert.equal(posted.length, 3);
  assert.equal(posted[2].partial, false);
  assert.equal(posted[2].state.statusText, 'Updated');
  // Контрольный факт вне области изменения: forced delivery remains a complete resynchronization point.

  provider.state = {
    ...provider.state,
    selectedRoot: '/repo',
    diffPreview: preview('selected.txt')
  };
  provider.postState(true);
  provider.state = {
    ...provider.state,
    selectedRoot: undefined,
    diffPreview: undefined
  };
  provider.postState();

  // Приемочный свидетель: JSON transport сохраняет явную очистку полей в partial state.
  assert.equal(posted[4].partial, true);
  assert.deepEqual(
    posted[4].state,
    { selectedRoot: null, diffPreview: null }
  );
}

async function testDisposedWebviewStopsFurtherStateDelivery() {
  const { provider } = createProvider();
  let disposeListener;
  let disposed = false;
  let listenerDisposeCount = 0;
  let postCount = 0;
  const trackedDisposable = () => ({
    dispose() {
      listenerDisposeCount += 1;
    }
  });
  const webviewView = {
    visible: true,
    webview: {
      onDidReceiveMessage: () => trackedDisposable(),
      postMessage() {
        postCount += 1;

        if (disposed) {
          throw new Error('Cannot use a disposed webview.');
        }

        return Promise.resolve(true);
      }
    },
    onDidChangeVisibility: () => trackedDisposable(),
    onDidDispose(listener) {
      disposeListener = listener;
      return trackedDisposable();
    }
  };

  provider.renderPanelWebview = () => {};
  provider.resolveWebviewView(webviewView);
  provider.postState(true);
  assert.equal(postCount, 1);

  provider.pendingRefreshTimer = setTimeout(() => {}, 10_000);
  provider.pendingRefreshOptions = { force: true };
  const refreshAbortController = new AbortController();
  const diffAbortController = new AbortController();
  provider.refreshAbortController = refreshAbortController;
  provider.diffAbortController = diffAbortController;
  disposed = true;
  disposeListener();

  // Приемочный свидетель: уничтоженная Webview освобождается до следующей фоновой доставки состояния.
  assert.equal(provider.view, undefined);
  assert.equal(provider.lastPostedStateSnapshot, undefined);
  assert.equal(provider.pendingRefreshTimer, undefined);
  assert.equal(provider.pendingRefreshOptions, undefined);
  assert.equal(refreshAbortController.signal.aborted, true);
  assert.equal(diffAbortController.signal.aborted, true);
  assert.equal(listenerDisposeCount, 3);
  assert.doesNotThrow(() => provider.postState(true));

  provider.resolveRepositories = async () => [];
  await provider.refresh({ force: true, showProgress: false });
  assert.equal(postCount, 1);
  disposeProvider(provider);
}

async function testVisibilityRestoreCoalescesWithWebviewReady() {
  const { provider } = createProvider();
  let visibilityListener;
  const webviewView = {
    visible: true,
    webview: {
      onDidReceiveMessage: () => disposable()
    },
    onDidChangeVisibility(listener) {
      visibilityListener = listener;
      return disposable();
    },
    onDidDispose: () => disposable()
  };
  let refreshCount = 0;
  provider.renderPanelWebview = () => {};
  provider.performRefresh = async () => {
    refreshCount += 1;
  };
  provider.resolveWebviewView(webviewView);

  try {
    visibilityListener();
    assert.ok(provider.pendingRefreshTimer);
    assert.equal(refreshCount, 0);

    await provider.handleMessage({ type: 'ready', ui: {} });

    // Приемочный свидетель: ready поглощает отложенный visibility refresh вместо второго Git scan.
    assert.equal(refreshCount, 1);
    assert.equal(provider.pendingRefreshTimer, undefined);
  } finally {
    provider.releaseWebviewView(webviewView);
    disposeProvider(provider);
  }
}

async function testBackgroundWorkspaceEventsSkipClosedPanel() {
  const context = {
    extensionUri: { fsPath: '/extension' },
    globalState: {
      get: (_key, fallback) => fallback,
      update: async () => undefined
    },
    subscriptions: []
  };
  const saveListenerCount = listeners.save.length;
  const workspaceListenerCount = listeners.workspaceFolders.length;
  const providerCount = registrations.webviewProviders.length;

  extension.activate(context);
  const provider = registrations.webviewProviders[providerCount].provider;
  const saveListener = listeners.save[saveListenerCount];
  const workspaceListener = listeners.workspaceFolders[workspaceListenerCount];
  let refreshCount = 0;
  provider.refresh = async () => {
    refreshCount += 1;
  };

  try {
    provider.view = { visible: true };
    await saveListener();
    await workspaceListener();
    assert.equal(refreshCount, 2);

    provider.view.visible = false;
    await saveListener();
    await workspaceListener();
    assert.equal(refreshCount, 2);

    const releasedView = provider.view;
    provider.releaseWebviewView(releasedView);
    await saveListener();
    await workspaceListener();

    // Приемочный свидетель: закрытая панель не перезапускает Git scan на save/workspace events.
    assert.equal(refreshCount, 2);
  } finally {
    for (const subscription of context.subscriptions) {
      subscription.dispose();
    }
  }
}

async function testActiveEditorDoesNotReorderRepositoryDiscovery() {
  const { provider } = createProvider();
  const rootA = path.join(path.sep, 'repo-a');
  const rootB = path.join(path.sep, 'repo-b');
  const folderA = { uri: { fsPath: rootA } };
  const folderB = { uri: { fsPath: rootB } };
  const previousFolders = vscode.workspace.workspaceFolders;
  const previousGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;
  const previousActiveEditor = vscode.window.activeTextEditor;
  let discoveryCount = 0;
  const restoreGit = stubGit(
    {
      findRepositoryRoot: async (candidate) => {
        discoveryCount += 1;
        return candidate;
      }
    }
  );
  vscode.workspace.workspaceFolders = [folderA, folderB];
  vscode.workspace.getWorkspaceFolder = (uri) => uri.fsPath.startsWith(rootB)
    ? folderB
    : folderA;
  vscode.window.activeTextEditor = {
    document: { uri: { fsPath: path.join(rootA, 'first.js') } }
  };

  try {
    const firstRoots = await provider.resolveRepositories();
    vscode.window.activeTextEditor = {
      document: { uri: { fsPath: path.join(rootB, 'second.js') } }
    };
    const secondRoots = await provider.resolveRepositories();

    // Приемочный свидетель: смена editor между roots не меняет порядок и не сбрасывает discovery cache.
    assert.deepEqual(firstRoots, [rootA, rootB]);
    assert.deepEqual(secondRoots, [rootA, rootB]);
    assert.equal(discoveryCount, 2);
    assert.equal(provider.pickSelectedRoot(secondRoots), rootB);

    provider.state.selectedRoot = rootA;
    assert.equal(provider.pickSelectedRoot(secondRoots), rootA);
  } finally {
    vscode.workspace.workspaceFolders = previousFolders;
    vscode.workspace.getWorkspaceFolder = previousGetWorkspaceFolder;
    vscode.window.activeTextEditor = previousActiveEditor;
    restoreGit();
    disposeProvider(provider);
  }
}

async function testStagingBatchRejectsAnotherRepository() {
  const { provider } = createProvider();
  const restoreGit = stubGit(
    {
      setPathsStaged: async () => {
        throw new Error('a cross-repository batch must not reach Git');
      }
    }
  );

  provider.state = repositoryState(provider.state, '/repo-a', [change('same.txt')], ['/repo-a', '/repo-b']);

  try {
    await provider.applyStagingBatch(
      [{ path: 'same.txt', checked: true }],
      'request-b',
      '/repo-b'
    );

    assert.equal(provider.stagingBatch.hasPending(), false);
    assert.equal(provider.state.changes[0].staged, false);
    assert.deepEqual(provider.state.failedStagingRequestIds, ['request-b']);
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testCommitFlushesPendingStagingFirst() {
  const { provider } = createProvider();
  const calls = [];
  const restoreGit = stubGit(
    {
      setPathsStaged: async (root, stagePaths, unstagePaths) => {
        calls.push(['stage', root, stagePaths, unstagePaths]);
      },
      getStatus: async () => [
        {
          ...change('ready.txt'),
          staged: true,
          hasStaged: true,
          hasUnstaged: false
        }
      ],
      hasStagedChanges: async () => {
        calls.push(['hasStagedChanges']);
        return true;
      },
      commit: async () => calls.push(['commit'])
    }
  );

  provider.state = {
    ...repositoryState(provider.state, '/repo-a', [change('ready.txt')], ['/repo-a']),
    message: 'fix: keep staging ordered'
  };
  provider.queueStagingStates('/repo-a', new Map([['ready.txt', true]]));
  provider.refresh = async () => calls.push(['refresh']);

  try {
    await provider.commit(false);
    assert.deepEqual(calls.map(([name]) => name), ['stage', 'hasStagedChanges', 'commit', 'refresh']);
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testCommitUsesClickSnapshotWhileStagingFlushes() {
  const { provider } = createProvider();
  const flushStarted = deferred();
  const flushMayFinish = deferred();
  const commits = [];
  const restoreGit = stubGit(
    {
      hasStagedChanges: async () => true,
      commit: async (root, message, options) => {
        commits.push({ root, message, amend: options.amend });
      }
    }
  );

  provider.state = {
    ...repositoryState(provider.state, '/repo-a', [change('ready.txt')], ['/repo-a']),
    message: 'fix: clicked draft',
    messageVersion: 7
  };
  provider.flushPendingStagingWork = async () => {
    flushStarted.resolve();
    await flushMayFinish.promise;
    return true;
  };
  provider.refresh = async () => undefined;

  try {
    const commitOperation = provider.commit(false);
    await waitFor(flushStarted.promise, 'staging flush start');
    await provider.handleMessage(
      { type: 'setMessage', message: 'draft for later', messageVersion: 8 }
    );
    await provider.handleMessage(
      {
        type: 'setAmend',
        root: provider.state.selectedRoot,
        amend: true,
        amendVersion: provider.state.amendVersion + 1
      }
    );
    flushMayFinish.resolve();
    await commitOperation;

    // Приемочный свидетель: commit использует снимок нажатия, а новый ввод остаётся для следующего раза.
    assert.deepEqual(
      commits,
      [{ root: '/repo-a', message: 'fix: clicked draft', amend: false }]
    );
    assert.equal(provider.state.message, 'draft for later');
    assert.equal(provider.state.amend, true);
  } finally {
    flushMayFinish.resolve();
    restoreGit();
    disposeProvider(provider);
  }
}

async function testBulkStagingDoesNotCrossRepositoriesDuringFlush() {
  const { provider } = createProvider();
  const calls = [];
  const restoreGit = stubGit(
    {
      stageAll: async (root) => calls.push(`stage:${root}`),
      unstageAll: async (root) => calls.push(`unstage:${root}`)
    }
  );

  provider.state = repositoryState(
    provider.state,
    '/repo-a',
    [change('ready.txt')],
    ['/repo-a', '/repo-b']
  );

  try {
    for (const operationName of ['stageAll', 'unstageAll']) {
      const flushStarted = deferred();
      const flushMayFinish = deferred();
      provider.state.selectedRoot = '/repo-a';
      provider.flushPendingStagingWork = async () => {
        flushStarted.resolve();
        await flushMayFinish.promise;
        return true;
      };

      const operation = provider[operationName]();
      await waitFor(flushStarted.promise, `${operationName} staging flush start`);
      provider.state.selectedRoot = '/repo-b';
      flushMayFinish.resolve();
      await operation;
    }

    // Приемочный свидетель: массовая операция не переносится в репозиторий, выбранный во время ожидания.
    assert.deepEqual(calls, []);
    // Контрольный факт вне области изменения: новый выбор репозитория сохраняется.
    assert.equal(provider.state.selectedRoot, '/repo-b');
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testGenerateFlushesBeforeCheckingAvailability() {
  const { provider } = createProvider();
  const calls = [];

  provider.state = {
    ...repositoryState(provider.state, '/repo-a', [change('ready.txt')], ['/repo-a']),
    canGenerate: false
  };
  provider.flushPendingStagingWork = async () => {
    calls.push('flush');
    return true;
  };
  provider.reportPanelWarning = () => calls.push('warning');

  await provider.generateCommitMessage();

  assert.deepEqual(calls, ['flush', 'warning']);
}

async function testGenerationKeepsDraftEditedDuringStagingFlush() {
  const { provider } = createProvider();
  const flushStarted = deferred();
  const flushMayFinish = deferred();
  const originalLanguageModels = vscode.lm;
  const restoreGit = stubGit(
    {
      getStagedDiff: async () => 'diff --git a/ready.txt b/ready.txt'
    }
  );
  vscode.lm = {
    selectChatModels: async () => [
      {
        maxInputTokens: 8000,
        sendRequest: async () => ({ text: textFragments('generated message') })
      }
    ]
  };
  const stagedChange = {
    ...change('ready.txt'),
    staged: true,
    hasStaged: true,
    hasUnstaged: false
  };
  provider.state = {
    ...repositoryState(provider.state, '/repo-a', [stagedChange], ['/repo-a']),
    message: 'draft before generation',
    messageVersion: 3,
    canGenerate: true
  };
  provider.flushPendingStagingWork = async () => {
    flushStarted.resolve();
    await flushMayFinish.promise;
    return true;
  };

  try {
    const generation = provider.generateCommitMessage();
    await waitFor(flushStarted.promise, 'generation staging flush start');
    await provider.handleMessage(
      { type: 'setMessage', message: 'new draft during flush', messageVersion: 4 }
    );
    flushMayFinish.resolve();
    await generation;

    // Приемочный свидетель: ввод во время staging flush считается более новым, чем генерация.
    assert.equal(provider.state.message, 'new draft during flush');
    assert.equal(provider.state.messageVersion, 4);
  } finally {
    flushMayFinish.resolve();
    vscode.lm = originalLanguageModels;
    restoreGit();
    disposeProvider(provider);
  }
}

async function testLanguageModelTimeoutCancelsAndReleasesBusyState() {
  const { provider } = createProvider();
  const originalLanguageModels = vscode.lm;
  let requestToken;
  const restoreGit = stubGit(
    {
      getStagedDiff: async () => 'diff --git a/ready.txt b/ready.txt'
    }
  );
  vscode.lm = {
    selectChatModels: async () => [
      {
        maxInputTokens: 8000,
        sendRequest: async (_messages, _options, token) => {
          requestToken = token;
          return new Promise(() => {});
        }
      }
    ]
  };
  const stagedChange = {
    ...change('ready.txt'),
    staged: true,
    hasStaged: true,
    hasUnstaged: false
  };
  provider.state = {
    ...repositoryState(provider.state, '/repo-a', [stagedChange], ['/repo-a']),
    canGenerate: true
  };
  provider.languageModelTimeoutMs = 20;

  try {
    await provider.generateCommitMessage();

    // Приемочный свидетель: зависший LM-запрос отменяется и не оставляет панель busy навсегда.
    assert.equal(requestToken.isCancellationRequested, true);
    assert.equal(provider.state.busy, false);
    assert.equal(provider.userOperationPending, false);
    assert.match(provider.state.errorText, /timed out/i);
  } finally {
    vscode.lm = originalLanguageModels;
    restoreGit();
    disposeProvider(provider);
  }
}

async function testStagingFailureBlocksCommitAndGeneration() {
  const { provider } = createProvider();
  const calls = [];
  const alreadyStaged = {
    ...change('existing.txt'),
    staged: true,
    hasStaged: true,
    hasUnstaged: false
  };
  const restoreGit = stubGit(
    {
      setPathsStaged: async () => {
        calls.push('setPathsStaged');
        throw new Error('index is locked');
      },
      getStatus: async () => [change('new.txt'), alreadyStaged],
      hasStagedChanges: async () => {
        calls.push('hasStagedChanges');
        return true;
      },
      commit: async () => calls.push('commit'),
      getStagedDiff: async () => {
        calls.push('getStagedDiff');
        return 'diff';
      }
    }
  );

  provider.state = {
    ...repositoryState(
      provider.state,
      '/repo-a',
      [change('new.txt'), alreadyStaged],
      ['/repo-a']
    ),
    message: 'fix: do not commit a partial selection',
    canGenerate: true
  };
  await provider.applyStagingBatch(
    [{ path: 'new.txt', checked: true }],
    'failed-request',
    '/repo-a'
  );

  try {
    assert.equal(
      provider.findChange('new.txt').staged,
      false,
      'the host must leave authoritative state unchanged before Git succeeds'
    );
    await provider.commit(false);
    await provider.generateCommitMessage();

    // Приемочный свидетель: commit и генерация не обходят неуспешную подготовку индекса.
    assert.deepEqual(calls, ['setPathsStaged']);
    assert.deepEqual(provider.state.failedStagingRequestIds, ['failed-request']);
    assert.match(provider.state.errorText, /index is locked/);
    assert.equal(provider.findChange('new.txt').staged, false);
    assert.equal(provider.findChange('existing.txt').staged, true);
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testSuccessfulRenameUnstageRefreshesAuthoritativeShape() {
  const { provider } = createProvider();
  const stagedRename = {
    ...change('new-name.txt'),
    originalPath: 'old-name.txt',
    xy: 'R ',
    indexStatus: 'R',
    worktreeStatus: ' ',
    kind: 'renamed',
    staged: true,
    hasStaged: true,
    hasUnstaged: false
  };
  const deletedOriginal = {
    ...change('old-name.txt'),
    xy: ' D',
    indexStatus: ' ',
    worktreeStatus: 'D',
    kind: 'deleted',
    deletedInView: true
  };
  const untrackedDestination = {
    ...change('new-name.txt'),
    xy: '??',
    indexStatus: '?',
    worktreeStatus: '?',
    kind: 'untracked',
    untracked: true
  };
  const restoreGit = stubGit(
    {
      setPathsStaged: async (_root, stagePaths, unstagePaths) => {
        assert.deepEqual(stagePaths, []);
        assert.deepEqual(unstagePaths, ['new-name.txt']);
      },
      getStatus: async () => [deletedOriginal, untrackedDestination]
    }
  );
  provider.state = {
    ...repositoryState(provider.state, '/repo-a', [stagedRename], ['/repo-a']),
    selectedPath: 'new-name.txt',
    stagedCount: 1,
    totalCount: 1,
    canGenerate: true
  };

  try {
    await provider.applyStagingBatch(
      [{ path: 'new-name.txt', checked: false }],
      'unstage-rename',
      '/repo-a'
    );
    assert.equal(await provider.flushPendingStagingWork(), true);

    const changesByPath = new Map(
      provider.state.changes.map((item) => [item.path, item])
    );
    // Приемочный свидетель: ack публикует реальную двухстрочную форму rename после unstage.
    assert.equal(provider.state.changes.length, 2);
    assert.equal(changesByPath.get('old-name.txt').kind, 'deleted');
    assert.equal(changesByPath.get('new-name.txt').untracked, true);
    assert.deepEqual(provider.state.confirmedStagingRequestIds, ['unstage-rename']);
    assert.equal(provider.state.stagedCount, 0);
    // Контрольный факт вне области изменения: выбранный destination остаётся выбранным.
    assert.equal(provider.state.selectedPath, 'new-name.txt');
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testSuccessfulGitWriteRequiresAuthoritativeOutcome() {
  const { provider } = createProvider();
  const concurrentlyEditedChange = {
    ...change('edited-again.txt'),
    staged: true,
    hasStaged: true,
    hasUnstaged: true,
    partiallyStaged: true
  };
  const restoreGit = stubGit(
    {
      setPathsStaged: async () => undefined,
      getStatus: async () => [concurrentlyEditedChange]
    }
  );
  provider.state = repositoryState(
    provider.state,
    '/repo-a',
    [change('edited-again.txt')],
    ['/repo-a']
  );

  try {
    await provider.applyStagingBatch(
      [{ path: 'edited-again.txt', checked: true }],
      'concurrent-edit',
      '/repo-a'
    );

    // Приемочный свидетель: success от git add не скрывает более новый unstaged edit.
    assert.equal(await provider.flushPendingStagingWork(), false);
    assert.equal(provider.findChange('edited-again.txt').partiallyStaged, true);
    assert.deepEqual(provider.state.confirmedStagingRequestIds, []);
    assert.deepEqual(provider.state.failedStagingRequestIds, ['concurrent-edit']);
    assert.match(provider.state.errorText, /changed again/i);
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testUnrelatedStagingSuccessDoesNotHideEarlierFailure() {
  const { provider } = createProvider();
  const calls = [];
  let successfulPathStaged = false;
  const restoreGit = stubGit(
    {
      setPathsStaged: async (_root, stagePaths) => {
        const relativePath = stagePaths[0];
        calls.push(`stage:${relativePath}`);

        if (relativePath === 'failed.txt') {
          throw new Error('failed.txt is still locked');
        }

        successfulPathStaged = true;
      },
      getStatus: async () => [
        change('failed.txt'),
        successfulPathStaged
          ? {
            ...change('successful.txt'),
            staged: true,
            hasStaged: true,
            hasUnstaged: false
          }
          : change('successful.txt')
      ],
      hasStagedChanges: async () => {
        calls.push('hasStagedChanges');
        return true;
      },
      commit: async () => calls.push('commit')
    }
  );

  provider.state = {
    ...repositoryState(
      provider.state,
      '/repo-a',
      [change('failed.txt'), change('successful.txt')],
      ['/repo-a']
    ),
    message: 'fix: keep every staging failure visible'
  };

  try {
    provider.queueStagingStates(
      '/repo-a',
      new Map([['failed.txt', true]]),
      { requestId: 'failed-request' }
    );
    assert.equal(await provider.flushPendingStagingWork(), false);

    provider.queueStagingStates(
      '/repo-a',
      new Map([['successful.txt', true]]),
      { requestId: 'successful-request' }
    );
    assert.equal(await provider.flushPendingStagingWork(), false);
    await provider.commit(false);

    // Приемочный свидетель: успех другого пути не скрывает старую ошибку.
    assert.deepEqual(calls, ['stage:failed.txt', 'stage:successful.txt']);
    assert.deepEqual(provider.state.confirmedStagingRequestIds, ['successful-request']);
    assert.match(provider.state.errorText, /failed\.txt is still locked/);
    assert.equal(provider.findChange('successful.txt').staged, true);
    assert.equal(provider.findChange('failed.txt').staged, false);
    // Контрольный факт вне области изменения: успешный путь подтверждён отдельно.
    assert.equal(provider.failedStagingPaths.has('successful.txt'), false);
    assert.equal(provider.failedStagingPaths.has('failed.txt'), true);
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testNewerDraftSurvivesMessageGeneration() {
  const { provider } = createProvider();
  const response = deferred();
  const requestStarted = deferred();
  const originalLanguageModels = vscode.lm;
  const restoreGit = stubGit(
    {
      getStagedDiff: async () => 'diff --git a/a.txt b/a.txt'
    }
  );
  vscode.lm = {
    selectChatModels: async () => [
      {
        maxInputTokens: 8000,
        sendRequest: async () => {
          requestStarted.resolve();
          return response.promise;
        }
      }
    ]
  };
  const stagedChange = {
    ...change('a.txt'),
    staged: true,
    hasStaged: true,
    hasUnstaged: false
  };
  provider.state = {
    ...repositoryState(provider.state, '/repo-a', [stagedChange], ['/repo-a']),
    message: 'initial draft',
    messageVersion: 1,
    canGenerate: true
  };

  try {
    const generation = provider.generateCommitMessage();
    await waitFor(requestStarted.promise, 'language model request');
    await provider.handleMessage(
      { type: 'setMessage', message: 'newer draft', messageVersion: 2 }
    );
    response.resolve({ text: textFragments('generated message') });
    await generation;

    // Приемочный свидетель: поздний ответ модели не перезаписывает новый ввод.
    assert.equal(provider.state.message, 'newer draft');
    assert.equal(provider.state.messageVersion, 2);
    assert.match(provider.state.statusText, /newer draft was kept/i);
  } finally {
    vscode.lm = originalLanguageModels;
    restoreGit();
    disposeProvider(provider);
  }
}

async function testNewerDraftSurvivesCommit() {
  const { provider } = createProvider();
  const commitMayFinish = deferred();
  const commitStarted = deferred();
  const restoreGit = stubGit(
    {
      hasStagedChanges: async () => true,
      commit: async () => {
        commitStarted.resolve();
        await commitMayFinish.promise;
      }
    }
  );
  provider.state = {
    ...repositoryState(provider.state, '/repo-a', [change('a.txt')], ['/repo-a']),
    message: 'commit this draft',
    messageVersion: 4
  };
  provider.refresh = async () => undefined;

  try {
    const commitOperation = provider.commit(false);
    await waitFor(commitStarted.promise, 'commit start');
    await provider.handleMessage(
      { type: 'setMessage', message: 'draft for the next commit', messageVersion: 5 }
    );
    await provider.handleMessage(
      {
        type: 'setAmend',
        root: provider.state.selectedRoot,
        amend: true,
        amendVersion: provider.state.amendVersion + 1
      }
    );
    commitMayFinish.resolve();
    await commitOperation;

    // Приемочный свидетель: успешный commit очищает только отправленные версии настроек.
    assert.equal(provider.state.message, 'draft for the next commit');
    assert.equal(provider.state.messageVersion, 5);
    assert.equal(provider.state.amend, true);
  } finally {
    commitMayFinish.resolve();
    restoreGit();
    disposeProvider(provider);
  }
}

async function testPushFailureKeepsTheLocalCommitResult() {
  const { provider } = createProvider();
  let commitCalls = 0;
  const restoreGit = stubGit(
    {
      hasStagedChanges: async () => true,
      commit: async () => {
        commitCalls += 1;
      },
      push: async () => {
        throw new Error('remote rejected the update');
      }
    }
  );

  provider.state = {
    ...repositoryState(provider.state, '/repo-a', [change('ready.txt')], ['/repo-a']),
    message: 'fix: preserve a successful local commit',
    amend: true
  };
  provider.refresh = async () => undefined;

  try {
    await provider.commit(true);

    assert.equal(commitCalls, 1);
    assert.equal(provider.state.message, '');
    assert.equal(provider.state.amend, false);
    assert.match(provider.state.errorText, /Commit was created locally, but push failed/);

    await provider.commit(true);
    assert.equal(commitCalls, 1, 'retry without a new message must not create a second commit');
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testRepositorySwitchFlushesOldRepositoryFirst() {
  const { provider } = createProvider();
  const calls = [];

  provider.state = {
    ...repositoryState(
      provider.state,
      '/repo-a',
      [change('a.txt')],
      ['/repo-a', '/repo-b']
    ),
    amend: true,
    amendVersion: 4
  };
  provider.flushPendingStagingWork = async () => {
    calls.push(`flush:${provider.state.selectedRoot}`);
  };
  provider.refresh = async () => {
    calls.push(`refresh:${provider.state.selectedRoot}`);
  };

  await provider.handleMessage(
    { type: 'selectRepository', root: '/repo-b', requestId: 'select-b' }
  );

  assert.deepEqual(calls, ['flush:/repo-a', 'refresh:/repo-b']);
  assert.equal(provider.state.selectedRoot, '/repo-b');
  assert.equal(provider.state.settledRepositorySelectionRequestId, 'select-b');
  assert.equal(provider.state.amend, false);
  assert.equal(provider.state.amendVersion, 5);

  await provider.handleMessage(
    { type: 'selectRepository', root: '/not-a-repository', requestId: 'unknown' }
  );
  assert.equal(provider.state.selectedRoot, '/repo-b', 'unknown repository roots must be ignored');
  assert.equal(provider.state.settledRepositorySelectionRequestId, 'unknown');
}

async function testRepositorySwitchHidesOldStateUntilRefreshSettles() {
  const { provider, posted } = createProvider();
  const statusStarted = deferred();
  const statusMayFinish = deferred();
  let stagingCalls = 0;
  const restoreGit = stubGit(
    {
      getStatus: async (root) => {
        assert.equal(root, '/repo-b');
        statusStarted.resolve();
        return statusMayFinish.promise;
      },
      getLastCommitSummary: async () => '',
      setPathsStaged: async () => {
        stagingCalls += 1;
      }
    }
  );
  const oldStagedChange = {
    ...change('old-repository.txt'),
    staged: true,
    hasStaged: true,
    hasUnstaged: false
  };
  provider.state = {
    ...repositoryState(
      provider.state,
      '/repo-a',
      [oldStagedChange],
      ['/repo-a', '/repo-b']
    ),
    lastCommit: 'old commit',
    stagedCount: 1,
    totalCount: 1,
    canGenerate: true
  };
  provider.resolveRepositories = async () => ['/repo-a', '/repo-b'];

  try {
    const selection = provider.selectRepository('/repo-b', 'select-b');
    await waitFor(statusStarted.promise, 'new repository status');

    const progressState = posted.at(-1).state;
    // Приемочный свидетель: новый root никогда не публикуется со старыми путями и действиями.
    assert.equal(progressState.selectedRoot, '/repo-b');
    assert.deepEqual(progressState.changes, []);
    assert.equal(progressState.stagedCount, 0);
    assert.equal(progressState.totalCount, 0);
    assert.equal(progressState.canGenerate, false);
    assert.notEqual(progressState.settledRepositorySelectionRequestId, 'select-b');

    await provider.applyStagingBatch(
      [{ path: 'old-repository.txt', checked: false }],
      'stale-path',
      '/repo-b'
    );
    assert.equal(stagingCalls, 0);
    assert.deepEqual(provider.state.failedStagingRequestIds, ['stale-path']);

    statusMayFinish.resolve([]);
    await selection;

    assert.equal(provider.state.selectedRoot, '/repo-b');
    assert.equal(provider.state.settledRepositorySelectionRequestId, 'select-b');
    // Контрольный факт вне области изменения: список доступных репозиториев сохранён.
    assert.deepEqual(
      provider.state.repositories.map((repository) => repository.root),
      ['/repo-a', '/repo-b']
    );
  } finally {
    statusMayFinish.resolve([]);
    restoreGit();
    disposeProvider(provider);
  }
}

async function testRepositorySelectionSettlesWhenTargetDisappears() {
  const { provider, posted } = createProvider();
  provider.state = {
    ...repositoryState(
      provider.state,
      '/repo-a',
      [change('a.txt')],
      ['/repo-a', '/repo-b']
    ),
    message: 'keep this draft'
  };
  provider.refresh = async () => {
    provider.state = {
      ...provider.state,
      selectedRoot: '/repo-a',
      repoName: 'repo-a'
    };
  };

  await provider.selectRepository('/repo-b', 'disappeared-b');

  // Приемочный свидетель: исчезнувший target завершает точный UI-запрос фактическим root.
  assert.equal(provider.state.selectedRoot, '/repo-a');
  assert.equal(provider.state.settledRepositorySelectionRequestId, 'disappeared-b');
  assert.equal(posted.at(-1).state.selectedRoot, '/repo-a');
  // Контрольный факт вне области изменения: черновик commit не очищается при fallback.
  assert.equal(provider.state.message, 'keep this draft');
  disposeProvider(provider);
}

async function testLatestInvalidRepositorySelectionSupersedesPendingSwitch() {
  const { provider } = createProvider();
  const flushStarted = deferred();
  const flushMayFinish = deferred();
  const repositoryActionCalls = [];
  provider.state = repositoryState(
    provider.state,
    '/repo-a',
    [change('a.txt')],
    ['/repo-a', '/repo-b']
  );
  provider.flushPendingStagingWork = async () => {
    flushStarted.resolve();
    await flushMayFinish.promise;
    return true;
  };
  provider.refresh = async () => {
    throw new Error('the superseded repository switch must not refresh');
  };
  provider.commit = async () => repositoryActionCalls.push('commit');
  provider.stageAll = async () => repositoryActionCalls.push('stage-all');

  try {
    const olderSelection = provider.selectRepository('/repo-b', 'older-b');
    await waitFor(flushStarted.promise, 'older repository staging flush');
    await provider.handleMessage({ type: 'commit', root: '/repo-a' });
    await provider.handleMessage({ type: 'stageAll', root: '/repo-a' });
    const directOperationStarted = await provider.enqueueOperation(
      'Direct command while switching...',
      async () => repositoryActionCalls.push('direct-command')
    );
    assert.deepEqual(
      repositoryActionCalls,
      [],
      'repository actions must stay locked while a selection is being settled'
    );
    assert.equal(directOperationStarted, false);
    await provider.selectRepository('/unknown', 'latest-unknown');
    flushMayFinish.resolve();
    await olderSelection;

    // Приемочный свидетель: последний даже невалидный запрос отменяет старое переключение.
    assert.equal(provider.state.selectedRoot, '/repo-a');
    assert.equal(provider.state.settledRepositorySelectionRequestId, 'latest-unknown');
    assert.equal(provider.repositorySelectionPending, false);
  } finally {
    flushMayFinish.resolve();
    disposeProvider(provider);
  }
}

async function testRejectedRepositorySwitchIsAcknowledged() {
  const { provider, posted } = createProvider();
  provider.state = repositoryState(
    provider.state,
    '/repo-a',
    [change('a.txt')],
    ['/repo-a', '/repo-b']
  );
  provider.userOperationPending = true;

  await provider.handleMessage(
    { type: 'selectRepository', root: '/repo-b', requestId: 'busy-switch' }
  );

  // Приемочный свидетель: UI получает точное подтверждение отклонённого выбора.
  assert.equal(provider.state.selectedRoot, '/repo-a');
  assert.equal(provider.state.settledRepositorySelectionRequestId, 'busy-switch');
  assert.equal(posted.at(-1).state.selectedRoot, '/repo-a');

  provider.userOperationPending = false;
  provider.failedStagingPaths.set('a.txt', true);
  provider.stagingErrorText = 'a.txt is locked';
  provider.flushPendingStagingWork = async () => false;
  provider.refresh = async () => undefined;
  await provider.handleMessage(
    { type: 'selectRepository', root: '/repo-b', requestId: 'staging-switch' }
  );

  // Приемочный свидетель: завершившаяся staging-ошибка не запирает пользователя в старом repo.
  assert.equal(provider.state.selectedRoot, '/repo-b');
  assert.equal(provider.state.settledRepositorySelectionRequestId, 'staging-switch');
  assert.equal(provider.failedStagingPaths.size, 0);
  assert.equal(provider.stagingErrorText, '');
  assert.equal(provider.repositorySelectionPending, false);
  // Контрольный факт вне области изменения: сам список доступных репозиториев не меняется.
  assert.deepEqual(
    provider.state.repositories.map((repository) => repository.root),
    ['/repo-a', '/repo-b']
  );
  disposeProvider(provider);
}

async function testStaleRepositoryActionsCannotAffectTheReplacementRepository() {
  const { provider } = createProvider();
  const calls = [];
  provider.state = {
    ...repositoryState(
      provider.state,
      '/repo-b',
      [change('same.txt')],
      ['/repo-a', '/repo-b']
    ),
    amend: false,
    amendVersion: 1,
    message: 'fix: repository scoped action'
  };
  provider.stageAll = async () => calls.push('stage-all');
  provider.unstageAll = async () => calls.push('unstage-all');
  provider.selectChange = async () => calls.push('select-change');
  provider.toggleChange = async () => calls.push('toggle-change');
  provider.toggleChanges = async () => calls.push('toggle-changes');
  provider.openDiffByPath = async () => calls.push('open-diff');
  provider.openFileByPath = async () => calls.push('open-file');
  provider.locateActiveFile = async () => calls.push('locate-active-file');
  provider.generateCommitMessage = async () => calls.push('generate');
  provider.commit = async (push) => calls.push(push ? 'commit-push' : 'commit');

  const staleMessages = [
    { type: 'stageAll', root: '/repo-a' },
    { type: 'unstageAll', root: '/repo-a' },
    { type: 'selectChange', root: '/repo-a', path: 'same.txt' },
    { type: 'toggleChange', root: '/repo-a', path: 'same.txt', checked: true },
    { type: 'toggleChanges', root: '/repo-a', paths: ['same.txt'], checked: true },
    { type: 'openDiff', root: '/repo-a', path: 'same.txt' },
    { type: 'openFile', root: '/repo-a', path: 'same.txt' },
    { type: 'locateActiveFile', root: '/repo-a' },
    { type: 'generateCommitMessage', root: '/repo-a' },
    { type: 'commit', root: '/repo-a' },
    { type: 'commitAndPush', root: '/repo-a' }
  ];

  for (const message of staleMessages) {
    await provider.handleMessage(message);
  }
  await provider.handleMessage(
    { type: 'setAmend', root: '/repo-a', amend: true, amendVersion: 1 }
  );

  // Приемочный свидетель: запоздалые события repo A не выполняются после перехода хоста на repo B.
  assert.deepEqual(calls, []);
  assert.equal(provider.state.amend, false);
  assert.equal(provider.state.amendVersion, 1);

  await provider.handleMessage({ type: 'stageAll', root: '/repo-b' });
  await provider.handleMessage({ type: 'commitAndPush', root: '/repo-b' });
  await provider.handleMessage(
    { type: 'setAmend', root: '/repo-b', amend: true, amendVersion: 2 }
  );

  assert.deepEqual(calls, ['stage-all', 'commit-push']);
  assert.equal(provider.state.amend, true);
  assert.equal(provider.state.amendVersion, 2);
  // Контрольный факт вне области изменения: события актуального repo B продолжают выполняться.
  disposeProvider(provider);
}

async function testHunkRequestIsScopedToTheSelectedRepository() {
  const { provider } = createProvider();
  const calls = [];
  const restoreGit = stubGit(
    {
      setHunkIncluded: async (root, selectedChange) => {
        calls.push(`${root}:${selectedChange.path}`);
      }
    }
  );

  provider.state = repositoryState(
    provider.state,
    '/repo-a',
    [change('same.txt')],
    ['/repo-a', '/repo-b']
  );
  provider.refresh = async () => undefined;

  try {
    await provider.handleMessage(
      {
        type: 'toggleHunk',
        root: '/repo-b',
        path: 'same.txt',
        hunkId: 'hunk-1',
        checked: true,
        requestId: 'wrong-root'
      }
    );
    await provider.handleMessage(
      {
        type: 'toggleHunk',
        root: '/repo-a',
        path: 'same.txt',
        hunkId: 'hunk-1',
        checked: true,
        requestId: 'right-root'
      }
    );

    // Приемочный свидетель: отложенное событие другого репозитория не меняет текущий индекс.
    assert.deepEqual(calls, ['/repo-a:same.txt']);
    assert.deepEqual(provider.state.confirmedStagingRequestIds, ['right-root']);
    // Контрольный факт вне области изменения: корректный запрос текущего репозитория выполняется.
    assert.deepEqual(provider.state.failedStagingRequestIds, []);
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testDestructiveRequestsAreScopedToTheSelectedRepository() {
  const { provider } = createProvider();
  const calls = [];
  const restoreGit = stubGit(
    {
      rollbackPath: async (root, selectedChange) => {
        calls.push(`rollback:${root}:${selectedChange.path}`);
      },
      shelvePath: async (root, selectedChange) => {
        calls.push(`shelve:${root}:${selectedChange.path}`);
      }
    }
  );

  provider.state = repositoryState(
    provider.state,
    '/repo-a',
    [change('same.txt')],
    ['/repo-a', '/repo-b']
  );
  provider.refresh = async () => undefined;

  try {
    await provider.handleMessage(
      { type: 'rollbackChange', root: '/repo-b', path: 'same.txt' }
    );
    await provider.handleMessage(
      { type: 'shelveChange', root: '/repo-b', path: 'same.txt' }
    );
    await provider.handleMessage(
      { type: 'rollbackChange', root: '/repo-a', path: 'same.txt' }
    );
    await provider.handleMessage(
      { type: 'shelveChange', root: '/repo-a', path: 'same.txt' }
    );

    // Приемочный свидетель: разрушительные события из старого репозитория отклоняются.
    assert.deepEqual(
      calls,
      [
        'rollback:/repo-a:same.txt',
        'shelve:/repo-a:same.txt'
      ]
    );
    // Контрольный факт вне области изменения: оба действия работают в текущем репозитории.
    assert.equal(calls.length, 2);
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testImplicitRepositoryFallbackClearsStagingFailureScope() {
  const { provider } = createProvider();
  let diffCalls = 0;
  const restoreGit = stubGit(
    {
      getStatus: async () => [change('same.txt')],
      getLastCommitSummary: async () => '',
      listIgnoredFiles: async () => [],
      getFileDiff: async (root) => {
        assert.equal(root, '/repo-b');
        diffCalls += 1;
        return {
          ...preview('same.txt'),
          message: 'repo-b preview'
        };
      }
    }
  );
  provider.state = {
    ...repositoryState(
      provider.state,
      '/repo-a',
      [change('same.txt')],
      ['/repo-a', '/repo-b']
    ),
    diffPreviewEnabled: true,
    selectedPath: 'same.txt',
    diffPreview: {
      ...preview('same.txt'),
      message: 'repo-a preview'
    },
    amend: true,
    amendVersion: 2,
    errorText: 'repo-a staging failed',
    failedStagingRequestIds: ['repo-a-request']
  };
  provider.failedStagingPaths.set('same.txt', true);
  provider.stagingErrorText = 'repo-a staging failed';
  provider.lastDiffRefreshAt = Date.now();
  provider.resolveRepositories = async () => ['/repo-b'];

  try {
    await provider.refresh({ force: true, showProgress: false });

    // Приемочный свидетель: implicit fallback не переносит path failures между репозиториями.
    assert.equal(provider.state.selectedRoot, '/repo-b');
    assert.equal(provider.failedStagingPaths.size, 0);
    assert.equal(provider.stagingErrorText, '');
    assert.deepEqual(provider.state.failedStagingRequestIds, []);
    assert.equal(provider.state.amend, false);
    assert.equal(provider.state.amendVersion, 3);
    assert.equal(await provider.flushPendingStagingWork(), true);
    assert.equal(diffCalls, 1);
    assert.equal(provider.state.diffPreview.message, 'repo-b preview');
    // Контрольный факт вне области изменения: одноимённый путь B остаётся видимым.
    assert.equal(provider.findChange('same.txt').path, 'same.txt');
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testNewestForcedRefreshWins() {
  const { provider, posted } = createProvider();
  const firstStatus = deferred();
  let statusCalls = 0;
  const restoreGit = stubGit(
    {
      getStatus: async () => {
        statusCalls += 1;
        return statusCalls === 1 ? firstStatus.promise : [change('new.txt')];
      },
      getLastCommitSummary: async () => 'last',
      listIgnoredFiles: async () => []
    }
  );

  provider.resolveRepositories = async () => ['/repo'];
  provider.state.repositories = [{ root: '/repo', name: 'repo' }];
  provider.state.selectedRoot = '/repo';

  try {
    const firstRefresh = provider.refresh({ force: true, showProgress: false });
    await nextMicrotask();
    const secondRefresh = provider.refresh({ force: true, showProgress: false });
    firstStatus.resolve([change('old.txt')]);

    await Promise.all([firstRefresh, secondRefresh]);

    assert.equal(statusCalls, 2);
    assert.deepEqual(provider.state.changes.map((item) => item.path), ['new.txt']);
    assert.equal(
      posted.some(
        (message) => (message.state.changes || []).some(
          (item) => item.path === 'old.txt'
        )
      ),
      false,
      'a stale forced refresh must never be posted'
    );
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testForcedRefreshAbortsTheCurrentGitRead() {
  const { provider } = createProvider();
  const secondStatusStarted = deferred();
  let statusCalls = 0;
  const restoreGit = stubGit(
    {
      getStatus: async (_root, options = {}) => {
        statusCalls += 1;

        if (statusCalls === 1) {
          return new Promise(
            (_resolve, reject) => {
              options.signal.addEventListener(
                'abort',
                () => {
                  const error = new Error('cancelled');
                  error.name = 'AbortError';
                  reject(error);
                },
                { once: true }
              );
            }
          );
        }

        secondStatusStarted.resolve();
        return [change('latest.txt')];
      },
      getLastCommitSummary: async () => '',
      listIgnoredFiles: async () => []
    }
  );

  provider.resolveRepositories = async () => ['/repo'];
  provider.state.selectedRoot = '/repo';

  try {
    const firstRefresh = provider.refresh({ force: true, showProgress: false });
    await nextMicrotask();
    const secondRefresh = provider.refresh({ force: true, showProgress: false });

    // Приемочный свидетель: новый принудительный запрос отменяет текущий Git read.
    await waitFor(secondStatusStarted.promise, 'replacement Git status');
    await Promise.all([firstRefresh, secondRefresh]);
    assert.equal(statusCalls, 2);
    assert.deepEqual(
      provider.state.changes.map((item) => item.path),
      ['latest.txt']
    );
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testMutationAbortsStaleRefreshAndClearsDeferredDuplicate() {
  const { provider, posted } = createProvider();
  const mutationStarted = deferred();
  const finishMutation = deferred();
  const staleStatus = deferred();
  let abortObserved = false;
  let statusCalls = 0;
  const stagedChange = {
    ...change('selected.txt'),
    staged: true,
    hasStaged: true,
    hasUnstaged: false
  };
  const restoreGit = stubGit(
    {
      getStatus: async (_root, options = {}) => {
        statusCalls += 1;

        if (statusCalls === 1) {
          options.signal.addEventListener(
            'abort',
            () => {
              abortObserved = true;
            },
            { once: true }
          );
          return staleStatus.promise;
        }

        return [stagedChange];
      },
      getLastCommitSummary: async () => '',
      listIgnoredFiles: async () => [],
      stageAll: async () => {
        mutationStarted.resolve();
        await finishMutation.promise;
      }
    }
  );
  provider.resolveRepositories = async () => ['/repo'];
  provider.state = repositoryState(
    provider.state,
    '/repo',
    [change('selected.txt')],
    ['/repo']
  );

  try {
    const staleRefresh = provider.refresh({ showProgress: false });
    await nextMicrotask();
    const mutation = provider.stageAll();
    await waitFor(mutationStarted.promise, 'stage-all mutation');
    void provider.refresh();
    assert.ok(provider.pendingRefreshTimer);
    finishMutation.resolve();
    staleStatus.resolve([change('stale.txt')]);

    await Promise.all([staleRefresh, mutation]);

    // Приемочный свидетель: мутация отменяет старый read и публикует только authoritative post-write state.
    assert.equal(abortObserved, true);
    assert.equal(statusCalls, 2);
    assert.equal(provider.pendingRefreshTimer, undefined);
    assert.deepEqual(provider.state.changes, [stagedChange]);
    assert.equal(
      posted.some(
        (message) => (message.state.changes || []).some(
          (item) => item.path === 'stale.txt'
        )
      ),
      false
    );
  } finally {
    finishMutation.resolve();
    staleStatus.resolve([change('stale.txt')]);
    restoreGit();
    disposeProvider(provider);
  }
}

async function testRefreshRequestedWhileBusyIsNotDropped() {
  const { provider } = createProvider();
  const firstStatus = deferred();
  let statusCalls = 0;
  const restoreGit = stubGit(
    {
      getStatus: async () => {
        statusCalls += 1;
        return statusCalls === 1 ? firstStatus.promise : [change('second.txt')];
      },
      getLastCommitSummary: async () => '',
      listIgnoredFiles: async () => []
    }
  );

  provider.resolveRepositories = async () => ['/repo'];
  provider.state.selectedRoot = '/repo';

  try {
    const firstRefresh = provider.refresh();
    await nextMicrotask();
    const queuedRefresh = provider.refresh();
    firstStatus.resolve([change('first.txt')]);
    await Promise.all([firstRefresh, queuedRefresh]);

    assert.equal(statusCalls, 2, 'a refresh arriving during a read must run after the current read');
    assert.deepEqual(provider.state.changes.map((item) => item.path), ['second.txt']);
  } finally {
    restoreGit();
    disposeProvider(provider);
  }
}

async function testSelectingAnotherFileAbortsTheStaleDiff() {
  const { provider } = createProvider();
  const firstDiff = deferred();
  const seenSignals = [];
  const restoreGit = stubGit(
    {
      getFileDiff: async (_root, selectedChange, options) => {
        seenSignals.push(options.signal);
        if (selectedChange.path === 'first.txt') {
          return firstDiff.promise;
        }

        return preview('second.txt');
      },
      getBlame: async () => ({})
    }
  );

  provider.state = {
    ...repositoryState(
      provider.state,
      '/repo',
      [change('first.txt'), change('second.txt')],
      ['/repo']
    ),
    diffPreviewEnabled: true,
    selectedPath: 'first.txt'
  };

  try {
    const staleRequest = provider.loadDiffPreview();
    await nextMicrotask();
    const newestRequest = provider.selectChange('second.txt');
    await newestRequest;

    assert.equal(seenSignals.length, 2);
    assert.equal(seenSignals[0].aborted, true);
    firstDiff.resolve(preview('first.txt'));
    await staleRequest;
    assert.equal(provider.state.diffPreview.path, 'second.txt');
  } finally {
    firstDiff.resolve(preview('first.txt'));
    restoreGit();
    disposeProvider(provider);
  }
}

function testExtensionDoesNotMutateGlobalSoundSettings() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');

  assert.doesNotMatch(source, /accessibility\.signals|accessibility\.signalOptions|terminal\.integrated\.enableBell/);
  assert.equal(extension.disableEditorSounds, undefined);
  assert.equal(extension.ensureEditorSoundsDisabled, undefined);
}

function createProvider() {
  const posted = [];
  const context = {
    extensionUri: { fsPath: '/extension' },
    globalState: {
      get: (_key, fallback) => fallback,
      update: async () => undefined
    },
    subscriptions: []
  };
  const provider = new PhpStormCommitPanelProvider(context);
  provider.view = {
    visible: true,
    webview: {
      postMessage(message) {
        posted.push(JSON.parse(JSON.stringify(message)));
        return Promise.resolve(true);
      }
    }
  };

  return { context, posted, provider };
}

function repositoryState(state, selectedRoot, changes, roots) {
  return {
    ...state,
    selectedRoot,
    repositories: roots.map((root) => ({ root, name: path.basename(root) })),
    changes
  };
}

function change(relativePath) {
  return {
    path: relativePath,
    kind: 'modified',
    staged: false,
    hasStaged: false,
    hasUnstaged: true,
    partiallyStaged: false
  };
}

function preview(relativePath) {
  return {
    path: relativePath,
    hunks: [],
    differenceCount: 0,
    includedCount: 0,
    canToggleFile: true,
    canToggleHunks: false,
    message: ''
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    }
  );

  return { promise, reject, resolve };
}

function nextMicrotask() {
  return new Promise((resolve) => setImmediate(resolve));
}

function waitFor(promise, label, timeoutMs = 2000) {
  let timeoutHandle;
  const timeout = new Promise(
    (_resolve, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`Timed out waiting for ${label}.`)),
        timeoutMs
      );
    }
  );

  return Promise.race(
    [promise, timeout]
  ).finally(
    () => clearTimeout(timeoutHandle)
  );
}

async function* textFragments(value) {
  yield value;
}

function stubGit(overrides) {
  const originals = new Map();

  for (const [name, implementation] of Object.entries(overrides)) {
    originals.set(name, git[name]);
    git[name] = implementation;
  }

  return () => {
    for (const [name, implementation] of originals.entries()) {
      git[name] = implementation;
    }
  };
}

function disposeProvider(provider) {
  provider.clearScheduledRefresh();
  provider.clearStagingFlushTimer();
  provider.abortRefreshRequest();
  provider.abortDiffPreviewRequest();
}

run().catch(
  (error) => {
    process.exitCode = 1;
    console.error(error);
  }
);
