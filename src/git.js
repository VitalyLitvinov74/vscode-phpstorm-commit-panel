'use strict';

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildHunkPatch, createUntrackedFileDiff, parseFileDiff } = require('./diff');

const MAX_BUFFER = 32 * 1024 * 1024;
const PATH_CHUNK_SIZE = 200;

function execGit(root, args, options = {}) {
  if (options.stdin !== undefined) {
    return execGitWithStdin(root, args, options);
  }

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

function execGitWithStdin(root, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { stdin, ...processOptions } = options;
    const child = spawn('git', args, {
      cwd: root,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...processOptions
    });
    const stdout = [];
    const stderr = [];
    let outputSize = 0;
    let settled = false;

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    child.stdout.on('data', (chunk) => {
      outputSize += chunk.length;
      stdout.push(chunk);

      if (outputSize > MAX_BUFFER) {
        child.kill();
        rejectOnce(new Error('Git output exceeded the supported preview size.'));
      }
    });
    child.stderr.on('data', (chunk) => {
      outputSize += chunk.length;
      stderr.push(chunk);

      if (outputSize > MAX_BUFFER) {
        child.kill();
        rejectOnce(new Error('Git output exceeded the supported preview size.'));
      }
    });
    child.on('error', rejectOnce);
    child.on('close', (code) => {
      if (settled) {
        return;
      }

      const stdoutText = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8');

      if (code !== 0) {
        const error = new Error(stderrText.trim() || `Git exited with code ${code}.`);
        error.code = code;
        error.stdout = stdoutText;
        error.stderr = stderrText;
        rejectOnce(error);
        return;
      }

      settled = true;
      resolve(stdoutText);
    });
    child.stdin.on('error', rejectOnce);
    child.stdin.end(String(stdin));
  });
}

function normalizeGitPath(value) {
  return value.replace(/\\/g, '/');
}

function uniquePaths(paths) {
  return [...new Set(paths.map(normalizeGitPath))].filter(Boolean);
}

