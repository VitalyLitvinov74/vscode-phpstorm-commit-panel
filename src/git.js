'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_BUFFER = 32 * 1024 * 1024;
const PATH_CHUNK_SIZE = 200;

function execGit(root, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        ...options
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }

        resolve(stdout);
      }
    );
  });
}

function normalizeGitPath(value) {
  return value.replace(/\\/g, '/');
}

function uniquePaths(paths) {
  return [...new Set(paths.map(normalizeGitPath))].filter(Boolean);
}

async function findRepositoryRoot(folderPath) {
  try {
    const output = await execGit(folderPath, ['rev-parse', '--show-toplevel']);
    return path.resolve(output.trim());
  } catch {
    return undefined;
  }
}

async function getStatus(root) {
  const output = await execGit(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all'
  ]);

  return parsePorcelainStatus(output);
}

function parsePorcelainStatus(output) {
  const records = output.split('\0').filter(Boolean);
  const changes = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (record.length < 4) {
      continue;
    }

    const xy = record.slice(0, 2);
    const filePath = normalizeGitPath(record.slice(3));

    if (xy === '!!') {
      continue;
    }

    let originalPath;
    if (xy.includes('R') || xy.includes('C')) {
      index += 1;
      originalPath = records[index] ? normalizeGitPath(records[index]) : undefined;
    }

    const indexStatus = xy[0];
    const worktreeStatus = xy[1];
    const staged = indexStatus !== ' ' && indexStatus !== '?' && indexStatus !== '!';
    const statusForView = staged ? indexStatus : worktreeStatus;

    changes.push({
      path: filePath,
      originalPath,
      xy,
      indexStatus,
      worktreeStatus,
      staged,
      untracked: xy === '??',
      conflict: isConflictStatus(xy),
      deletedInView: statusForView === 'D',
      kind: statusKind(xy, statusForView)
    });
  }

  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

function isConflictStatus(xy) {
  return xy.includes('U') || xy === 'AA' || xy === 'DD';
}

function statusKind(xy, statusForView) {
  if (xy === '??') {
    return 'untracked';
  }

  if (isConflictStatus(xy)) {
    return 'conflict';
  }

  switch (statusForView) {
    case 'A':
      return 'added';
    case 'C':
      return 'copied';
    case 'D':
      return 'deleted';
    case 'M':
      return 'modified';
    case 'R':
      return 'renamed';
    default:
      return 'changed';
  }
}

async function runPathspec(root, argsBeforePathspec, paths) {
  const normalizedPaths = uniquePaths(paths);

  if (normalizedPaths.length === 0) {
    return;
  }

  for (let index = 0; index < normalizedPaths.length; index += PATH_CHUNK_SIZE) {
    const chunk = normalizedPaths.slice(index, index + PATH_CHUNK_SIZE);
    await execGit(root, [...argsBeforePathspec, '--', ...chunk]);
  }
}

async function stagePaths(root, paths) {
  await runPathspec(root, ['add', '-A'], paths);
}

async function unstagePaths(root, paths) {
  try {
    await runPathspec(root, ['restore', '--staged'], paths);
    return;
  } catch (restoreError) {
    try {
      await runPathspec(root, ['reset', '-q'], paths);
      return;
    } catch {
      await runPathspec(root, ['rm', '--cached', '-r'], paths);
    }
  }
}

async function stageAll(root) {
  await execGit(root, ['add', '-A']);
}

async function unstageAll(root) {
  try {
    await execGit(root, ['restore', '--staged', '.']);
    return;
  } catch {
    try {
      await execGit(root, ['reset', '-q']);
      return;
    } catch {
      await execGit(root, ['rm', '--cached', '-r', '.']);
    }
  }
}

async function hasStagedChanges(root) {
  const changes = await getStatus(root);
  return changes.some((change) => change.staged);
}

async function getStagedDiff(root) {
  return execGit(root, ['diff', '--cached', '--no-ext-diff', '--unified=30']);
}

async function getLastCommitSummary(root) {
  try {
    const output = await execGit(root, ['log', '-1', '--pretty=format:%h %s']);
    return output.trim();
  } catch {
    return '';
  }
}

async function commit(root, message, options = {}) {
  const args = ['commit'];

  if (options.amend) {
    args.push('--amend');
  }

  args.push('-m', message);
  await execGit(root, args);
}

async function push(root) {
  await execGit(root, ['push']);
}

async function getObjectText(root, ref, relativePath) {
  const safePath = normalizeGitPath(relativePath);

  if (!safePath) {
    return '';
  }

  try {
    if (ref === 'INDEX') {
      return await execGit(root, ['show', `:${safePath}`]);
    }

    return await execGit(root, ['show', `${ref}:${safePath}`]);
  } catch {
    return '';
  }
}

function fileExists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

module.exports = {
  execGit,
  fileExists,
  findRepositoryRoot,
  getLastCommitSummary,
  getObjectText,
  getStatus,
  getStagedDiff,
  hasStagedChanges,
  parsePorcelainStatus,
  push,
  stageAll,
  stagePaths,
  unstageAll,
  unstagePaths,
  commit
};
