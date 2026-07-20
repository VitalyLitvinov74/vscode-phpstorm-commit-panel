'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  commit,
  execGit,
  getLastCommitSummary,
  getFileDiff,
  getStatus,
  getStagedDiff,
  listIgnoredFiles,
  parsePorcelainStatus,
  rollbackPath,
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
  await testPartiallySelectedFolderStagesEveryDescendantOnly();
  await testParentFolderStageIgnoresAlreadyStagedDeletedDescendant();
}

function testParser() {
  const changes = parsePorcelainStatus([
    ' M tracked.txt',
    '?? new.txt',
    'A  staged-new.txt',
    'R  renamed-new.txt',
    'renamed-old.txt',
    'MM partly.txt',
    ''
  ].join('\0'));

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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-hunks-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await execGit(tempRoot, ['config', 'user.email', 'test@example.invalid']);
    await execGit(tempRoot, ['config', 'user.name', 'Test User']);
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
    let preview = await getFileDiff(tempRoot, change, { contextLines: 1 });
    const unstagedHunks = preview.hunks.filter((hunk) => !hunk.included);
    assert.equal(unstagedHunks.length, 2);
    assert.equal(Object.hasOwn(unstagedHunks[0], 'rawLines'), false);
    await assert.rejects(
      () => setHunkIncluded(tempRoot, change, 'stale-hunk-id', true, { contextLines: 1 }),
      /no longer available/i
    );

    await setHunkIncluded(tempRoot, change, unstagedHunks[0].id, true, { contextLines: 1 });
    change = (await getStatus(tempRoot)).find((candidate) => candidate.path === 'partial.txt');
    assert.equal(change.partiallyStaged, true);

    preview = await getFileDiff(tempRoot, change, { contextLines: 1 });
    assert.equal(preview.hunks.filter((hunk) => hunk.included).length, 1);
    assert.equal(preview.hunks.filter((hunk) => !hunk.included).length, 1);

    const includedHunk = preview.hunks.find((hunk) => hunk.included);
    await setHunkIncluded(tempRoot, change, includedHunk.id, false, { contextLines: 1 });
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-path-actions-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await execGit(tempRoot, ['config', 'user.email', 'test@example.invalid']);
    await execGit(tempRoot, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(tempRoot, 'first.txt'), 'first\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'second.txt'), 'second\n', 'utf8');
    await execGit(tempRoot, ['add', '.']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    fs.writeFileSync(path.join(tempRoot, 'first.txt'), 'changed first\n', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'second.txt'), 'changed second\n', 'utf8');
    await execGit(tempRoot, ['add', 'second.txt']);
    let changes = await getStatus(tempRoot);

    await shelvePath(tempRoot, changes.find((change) => change.path === 'first.txt'));
    changes = await getStatus(tempRoot);
    assert.equal(changes.some((change) => change.path === 'first.txt'), false);
    assert.equal(changes.some((change) => change.path === 'second.txt'), true);
    assert.equal(changes.find((change) => change.path === 'second.txt').staged, true);
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

async function testPartiallySelectedFolderStagesEveryDescendantOnly() {
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
    await execGit(tempRoot, ['config', 'user.email', 'test@example.invalid']);
    await execGit(tempRoot, ['config', 'user.name', 'Test User']);
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-folder-staged-delete-'));
  ensureSafeTempRoot(tempRoot);
  const deletedPath = 'data-receiving/Contexts/MarketData/Infrastructure/Exchanges/Binance/Shared/FundingTickerMessage.cs';
  const changedPath = 'data-receiving/Contexts/MarketData/Infrastructure/Exchanges/Binance/Shared/FundingTickerHandler.cs';
  const outsidePath = 'outside.txt';

  try {
    await execGit(tempRoot, ['init']);
    await execGit(tempRoot, ['config', 'user.email', 'test@example.invalid']);
    await execGit(tempRoot, ['config', 'user.name', 'Test User']);
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phpstorm-git-panel-stale-pathspec-'));
  ensureSafeTempRoot(tempRoot);

  try {
    await execGit(tempRoot, ['init']);
    await execGit(tempRoot, ['config', 'user.email', 'test@example.invalid']);
    await execGit(tempRoot, ['config', 'user.name', 'Test User']);
    fs.mkdirSync(
      path.join(tempRoot, 'data-receiving', 'Contexts', 'MarketData', 'Application'),
      { recursive: true }
    );
    fs.writeFileSync(
      path.join(tempRoot, 'data-receiving', 'Contexts', 'MarketData', 'Application', 'CurrentInstrument.cs'),
      'initial\n',
      'utf8'
    );
    fs.writeFileSync(path.join(tempRoot, 'outside.txt'), 'initial\n', 'utf8');
    await execGit(tempRoot, ['add', '.']);
    await execGit(tempRoot, ['commit', '-m', 'initial']);

    fs.writeFileSync(
      path.join(tempRoot, 'data-receiving', 'Contexts', 'MarketData', 'Application', 'CurrentInstrument.cs'),
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
  const tempRoot = path.join(os.tmpdir(), 'phpstorm-git-panel-empty-history-test');
  ensureSafeTempRoot(tempRoot);
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });

  try {
    await execGit(tempRoot, ['init']);

    const lastCommit = await getLastCommitSummary(tempRoot);
    assert.equal(lastCommit, '');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testGitStagingRoundTrip() {
  const tempRoot = path.join(os.tmpdir(), 'phpstorm-git-panel-test');
  ensureSafeTempRoot(tempRoot);
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });

  await execGit(tempRoot, ['init']);
  await execGit(tempRoot, ['config', 'user.email', 'test@example.invalid']);
  await execGit(tempRoot, ['config', 'user.name', 'Test User']);

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

  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function ensureSafeTempRoot(tempRoot) {
  const resolved = path.resolve(tempRoot);
  const resolvedOsTemp = path.resolve(os.tmpdir());

  if (!resolved.startsWith(resolvedOsTemp + path.sep)) {
    throw new Error(`Refusing to remove unsafe temp path: ${resolved}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
