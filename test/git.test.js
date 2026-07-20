'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  commit,
  execGit,
  getLastCommitSummary,
  getStatus,
  getStagedDiff,
  parsePorcelainStatus,
  stageAll,
  stagePaths,
  unstageAll,
  unstagePaths
} = require('../src/git');

async function run() {
  testParser();
  await testGitStagingRoundTrip();
}

function testParser() {
  const changes = parsePorcelainStatus([
    ' M tracked.txt',
    '?? new.txt',
    'A  staged-new.txt',
    'R  renamed-new.txt',
    'renamed-old.txt',
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
