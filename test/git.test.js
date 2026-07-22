'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  commit,
  execGit,
  findRepositoryRoot,
  getLastCommitSummary,
  getFileDiff,
  getStatus,
  getStagedDiff,
  listIgnoredFiles,
  parsePorcelainStatus,
  rollbackPath,
  setPathsStaged,
  setHunkIncluded,
  shelvePath,
  stageAll,
  stagePaths,
  unstageAll,
  unstagePaths
} = require('../src/git');

async function run() {
  testParser();
  await testNoLastCommitPlaceholder();
  await testGitStagingRoundTrip();
  await testStalePathspecsDoNotBlockCurrentStaging();
  await testPartialHunkRoundTrip();
  await testIgnoredFilesAreOptInData();
  await testSelectedPathOperationsDoNotTouchNeighbours();
  await testLiteralPathspecDoesNotExpandMetacharacters();
  await testWindowsLongPathspecBatchIsChunkedByCommandSize();
  await testPosixBackslashFilenameRemainsLiteral();
  await testMixedStagingStatesUseOnePublicOperation();
  await testUnbornRepositoryUnstagingKeepsWorktree();
  await testCopySourceSelectionDoesNotAffectDestination();
  await testRenamePreviewAndShelveCoverOldAndNewPaths();
  await testOccupiedRenameSourceKeepsIndexAndFilesSafe();
  await testUntrackedPreviewRejectsUnsafeAndAbortedReads();
  await testAlreadyAbortedSignalRejectsWithoutPoisoningNextCommand();
  await testPartiallySelectedFolderStagesEveryDescendantOnly();
  await testParentFolderStageIgnoresAlreadyStagedDeletedDescendant();
}

function testParser() {
  const changes = parsePorcelainStatus(
    [
      ' M tracked.txt',
      '?? new.txt',
      'A  staged-new.txt',
      'R  renamed-new.txt',
      'renamed-old.txt',
      'MM partly.txt',
      ''
    ].join('\0')
  );

  const byPath = new Map(changes.map((change) => [change.path, change]));

  assert.equal(byPath.get('tracked.txt').staged, false);
  assert.equal(byPath.get('tracked.txt').kind, 'modified');
  assert.equal(byPath.get('new.txt').untracked, true);
  assert.equal(byPath.get('new.txt').staged, false);
  assert.equal(byPath.get('staged-new.txt').staged, true);
  assert.equal(byPath.get('renamed-new.txt').staged, true);
  assert.equal(byPath.get('renamed-new.txt').originalPath, 'renamed-old.txt');
  assert.equal(byPath.get('partly.txt').staged, true);
  assert.equal(byPath.get('partly.txt').partiallyStaged, true);
}