async function resolveCurrentChangePathspecs(root, paths, options = {}) {
  const requestedPaths = uniquePaths(paths);

  if (requestedPaths.length === 0) {
    return [];
  }

  const requested = new Set(requestedPaths);
  const currentChanges = await getStatus(root);
  const resolvedPaths = [];

  for (const change of currentChanges) {
    if (options.stagedOnly && !change.staged) {
      continue;
    }

    if (options.unstagedOnly && !change.hasUnstaged) {
      continue;
    }

    if (requested.has(change.path) || (change.originalPath && requested.has(change.originalPath))) {
      resolvedPaths.push(change.path);
    }
  }

  return uniquePaths(resolvedPaths);
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
    const hasUnstaged = worktreeStatus !== ' ' && worktreeStatus !== '!';
    const statusForView = staged ? indexStatus : worktreeStatus;

    changes.push({
      path: filePath,
      originalPath,
      xy,
      indexStatus,
      worktreeStatus,
      staged,
      hasStaged: staged,
      hasUnstaged,
      partiallyStaged: staged && hasUnstaged,
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

async function getStagedPatch(root, paths) {
  const normalizedPaths = uniquePaths(paths);

  if (normalizedPaths.length === 0) {
    return '';
  }

  const patches = [];

  for (let index = 0; index < normalizedPaths.length; index += PATH_CHUNK_SIZE) {
    const chunk = normalizedPaths.slice(index, index + PATH_CHUNK_SIZE);
    patches.push(await execGit(root, ['diff', '--cached', '--binary', '--', ...chunk]));
  }

  return patches.join('\n');
}

async function restoreStagedPatch(root, patch) {
  if (!patch.trim()) {
    return;
  }

  await execGit(root, ['apply', '--cached', '--whitespace=nowarn', '-'], { stdin: patch });
}

async function stagePaths(root, paths) {
  const currentPaths = await resolveCurrentChangePathspecs(root, paths, { unstagedOnly: true });
  await runPathspec(root, ['add', '-A'], currentPaths);
}

async function unstagePaths(root, paths) {
  const currentPaths = await resolveCurrentChangePathspecs(root, paths, { stagedOnly: true });

  try {
    await runPathspec(root, ['restore', '--staged'], currentPaths);
    return;
  } catch (restoreError) {
    try {
      await runPathspec(root, ['reset', '-q'], currentPaths);
      return;
    } catch {
      await runPathspec(root, ['rm', '--cached', '-r'], currentPaths);
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

async function rollbackPath(root, change) {
  if (!change?.path) {
    return;
  }

  if (change.untracked || change.kind === 'added') {
    throw new Error('Rollback is disabled for new files because it would delete local content.');
  }

  const paths = [change.path];

  if (change.originalPath) {
    paths.push(change.originalPath);
  }

  await runPathspec(root, ['restore', '--source=HEAD', '--staged', '--worktree'], paths);
}

async function shelvePath(root, change) {
  if (!change?.path) {
    return;
  }

  const selectedPaths = new Set(uniquePaths([change.path, change.originalPath].filter(Boolean)));
  const stagedNeighbourPaths = (await getStatus(root))
    .filter((currentChange) => {
      if (!currentChange.staged) {
        return false;
      }

      return !selectedPaths.has(currentChange.path)
        && !(currentChange.originalPath && selectedPaths.has(currentChange.originalPath));
    })
    .flatMap((currentChange) => [currentChange.path, currentChange.originalPath].filter(Boolean));
  const stagedNeighbourPatch = await getStagedPatch(root, stagedNeighbourPaths);
  const message = `Shelved from PhpStorm Commit Panel: ${normalizeGitPath(change.path)}`;

  await unstageAll(root);

  try {
    await execGit(root, [
      'stash',
      'push',
      '--include-untracked',
      '-m',
      message,
      '--',
      normalizeGitPath(change.path)
    ]);
  } finally {
    await restoreStagedPatch(root, stagedNeighbourPatch);
  }
}

async function hasStagedChanges(root) {
  const changes = await getStatus(root);
  return changes.some((change) => change.staged);
}

async function getStagedDiff(root) {
  return execGit(root, ['diff', '--cached', '--no-ext-diff', '--unified=30']);
}

async function listIgnoredFiles(root) {
  const output = await execGit(root, [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '-z'
  ]);

  return output
    .split('\0')
    .filter(Boolean)
    .map((filePath) => ({
      path: normalizeGitPath(filePath),
      kind: 'ignored',
      ignored: true,
      staged: false,
      hasStaged: false,
      hasUnstaged: false,
      partiallyStaged: false
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function getFileDiff(root, change, options = {}) {
  if (!change?.path) {
    return emptyFileDiff('');
  }

  if (change.untracked) {
    return getUntrackedFileDiff(root, change.path);
  }

  const contextLines = clampContextLines(options.contextLines);
  const commonArgs = [
    'diff',
    '--no-ext-diff',
    '--no-color',
    `--unified=${contextLines}`,
    ...diffWhitespaceArgs(options.ignorePolicy)
  ];
  const stagedPatch = change.hasStaged || change.staged
    ? await execGit(root, [...commonArgs, '--cached', '--', change.path])
    : '';
  const unstagedPatch = change.hasUnstaged || (!change.staged && !change.deletedInView)
    ? await execGit(root, [...commonArgs, '--', change.path])
    : '';
  const stagedDiff = parseFileDiff(stagedPatch, { path: change.path, source: 'staged' });
  const unstagedDiff = parseFileDiff(unstagedPatch, { path: change.path, source: 'unstaged' });
  const hunks = [...stagedDiff.hunks, ...unstagedDiff.hunks].map(publicHunk);
  const binary = stagedDiff.binary || unstagedDiff.binary;

  return {
    path: change.path,
    originalPath: change.originalPath || '',
    kind: change.kind,
    binary,
    conflict: Boolean(change.conflict),
    fileIncluded: Boolean(change.staged && !change.partiallyStaged),
    filePartiallyIncluded: Boolean(change.partiallyStaged),
    canToggleFile: !change.ignored,
    canToggleHunks: !binary && !change.conflict && hunks.length > 0,
    hunks,
    differenceCount: hunks.length,
    includedCount: hunks.filter((hunk) => hunk.included).length,
    message: binary
      ? 'Binary file preview is not available. You can still include or exclude the whole file.'
      : hunks.length === 0
        ? 'No textual differences for the selected whitespace policy.'
        : ''
  };
}

function publicHunk(hunk) {
  const { rawLines, ...safeHunk } = hunk;
  return safeHunk;
}

async function setHunkIncluded(root, change, hunkId, checked, options = {}) {
  if (!change?.path || change.untracked || change.conflict) {
    throw new Error('Partial inclusion is not available for this file.');
  }

  const contextLines = clampContextLines(options.contextLines);
  const commonArgs = [
    'diff',
    '--no-ext-diff',
    '--no-color',
    `--unified=${contextLines}`,
    ...diffWhitespaceArgs(options.ignorePolicy)
  ];
  const source = checked ? 'unstaged' : 'staged';
  const patch = await execGit(
    root,
    source === 'staged'
      ? [...commonArgs, '--cached', '--', change.path]
      : [...commonArgs, '--', change.path]
  );
  const parsed = parseFileDiff(patch, { path: change.path, source });

  if (parsed.binary) {
    throw new Error('Partial inclusion is not available for binary files.');
  }

  const selectedPatch = buildHunkPatch(parsed, String(hunkId || ''));
  const applyArgs = ['apply', '--cached', '--recount', '--whitespace=nowarn'];

  if (!checked) {
    applyArgs.push('--reverse');
  }

  applyArgs.push('-');
  await execGit(root, applyArgs, { stdin: selectedPatch });
}

async function getUntrackedFileDiff(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  const stat = fs.statSync(absolutePath);

  if (stat.size > 2 * 1024 * 1024) {
    return {
      ...emptyFileDiff(relativePath),
      message: 'This untracked file is too large for inline preview.'
    };
  }

  const content = fs.readFileSync(absolutePath);

  if (content.includes(0)) {
    return {
      ...emptyFileDiff(relativePath),
      binary: true,
      message: 'Binary file preview is not available. You can still include the whole file.'
    };
  }

  const preview = createUntrackedFileDiff(relativePath, content.toString('utf8'));

  return {
    ...preview,
    hunks: preview.hunks.map(publicHunk),
    kind: 'untracked',
    conflict: false,
    fileIncluded: false,
    filePartiallyIncluded: false,
    canToggleFile: true,
    canToggleHunks: false,
    message: preview.hunks.length === 0 ? 'The selected untracked file is empty.' : ''
  };
}

function emptyFileDiff(filePath) {
  return {
    path: String(filePath || ''),
    originalPath: '',
    kind: 'changed',
    binary: false,
    conflict: false,
    fileIncluded: false,
    filePartiallyIncluded: false,
    canToggleFile: false,
    canToggleHunks: false,
    hunks: [],
    differenceCount: 0,
    includedCount: 0,
    message: 'Select a changed file to preview it.'
  };
}

function diffWhitespaceArgs(policy) {
  switch (policy) {
    case 'trim':
      return ['--ignore-space-at-eol'];
    case 'all':
      return ['--ignore-all-space'];
    case 'all-and-empty':
      return ['--ignore-all-space', '--ignore-blank-lines'];
    case 'formatting':
      return [
        '--ignore-all-space',
        '--ignore-blank-lines',
        '--ignore-matching-lines=^[[:space:]]*(use|import|from|require|namespace)[[:space:](]'
      ];
    default:
      return [];
  }
}

function clampContextLines(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 3;
  }

  return Math.min(20, Math.max(0, Math.round(parsed)));
}

async function getLastCommitSummary(root) {
  try {
    const output = await execGit(root, ['log', '-1', '--pretty=format:%h %s']);
    return output.trim();
  } catch {
    return '';
  }
}

async function getBlame(root, relativePath) {
  if (!relativePath || !fileExists(root, relativePath)) {
    return {};
  }

  try {
    const output = await execGit(root, ['blame', '--line-porcelain', '--', normalizeGitPath(relativePath)]);
    const blame = {};
    let currentLine;
    let currentHash = '';
    let currentAuthor = '';

    output.split(/\r?\n/).forEach((line) => {
      const header = /^([0-9a-f^]{40}) \d+ (\d+)/.exec(line);

      if (header) {
        currentHash = header[1].replace(/^\^/, '').slice(0, 8);
        currentLine = Number(header[2]);
        currentAuthor = '';
        return;
      }

      if (line.startsWith('author ')) {
        currentAuthor = line.slice('author '.length);
        return;
      }

      if (line.startsWith('\t') && Number.isFinite(currentLine)) {
        blame[currentLine] = [currentHash || 'working', currentAuthor || 'Not Committed Yet']
          .filter(Boolean)
          .join(' ');
      }
    });

    return blame;
  } catch {
    return {};
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
  getBlame,
  getLastCommitSummary,
  getFileDiff,
  getObjectText,
  getStatus,
  getStagedDiff,
  hasStagedChanges,
  listIgnoredFiles,
  parsePorcelainStatus,
  push,
  rollbackPath,
  shelvePath,
  stageAll,
  stagePaths,
  setHunkIncluded,
  unstageAll,
  unstagePaths,
  commit
};