async function testPartialHunkRoundTrip() {
  // Приемочный свидетель: фрагмент с нулевым контекстом проходит полный цикл включения.
  // Контрольный факт вне области изменения: второй фрагмент остаётся невключённым.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-hunks-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);
    fs.writeFileSync(
      path.join(tempRoot, 'partial.txt'),
      Array.from({ length: 14 }, (_, index) => `line ${index + 1}`).join('\n') + '\n',
      'utf8'
    );
    await execGit(tempRoot, ['add', 'partial.txt']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    const lines = fs.readFileSync(path.join(tempRoot, 'partial.txt'), 'utf8').split('\n');
    lines[1] = 'changed line 2';
    lines[11] = 'changed line 12';
    fs.writeFileSync(path.join(tempRoot, 'partial.txt'), lines.join('\n'), 'utf8');

    let change = (await getStatus(tempRoot)).find((candidate) => candidate.path === 'partial.txt');
    let preview = await getFileDiff(tempRoot, change, { contextLines: 0 });
    const unstagedHunks = preview.hunks.filter((hunk) => !hunk.included);
    assert.equal(unstagedHunks.length, 2);
    assert.equal(Object.hasOwn(unstagedHunks[0], 'rawLines'), false);
    await assert.rejects(
      () => setHunkIncluded(
        tempRoot,
        change,
        'stale-hunk-id',
        true,
        { contextLines: 0 }
      ),
      /no longer available/i
    );

    await setHunkIncluded(
      tempRoot,
      change,
      unstagedHunks[0].id,
      true,
      { contextLines: 0 }
    );
    change = (await getStatus(tempRoot)).find((candidate) => candidate.path === 'partial.txt');
    assert.equal(change.partiallyStaged, true);

    preview = await getFileDiff(tempRoot, change, { contextLines: 0 });
    assert.equal(preview.hunks.filter((hunk) => hunk.included).length, 1);
    assert.equal(preview.hunks.filter((hunk) => !hunk.included).length, 1);

    const includedHunk = preview.hunks.find((hunk) => hunk.included);
    await setHunkIncluded(
      tempRoot,
      change,
      includedHunk.id,
      false,
      { contextLines: 0 }
    );
    change = (await getStatus(tempRoot)).find((candidate) => candidate.path === 'partial.txt');
    assert.equal(change.staged, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testIgnoredFilesAreOptInData() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-ignored-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    fs.writeFileSync(path.join(tempRoot, '.gitignore'), 'ignored.txt\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'ignored.txt'), 'ignored\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'visible.txt'), 'visible\n', 'utf8');

    const ignored = await listIgnoredFiles(tempRoot);
    const status = await getStatus(tempRoot);

    assert.deepEqual(ignored.map((entry) => entry.path), ['ignored.txt']);
    assert.equal(status.some((entry) => entry.path === 'ignored.txt'), false);
    assert.equal(status.some((entry) => entry.path === 'visible.txt'), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testSelectedPathOperationsDoNotTouchNeighbours() {
  // Приемочный свидетель: полка и откат изменяют только выбранный путь.
  // Контрольный факт вне области изменения: обе версии соседнего файла остаются побайтно прежними.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-path-actions-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);
    fs.writeFileSync(path.join(tempRoot, 'first.txt'), 'first\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'second.txt'), 'second\n', 'utf8');
    await execGit(tempRoot, ['add', '.']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    fs.writeFileSync(path.join(tempRoot, 'first.txt'), 'changed first\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'second.txt'), 'changed second\n', 'utf8');
    await execGit(tempRoot, ['add', 'second.txt']);
    fs.writeFileSync(path.join(tempRoot, 'second.txt'), 'changed second again\n', 'utf8');
    const neighbourIndexPatch = await execGit(
      tempRoot,
      ['diff', '--cached', '--binary', '--', 'second.txt']
    );
    const neighbourWorktreePatch = await execGit(
      tempRoot,
      ['diff', '--binary', '--', 'second.txt']
    );
    let changes = await getStatus(tempRoot);

    await shelvePath(tempRoot, changes.find((change) => change.path === 'first.txt'));
    changes = await getStatus(tempRoot);
    assert.equal(changes.some((change) => change.path === 'first.txt'), false);
    assert.equal(changes.some((change) => change.path === 'second.txt'), true);
    assert.equal(changes.find((change) => change.path === 'second.txt').staged, true);
    assert.equal(
      await execGit(tempRoot, ['diff', '--cached', '--binary', '--', 'second.txt']),
      neighbourIndexPatch,
      'shelving one file must preserve a neighbouring staged patch byte-for-byte'
    );
    assert.equal(
      await execGit(tempRoot, ['diff', '--binary', '--', 'second.txt']),
      neighbourWorktreePatch,
      'shelving one file must preserve a neighbouring unstaged patch byte-for-byte'
    );
    const shelvedPaths = await execGit(tempRoot, ['stash', 'show', '--name-only', 'stash@{0}']);
    assert.match(shelvedPaths, /first\.txt/);
    assert.doesNotMatch(shelvedPaths, /second\.txt/);

    await rollbackPath(tempRoot, changes.find((change) => change.path === 'second.txt'));
    changes = await getStatus(tempRoot);
    assert.equal(changes.length, 0);

    await assert.rejects(
      () => rollbackPath(tempRoot, { path: 'untracked.txt', untracked: true }),
      /new files/i
    );
    await assert.rejects(
      () => rollbackPath(tempRoot, { path: 'added.txt', kind: 'added' }),
      /new files/i
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testLiteralPathspecDoesNotExpandMetacharacters() {
  // Приемочный свидетель: буквальный путь с [] проходит через публичные Git-операции.
  // Контрольный факт вне области изменения: сосед file1.txt сохраняет своё состояние индекса.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-literal-pathspec-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);
    fs.writeFileSync(path.join(tempRoot, 'file[1].txt'), 'literal\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'file1.txt'), 'neighbour\n', 'utf8');
    await execGit(tempRoot, ['add', '.']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    fs.writeFileSync(path.join(tempRoot, 'file[1].txt'), 'literal changed\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'file1.txt'), 'neighbour changed\n', 'utf8');
    let status = await getStatus(tempRoot);
    const preview = await getFileDiff(
      tempRoot,
      status.find((change) => change.path === 'file[1].txt')
    );
    const previewText = preview.hunks
      .flatMap((hunk) => hunk.lines.map((line) => line.text))
      .join('\n');
    assert.match(previewText, /literal changed/);
    assert.doesNotMatch(previewText, /neighbour changed/);

    await stagePaths(tempRoot, ['file[1].txt']);

    status = await getStatus(tempRoot);
    assert.equal(status.find((change) => change.path === 'file[1].txt').staged, true);
    assert.equal(status.find((change) => change.path === 'file1.txt').staged, false);

    await execGit(tempRoot, ['add', '--', 'file1.txt']);
    await unstagePaths(tempRoot, ['file[1].txt']);
    status = await getStatus(tempRoot);
    assert.equal(status.find((change) => change.path === 'file[1].txt').staged, false);
    assert.equal(status.find((change) => change.path === 'file1.txt').staged, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testWindowsLongPathspecBatchIsChunkedByCommandSize() {
  // Приемочный свидетель: длинный пакет путей укладывается в предел командной строки Windows.
  // Контрольный факт вне области изменения: control.txt не попадает в индекс.
  if (process.platform !== 'win32') {
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-pathspec-chunk-'));
  const relativePaths = Array.from(
    { length: 200 },
    (_, index) => `file-${String(index).padStart(3, '0')}-${'x'.repeat(150)}.txt`
  );
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);

    for (const relativePath of relativePaths) {
      fs.writeFileSync(path.join(tempRoot, relativePath), `${relativePath}\n`, 'utf8');
    }

    fs.writeFileSync(path.join(tempRoot, 'control.txt'), 'control\n', 'utf8');

    await stagePaths(tempRoot, relativePaths);

    let status = await getStatus(tempRoot);
    assert.equal(
      relativePaths.every(
        (relativePath) => status.find((change) => change.path === relativePath)?.staged
      ),
      true
    );
    assert.equal(status.find((change) => change.path === 'control.txt').staged, false);

    await unstagePaths(tempRoot, relativePaths);

    status = await getStatus(tempRoot);
    assert.equal(status.every((change) => !change.staged), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testPosixBackslashFilenameRemainsLiteral() {
  // Приемочный свидетель: обратная косая черта в имени POSIX-файла не становится разделителем.
  if (process.platform === 'win32') {
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-backslash-path-'));
  const relativePath = 'back\\slash.txt';
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);
    fs.writeFileSync(path.join(tempRoot, relativePath), 'initial\n', 'utf8');
    await execGit(tempRoot, ['--literal-pathspecs', 'add', '--', relativePath]);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    fs.writeFileSync(path.join(tempRoot, relativePath), 'changed\n', 'utf8');
    let status = await getStatus(tempRoot);
    assert.equal(status[0].path, relativePath);

    await stagePaths(tempRoot, [relativePath]);
    status = await getStatus(tempRoot);
    assert.equal(status[0].path, relativePath);
    assert.equal(status[0].staged, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testMixedStagingStatesUseOnePublicOperation() {
  // Приемочный свидетель: один запрос одновременно включает и исключает разные файлы.
  // Контрольный факт вне области изменения: control.txt сохраняет подготовленное состояние.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-mixed-path-states-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);
    fs.writeFileSync(path.join(tempRoot, 'stage.txt'), 'initial\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'unstage.txt'), 'initial\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'control.txt'), 'initial\n', 'utf8');
    await execGit(tempRoot, ['add', '.']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    fs.writeFileSync(path.join(tempRoot, 'stage.txt'), 'changed\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'unstage.txt'), 'changed\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'control.txt'), 'changed\n', 'utf8');
    await execGit(tempRoot, ['add', '--', 'unstage.txt', 'control.txt']);

    await setPathsStaged(tempRoot, ['stage.txt'], ['unstage.txt']);

    const status = await getStatus(tempRoot);
    assert.equal(status.find((change) => change.path === 'stage.txt').staged, true);
    assert.equal(status.find((change) => change.path === 'unstage.txt').staged, false);
    assert.equal(status.find((change) => change.path === 'control.txt').staged, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testUnbornRepositoryUnstagingKeepsWorktree() {
  // Приемочный свидетель: исключение из индекса работает до первого коммита.
  // Контрольный факт вне области изменения: соседний файл и новая версия рабочей копии сохраняются.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-unborn-unstage-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);
    fs.writeFileSync(path.join(tempRoot, 'first.txt'), 'first\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'second.txt'), 'second staged\n', 'utf8');
    await execGit(tempRoot, ['add', '--', 'first.txt', 'second.txt']);
    fs.writeFileSync(path.join(tempRoot, 'second.txt'), 'second worktree\n', 'utf8');

    await unstagePaths(tempRoot, ['first.txt']);

    let status = await getStatus(tempRoot);
    assert.equal(status.find((change) => change.path === 'first.txt').staged, false);
    assert.equal(status.find((change) => change.path === 'second.txt').staged, true);
    assert.equal(fs.readFileSync(path.join(tempRoot, 'first.txt'), 'utf8'), 'first\n');

    await unstageAll(tempRoot);

    status = await getStatus(tempRoot);
    assert.equal(status.every((change) => !change.staged), true);
    assert.equal(
      fs.readFileSync(path.join(tempRoot, 'second.txt'), 'utf8'),
      'second worktree\n'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testCopySourceSelectionDoesNotAffectDestination() {
  // Приемочный свидетель: исходный файл и файл-копия остаются независимыми флажками.
  // Контрольный факт вне области изменения: подготовленная copy.txt остаётся в индексе.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-copy-pathspec-'));
  const sharedLines = Array.from(
    { length: 12 },
    (_, index) => `shared line ${index + 1}`
  );
  const sourceContent = `${sharedLines.join('\n')}\n`;
  const copyLines = [...sharedLines];
  copyLines[9] = 'copy destination changed';
  const copyContent = `${copyLines.join('\n')}\n`;
  const changedSourceLines = [...sharedLines];
  changedSourceLines[0] = 'source changed independently';
  const changedSourceContent = `${changedSourceLines.join('\n')}\n`;
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot, { detectCopies: true });
    fs.writeFileSync(path.join(tempRoot, 'source.txt'), sourceContent, 'utf8');
    await execGit(tempRoot, ['add', '.']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    fs.copyFileSync(path.join(tempRoot, 'source.txt'), path.join(tempRoot, 'copy.txt'));
    fs.writeFileSync(path.join(tempRoot, 'copy.txt'), copyContent, 'utf8');
    await execGit(tempRoot, ['add', '--', 'copy.txt']);
    fs.writeFileSync(path.join(tempRoot, 'source.txt'), changedSourceContent, 'utf8');
    await execGit(tempRoot, ['add', '--', 'source.txt']);

    const statusBeforeUnstage = await getStatus(tempRoot);
    const copyBeforeUnstage = statusBeforeUnstage.find(
      (change) => change.path === 'copy.txt'
    );
    assert.ok(copyBeforeUnstage, 'copy detection must expose copy.txt as a current change');
    assert.equal(copyBeforeUnstage.kind, 'copied');
    assert.equal(copyBeforeUnstage.originalPath, 'source.txt');
    const copyPreview = await getFileDiff(tempRoot, copyBeforeUnstage);
    assert.equal(copyPreview.hunks.length > 0, true);
    assert.equal(copyPreview.canToggleHunks, false);
    const copyPreviewText = copyPreview.hunks
      .flatMap((hunk) => hunk.lines.map((line) => line.text))
      .join('\n');
    assert.match(copyPreviewText, /copy destination changed/);
    assert.doesNotMatch(copyPreviewText, /source changed independently/);
    await assert.rejects(
      () => setHunkIncluded(
        tempRoot,
        copyBeforeUnstage,
        copyPreview.hunks[0].id,
        false
      ),
      /file mode, rename, or copy metadata/i
    );

    await unstagePaths(tempRoot, ['source.txt']);

    const status = await getStatus(tempRoot);
    assert.equal(status.find((change) => change.path === 'source.txt').staged, false);
    assert.equal(status.find((change) => change.path === 'copy.txt').staged, true);
    await assert.rejects(
      () => rollbackPath(tempRoot, { path: 'copy.txt', kind: 'copied' }),
      /new files/i
    );
    assert.equal(fs.readFileSync(path.join(tempRoot, 'copy.txt'), 'utf8'), copyContent);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testRenamePreviewAndShelveCoverOldAndNewPaths() {
  // Приемочный свидетель: структурное переименование запрещает изменение отдельного фрагмента.
  // Контрольный факт вне области изменения: соседнее подготовленное изменение остаётся прежним.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-rename-pathspec-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);
    fs.writeFileSync(path.join(tempRoot, 'before.txt'), 'line one\nline two\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'neighbour.txt'), 'initial\n', 'utf8');
    await execGit(tempRoot, ['add', '.']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    await execGit(tempRoot, ['mv', 'before.txt', 'after.txt']);
    fs.writeFileSync(path.join(tempRoot, 'after.txt'), 'line one\nline two changed\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'neighbour.txt'), 'neighbour changed\n', 'utf8');
    await execGit(tempRoot, ['add', '--', 'neighbour.txt']);

    const rename = (await getStatus(tempRoot)).find((change) => change.path === 'after.txt');
    assert.equal(rename.originalPath, 'before.txt');
    const preview = await getFileDiff(tempRoot, rename, { contextLines: 1 });
    assert.equal(preview.path, 'after.txt');
    assert.equal(preview.hunks.length > 0, true);
    assert.equal(
      preview.canToggleHunks,
      false,
      'rename metadata must disable partial hunk staging'
    );
    await assert.rejects(
      () => setHunkIncluded(
        tempRoot,
        rename,
        preview.hunks[0].id,
        true,
        { contextLines: 1 }
      ),
      /file mode, rename, or copy metadata/i
    );

    const neighbourPatch = await execGit(
      tempRoot,
      ['diff', '--cached', '--binary', '--', 'neighbour.txt']
    );
    await shelvePath(tempRoot, rename);
    const status = await getStatus(tempRoot);
    assert.equal(status.some((change) => ['before.txt', 'after.txt'].includes(change.path)), false);
    assert.equal(
      await execGit(tempRoot, ['diff', '--cached', '--binary', '--', 'neighbour.txt']),
      neighbourPatch
    );
    const shelvedPaths = await execGit(tempRoot, ['stash', 'show', '--name-status', 'stash@{0}']);
    assert.match(shelvedPaths, /(before|after)\.txt/);
    assert.doesNotMatch(shelvedPaths, /neighbour\.txt/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testOccupiedRenameSourceKeepsIndexAndFilesSafe() {
  // Приемочный свидетель: занятый исходный путь блокирует откат
  // и помещение на полку до изменения файлов.
  // Контрольный факт вне области изменения: содержимое исходного и нового файлов остаётся прежним.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-occupied-rename-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);
    fs.writeFileSync(path.join(tempRoot, 'old.txt'), 'original\n', 'utf8');
    await execGit(tempRoot, ['add', '.']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);
    await execGit(tempRoot, ['mv', 'old.txt', 'new.txt']);
    fs.writeFileSync(path.join(tempRoot, 'new.txt'), 'renamed content\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'old.txt'), 'new local file\n', 'utf8');
    let rename = (await getStatus(tempRoot)).find(
      (change) => change.path === 'new.txt'
    );
    assert.ok(rename, 'the real status must expose the staged rename');
    assert.equal(rename.originalPath, 'old.txt');

    await stagePaths(tempRoot, ['new.txt']);

    const stagedStatus = await getStatus(tempRoot);
    const occupiedOriginal = stagedStatus.find(
      (change) => change.path === 'old.txt'
    );
    assert.ok(occupiedOriginal, 'the recreated original path must remain visible');
    assert.equal(occupiedOriginal.staged, false);
    assert.equal(occupiedOriginal.untracked, true);
    rename = stagedStatus.find((change) => change.path === 'new.txt');

    await assert.rejects(
      () => rollbackPath(tempRoot, rename),
      /original path now contains another local file/i
    );
    await assert.rejects(
      () => shelvePath(tempRoot, rename),
      /original path now contains another local file/i
    );
    assert.equal(fs.readFileSync(path.join(tempRoot, 'old.txt'), 'utf8'), 'new local file\n');
    assert.equal(fs.readFileSync(path.join(tempRoot, 'new.txt'), 'utf8'), 'renamed content\n');

    await unstagePaths(tempRoot, ['new.txt']);

    const unstagedStatus = await getStatus(tempRoot);
    assert.equal(unstagedStatus.every((change) => !change.staged), true);
    assert.equal(fs.readFileSync(path.join(tempRoot, 'old.txt'), 'utf8'), 'new local file\n');
    assert.equal(fs.readFileSync(path.join(tempRoot, 'new.txt'), 'utf8'), 'renamed content\n');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testUntrackedPreviewRejectsUnsafeAndAbortedReads() {
  // Приемочный свидетель: предпросмотр отклоняет отмену, выход из репозитория и символьную ссылку.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-untracked-safety-'));
  ensureSafeTempRoot(tempRoot);

  try {
    fs.writeFileSync(path.join(tempRoot, 'new.txt'), 'preview\n', 'utf8');
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => getFileDiff(
        tempRoot,
        { path: 'new.txt', untracked: true },
        { signal: controller.signal }
      ),
      (error) => error?.name === 'AbortError'
    );
    await assert.rejects(
      () => getFileDiff(tempRoot, { path: '../outside.txt', untracked: true }),
      /outside the repository/i
    );

    try {
      fs.symlinkSync('new.txt', path.join(tempRoot, 'new-link.txt'), 'file');
      const symlinkPreview = await getFileDiff(
        tempRoot,
        { path: 'new-link.txt', untracked: true }
      );
      assert.equal(symlinkPreview.hunks.length, 0);
      assert.match(symlinkPreview.message, /symbolic link/i);
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
        throw error;
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testAlreadyAbortedSignalRejectsWithoutPoisoningNextCommand() {
  // Приемочный свидетель: уже отменённый signal виден как AbortError на Git-границе.
  // Контрольный факт вне области изменения: следующий обычный Git-запрос завершается успешно.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-git-abort-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => execGit(
        tempRoot,
        ['status', '--porcelain'],
        { signal: controller.signal }
      ),
      (error) => error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
    );
    await assert.rejects(
      () => findRepositoryRoot(
        tempRoot,
        { signal: controller.signal }
      ),
      (error) => error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
    );

    const repositoryRoot = await findRepositoryRoot(tempRoot);
    assert.equal(repositoryRoot, path.resolve(tempRoot));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function configureTestRepository(root, options = {}) {
  const hooksPath = path.join(root, '.git', 'test-hooks');
  fs.mkdirSync(hooksPath, { recursive: true });
  await execGit(root, ['config', 'user.email', 'test@example.invalid']);
  await execGit(root, ['config', 'user.name', 'Test User']);
  await execGit(root, ['config', 'commit.gpgSign', 'false']);
  await execGit(root, ['config', 'core.autocrlf', 'false']);
  await execGit(root, ['config', 'core.hooksPath', hooksPath]);
  await execGit(root, ['config', 'diff.renames', options.detectCopies ? 'copies' : 'true']);
  await execGit(root, ['config', 'status.renames', options.detectCopies ? 'copies' : 'true']);
}

async function testPartiallySelectedFolderStagesEveryDescendantOnly() {
  // Приемочный свидетель: выбор папки включает каждый её изменённый файл.
  // Контрольный факт вне области изменения: outside.txt остаётся неподготовленным.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-folder-stage-'));
  ensureSafeTempRoot(tempRoot);
  const folder = path.join(tempRoot, 'market-engine');
  const descendantPaths = Array.from(
    { length: 12 },
    (_, index) => index < 6
      ? `market-engine/change-${index + 1}.txt`
      : `market-engine/nested/change-${index + 1}.txt`
  );

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);
    fs.mkdirSync(path.join(folder, 'nested'), { recursive: true });

    for (const relativePath of descendantPaths) {
      fs.writeFileSync(path.join(tempRoot, relativePath), 'initial\n', 'utf8');
    }

    fs.writeFileSync(path.join(tempRoot, 'outside.txt'), 'initial\n', 'utf8');
    await execGit(tempRoot, ['add', '.']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    for (const relativePath of descendantPaths) {
      fs.writeFileSync(path.join(tempRoot, relativePath), 'changed\n', 'utf8');
    }

    fs.writeFileSync(path.join(tempRoot, 'outside.txt'), 'changed\n', 'utf8');
    await stagePaths(tempRoot, descendantPaths.slice(0, 2));

    let status = await getStatus(tempRoot);
    const folderChangesBeforeClick = status.filter(
      (change) => change.path.startsWith('market-engine/')
    );
    assert.equal(folderChangesBeforeClick.length, 12);
    assert.equal(folderChangesBeforeClick.filter((change) => change.staged).length, 2);

    await stagePaths(
      tempRoot,
      folderChangesBeforeClick.map((change) => change.path)
    );

    status = await getStatus(tempRoot);
    const folderChangesAfterClick = status.filter(
      (change) => change.path.startsWith('market-engine/')
    );
    assert.equal(folderChangesAfterClick.every((change) => change.staged), true);
    assert.equal(status.find((change) => change.path === 'outside.txt').staged, false);

    await unstagePaths(
      tempRoot,
      folderChangesAfterClick.map((change) => change.path)
    );

    status = await getStatus(tempRoot);
    const folderChangesAfterUncheck = status.filter(
      (change) => change.path.startsWith('market-engine/')
    );
    assert.equal(folderChangesAfterUncheck.every((change) => !change.staged), true);
    assert.equal(status.find((change) => change.path === 'outside.txt').staged, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testParentFolderStageIgnoresAlreadyStagedDeletedDescendant() {
  // Приемочный свидетель: уже включённое удаление не мешает включить остальные файлы папки.
  // Контрольный факт вне области изменения: outside.txt остаётся неподготовленным.
  const tempRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      'phpstorm-git-panel-folder-staged-delete-'
    )
  );
  ensureSafeTempRoot(tempRoot);
  const deletedPath = 'data-receiving/Contexts/MarketData/Infrastructure/Exchanges/Binance/Shared/FundingTickerMessage.cs';
  const changedPath = 'data-receiving/Contexts/MarketData/Infrastructure/Exchanges/Binance/Shared/FundingTickerHandler.cs';
  const outsidePath = 'outside.txt';

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);
    fs.mkdirSync(path.dirname(path.join(tempRoot, deletedPath)), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, deletedPath), 'old handler\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, changedPath), 'old replacement\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, outsidePath), 'outside\n', 'utf8');
    await execGit(tempRoot, ['add', '.']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    fs.rmSync(path.join(tempRoot, deletedPath));
    fs.writeFileSync(path.join(tempRoot, changedPath), 'new replacement\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, outsidePath), 'outside changed\n', 'utf8');
    await stagePaths(tempRoot, [deletedPath]);

    let status = await getStatus(tempRoot);
    assert.equal(status.find((change) => change.path === deletedPath).xy, 'D ');
    assert.equal(status.find((change) => change.path === changedPath).staged, false);

    await stagePaths(tempRoot, [deletedPath, changedPath]);

    status = await getStatus(tempRoot);
    assert.equal(status.find((change) => change.path === deletedPath).staged, true);
    assert.equal(status.find((change) => change.path === changedPath).staged, true);
    assert.equal(status.find((change) => change.path === outsidePath).staged, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testStalePathspecsDoNotBlockCurrentStaging() {
  // Приемочный свидетель: устаревший путь не блокирует актуальный путь в том же запросе.
  // Контрольный факт вне области изменения: outside.txt не меняет своё состояние индекса.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-stale-pathspec-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);
    fs.mkdirSync(
      path.join(tempRoot, 'data-receiving', 'Contexts', 'MarketData', 'Application'),
      { recursive: true }
    );
    fs.writeFileSync(
      path.join(
        tempRoot,
        'data-receiving',
        'Contexts',
        'MarketData',
        'Application',
        'CurrentInstrument.cs'
      ),
      'initial\n',
      'utf8'
    );
    fs.writeFileSync(path.join(tempRoot, 'outside.txt'), 'initial\n', 'utf8');
    await execGit(tempRoot, ['add', '.']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    fs.writeFileSync(
      path.join(
        tempRoot,
        'data-receiving',
        'Contexts',
        'MarketData',
        'Application',
        'CurrentInstrument.cs'
      ),
      'changed\n',
      'utf8'
    );
    fs.writeFileSync(path.join(tempRoot, 'outside.txt'), 'changed\n', 'utf8');

    const currentPath = 'data-receiving/Contexts/MarketData/Application/CurrentInstrument.cs';
    const stalePath = 'data-receiving/Contexts/MarketData/Application/TradingInstrument.cs';
    await stagePaths(tempRoot, [stalePath, currentPath]);

    let status = await getStatus(tempRoot);
    assert.equal(status.find((change) => change.path === currentPath).staged, true);
    assert.equal(status.find((change) => change.path === 'outside.txt').staged, false);

    await execGit(tempRoot, ['add', 'outside.txt']);
    await unstagePaths(tempRoot, [stalePath, currentPath]);

    status = await getStatus(tempRoot);
    assert.equal(status.find((change) => change.path === currentPath).staged, false);
    assert.equal(status.find((change) => change.path === 'outside.txt').staged, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testNoLastCommitPlaceholder() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'phpstorm-git-panel-empty-history-test-')
  );
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);

    const lastCommit = await getLastCommitSummary(tempRoot);
    assert.equal(lastCommit, '');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testGitStagingRoundTrip() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'phpstorm-git-panel-test-')
  );
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await configureTestRepository(tempRoot);

    fs.writeFileSync(path.join(tempRoot, 'tracked.txt'), 'one\n', 'utf8');
    await execGit(tempRoot, ['add', 'tracked.txt']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    fs.writeFileSync(path.join(tempRoot, 'tracked.txt'), 'two\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'new.txt'), 'new\n', 'utf8');

    let status = await getStatus(tempRoot);
    assert.equal(status.find((change) => change.path === 'tracked.txt').staged, false);
    assert.equal(status.find((change) => change.path === 'new.txt').staged, false);

    await stagePaths(tempRoot, ['tracked.txt']);
    status = await getStatus(tempRoot);
    assert.equal(status.find((change) => change.path === 'tracked.txt').staged, true);
    assert.equal(status.find((change) => change.path === 'new.txt').staged, false);

    await unstagePaths(tempRoot, ['tracked.txt']);
    status = await getStatus(tempRoot);
    assert.equal(status.find((change) => change.path === 'tracked.txt').staged, false);

    await stageAll(tempRoot);
    status = await getStatus(tempRoot);
    assert.equal(status.every((change) => change.staged), true);

    const diff = await getStagedDiff(tempRoot);
    assert.match(diff, /tracked\.txt/);
    assert.match(diff, /new\.txt/);

    await unstageAll(tempRoot);
    status = await getStatus(tempRoot);
    assert.equal(status.every((change) => !change.staged), true);

    await stageAll(tempRoot);
    await commit(tempRoot, 'update tracked and add file');
    status = await getStatus(tempRoot);
    assert.equal(status.length, 0);

    const lastCommit = await getLastCommitSummary(tempRoot);
    assert.match(lastCommit, /update tracked and add file/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function ensureSafeTempRoot(tempRoot) {
  const resolved = path.resolve(tempRoot);
  const resolvedOsTemp = path.resolve(os.tmpdir());

  if (!resolved.startsWith(resolvedOsTemp + path.sep)) {
    throw new Error(`Refusing to remove unsafe temp path: ${resolved}`);
  }
}

run().catch(
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);
