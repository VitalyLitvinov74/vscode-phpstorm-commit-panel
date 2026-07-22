'use strict';

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildHunkPatch, createUntrackedFileDiff, parseFileDiff } = require('./diff');

const MAX_BUFFER = 32 * 1024 * 1024;
const MAX_UNTRACKED_PREVIEW_BYTES = 2 * 1024 * 1024;
const UNTRACKED_READ_CHUNK_BYTES = 64 * 1024;
const MAX_PATHSPEC_ARGUMENT_UNITS = process.platform === 'win32' ? 23_000 : 95_000;
const DEFAULT_GIT_TIMEOUT_MS = 60_000;
const READ_GIT_TIMEOUT_MS = 15_000;
const STRUCTURAL_DIFF_HEADER = new RegExp(
  '^(?:old mode|new mode|deleted file mode|new file mode|' +
    'similarity index|dissimilarity index|rename from|rename to|copy from|copy to)\\b'
);

function execGit(root, args, options = {}) {
  if (options.stdin !== undefined) {
    return execGitWithStdin(root, args, options);
  }

  return new Promise(
    (resolve, reject) => {
      execFile(
        'git',
        args,
        {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: MAX_BUFFER,
          timeout: DEFAULT_GIT_TIMEOUT_MS,
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
    }
  );
}

function execGitWithStdin(root, args, options = {}) {
  return new Promise(
    (resolve, reject) => {
      const { stdin, ...processOptions } = options;
      const child = spawn(
        'git',
        args,
        {
          cwd: root,
          timeout: DEFAULT_GIT_TIMEOUT_MS,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          ...processOptions
        }
      );
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

      child.stdout.on(
        'data',
        (chunk) => {
          outputSize += chunk.length;
          stdout.push(chunk);

          if (outputSize > MAX_BUFFER) {
            child.kill();
            rejectOnce(new Error('Git output exceeded the supported preview size.'));
          }
        }
      );
      child.stderr.on(
        'data',
        (chunk) => {
          outputSize += chunk.length;
          stderr.push(chunk);

          if (outputSize > MAX_BUFFER) {
            child.kill();
            rejectOnce(new Error('Git output exceeded the supported preview size.'));
          }
        }
      );
      child.on('error', rejectOnce);
      child.on(
        'close',
        (code, closeSignal) => {
          if (settled) {
            return;
          }

          const stdoutText = Buffer.concat(stdout).toString('utf8');
          const stderrText = Buffer.concat(stderr).toString('utf8');

          if (code !== 0) {
            const error = new Error(stderrText.trim() || `Git exited with code ${code}.`);
            error.code = code;
            error.killed = Boolean(closeSignal);
            error.signal = closeSignal;
            error.stdout = stdoutText;
            error.stderr = stderrText;
            rejectOnce(error);
            return;
          }

          settled = true;
          resolve(stdoutText);
        }
      );
      child.stdin.on('error', rejectOnce);
      child.stdin.end(String(stdin));
    }
  );
}

function normalizeGitPath(value) {
  return process.platform === 'win32' ? value.replace(/\\/g, '/') : value;
}

function uniquePaths(paths) {
  return [...new Set(paths.map(normalizeGitPath))].filter(Boolean);
}

function literalPathspecArgs(args) {
  return ['--literal-pathspecs', ...args];
}

function chunkPathspecs(paths) {
  const chunks = [];
  let chunk = [];
  let argumentUnits = 0;

  for (const relativePath of paths) {
    const nextArgumentUnits = pathspecArgumentUnits(relativePath);

    if (chunk.length > 0
      && argumentUnits + nextArgumentUnits > MAX_PATHSPEC_ARGUMENT_UNITS) {
      chunks.push(chunk);
      chunk = [];
      argumentUnits = 0;
    }

    chunk.push(relativePath);
    argumentUnits += nextArgumentUnits;
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
  }

  return chunks;
}

function pathspecArgumentUnits(relativePath) {
  if (process.platform === 'win32') {
    // Reserve quoting overhead and count UTF-16 command-line code units.
    return relativePath.length + 3;
  }

  return Buffer.byteLength(relativePath, 'utf8') + 1;
}

function changePathspecs(change) {
  const renameOriginalPath = isRenameChange(change) ? change?.originalPath : undefined;
  return uniquePaths([change?.path, renameOriginalPath].filter(Boolean));
}

function isRenameChange(change) {
  return change?.kind === 'renamed'
    || change?.indexStatus === 'R'
    || change?.worktreeStatus === 'R';
}

function isCopyChange(change) {
  return change?.kind === 'copied'
    || change?.indexStatus === 'C'
    || change?.worktreeStatus === 'C';
}

function readGitOptions(options = {}) {
  return {
    timeout: options.timeout ?? READ_GIT_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {})
  };
}

function writeGitOptions(options = {}) {
  return {
    timeout: options.timeout ?? DEFAULT_GIT_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {})
  };
}

async function resolveCurrentChangePathspecs(root, paths, options = {}) {
  const requestedPaths = uniquePaths(paths);

  if (requestedPaths.length === 0) {
    return [];
  }

  const requested = new Set(requestedPaths);
  const currentChanges = options.currentChanges || await getStatus(root, options);
  const currentChangePaths = new Set(currentChanges.map((change) => change.path));
  const resolvedPaths = [];

  for (const change of currentChanges) {
    if (options.stagedOnly && !change.staged) {
      continue;
    }

    if (options.unstagedOnly && !change.hasUnstaged) {
      continue;
    }

    const renameOriginalIsOccupied = isRenameChange(change)
      && change.originalPath
      && change.path !== change.originalPath
      && currentChangePaths.has(change.originalPath);
    const currentPathRequested = requested.has(change.path);
    const originalPathRequested = isRenameChange(change)
      && !renameOriginalIsOccupied
      && requested.has(change.originalPath);

    if (currentPathRequested || originalPathRequested) {
      resolvedPaths.push(change.path);

      if (change.originalPath
        && isRenameChange(change)
        && (!renameOriginalIsOccupied
          || options.includeOccupiedRenameOriginal
          || requested.has(change.originalPath))) {
        resolvedPaths.push(change.originalPath);
      }
    }
  }

  return uniquePaths(resolvedPaths);
}

async function findRepositoryRoot(folderPath, options = {}) {
  try {
    const output = await execGit(
      folderPath,
      ['rev-parse', '--show-toplevel'],
      readGitOptions(options)
    );
    return path.resolve(output.trim());
  } catch (error) {
    rethrowInterruptedGitError(error);
    return undefined;
  }
}

async function getStatus(root, options = {}) {
  const output = await execGit(
    root,
    [
      '--no-optional-locks',
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all'
    ],
    readGitOptions(options)
  );

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

async function runPathspec(root, argsBeforePathspec, paths, options = {}) {
  const normalizedPaths = uniquePaths(paths);

  if (normalizedPaths.length === 0) {
    return;
  }

  for (const chunk of chunkPathspecs(normalizedPaths)) {
    await execGit(
      root,
      literalPathspecArgs([...argsBeforePathspec, '--', ...chunk]),
      writeGitOptions(options)
    );
  }
}

async function stagePaths(root, paths, options = {}) {
  const currentPaths = await resolveCurrentChangePathspecs(
    root,
    paths,
    { ...options, unstagedOnly: true }
  );
  await runPathspec(root, ['add', '-A'], currentPaths, options);
}

async function unstagePaths(root, paths, options = {}) {
  const currentPaths = await resolveCurrentChangePathspecs(
    root,
    paths,
    {
      ...options,
      stagedOnly: true,
      includeOccupiedRenameOriginal: true
    }
  );
  await unstageResolvedPaths(root, currentPaths, options);
}

async function unstageResolvedPaths(root, currentPaths, options = {}) {
  if (currentPaths.length === 0) {
    return;
  }

  try {
    await runPathspec(root, ['restore', '--staged'], currentPaths, options);
    return;
  } catch (restoreError) {
    rethrowInterruptedGitError(restoreError);

    if (await isUnbornHead(root, options)) {
      await runPathspec(root, ['rm', '--cached', '-r', '-f'], currentPaths, options);
      return;
    }

    await runPathspec(root, ['reset', '-q'], currentPaths, options);
  }
}

async function setPathsStaged(root, pathsToStage, pathsToUnstage, options = {}) {
  const requestedUnstagePaths = new Set(uniquePaths(pathsToUnstage || []));
  const requestedStagePaths = uniquePaths(pathsToStage || [])
    .filter((relativePath) => !requestedUnstagePaths.has(relativePath));

  if (requestedStagePaths.length === 0 && requestedUnstagePaths.size === 0) {
    return;
  }

  const currentChanges = await getStatus(root, options);
  const sharedOptions = { ...options, currentChanges };
  const currentStagePaths = await resolveCurrentChangePathspecs(
    root,
    requestedStagePaths,
    { ...sharedOptions, unstagedOnly: true }
  );
  const currentUnstagePaths = await resolveCurrentChangePathspecs(
    root,
    [...requestedUnstagePaths],
    {
      ...sharedOptions,
      stagedOnly: true,
      includeOccupiedRenameOriginal: true
    }
  );
  const currentUnstageSet = new Set(currentUnstagePaths);

  const filteredStagePaths = currentStagePaths
    .filter((relativePath) => !currentUnstageSet.has(relativePath));

  await runPathspec(
    root,
    ['add', '-A'],
    filteredStagePaths,
    options
  );

  try {
    await unstageResolvedPaths(root, currentUnstagePaths, options);
  } catch (error) {
    if (filteredStagePaths.length > 0) {
      error.message = [
        error.message,
        'Some requested paths may already be staged; refresh status before continuing.'
      ].join(' ');
      error.partialStagingApplied = true;
    }

    throw error;
  }
}

async function stageAll(root, options = {}) {
  await execGit(root, ['add', '-A'], writeGitOptions(options));
}

async function unstageAll(root, options = {}) {
  try {
    await runPathspec(root, ['restore', '--staged'], ['.'], options);
    return;
  } catch (restoreError) {
    rethrowInterruptedGitError(restoreError);

    if (await isUnbornHead(root, options)) {
      await runPathspec(root, ['rm', '--cached', '-r', '-f'], ['.'], options);
      return;
    }

    await execGit(root, ['reset', '-q'], writeGitOptions(options));
  }
}

async function isUnbornHead(root, options = {}) {
  let headReference;

  try {
    const headReferenceOutput = await execGit(
      root,
      ['symbolic-ref', '--quiet', 'HEAD'],
      readGitOptions(options)
    );
    headReference = headReferenceOutput.trim();
  } catch (error) {
    rethrowInterruptedGitError(error);

    if (error?.code === 1) {
      return false;
    }

    throw error;
  }

  if (!headReference) {
    return false;
  }

  try {
    await execGit(
      root,
      ['show-ref', '--verify', '--quiet', headReference],
      readGitOptions(options)
    );
    return false;
  } catch (error) {
    rethrowInterruptedGitError(error);

    if (error?.code === 1) {
      return true;
    }

    throw error;
  }
}

async function rollbackPath(root, change) {
  if (!change?.path) {
    return;
  }

  if (change.untracked || change.kind === 'added' || isCopyChange(change)) {
    throw new Error('Rollback is disabled for new files because it would delete local content.');
  }

  assertRenameOriginalPathIsFree(root, change, 'roll back');

  await runPathspec(
    root,
    ['restore', '--source=HEAD', '--staged', '--worktree'],
    changePathspecs(change)
  );
}

async function shelvePath(root, change) {
  if (!change?.path) {
    return;
  }

  assertRenameOriginalPathIsFree(root, change, 'shelve');
  const selectedPaths = changePathspecs(change);
  const message = `Shelved from PhpStorm Commit Panel: ${normalizeGitPath(change.path)}`;

  // A path-limited stash rolls back only the matched index and worktree entries.
  await execGit(
    root,
    literalPathspecArgs(
      [
        'stash',
        'push',
        '--include-untracked',
        '-m',
        message,
        '--',
        ...selectedPaths
      ]
    ),
    writeGitOptions()
  );
}

function assertRenameOriginalPathIsFree(root, change, action) {
  if (!isRenameChange(change) || !change.originalPath) {
    return;
  }

  const currentPath = path.resolve(root, change.path);
  const originalPath = path.resolve(root, change.originalPath);
  const samePath = process.platform === 'win32'
    ? currentPath.toLowerCase() === originalPath.toLowerCase()
    : currentPath === originalPath;

  if (!samePath && pathEntryExists(originalPath)) {
    throw new Error(
      `Cannot ${action} this rename because the original path now contains another local file.`
    );
  }
}

function pathEntryExists(candidatePath) {
  try {
    fs.lstatSync(candidatePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return false;
    }

    throw error;
  }
}

async function hasStagedChanges(root, options = {}) {
  const changes = await getStatus(root, options);
  return changes.some((change) => change.staged);
}

async function getStagedDiff(root, options = {}) {
  return execGit(
    root,
    ['diff', '--cached', '--no-ext-diff', '--unified=30'],
    readGitOptions(options)
  );
}

async function listIgnoredFiles(root, options = {}) {
  const output = await execGit(
    root,
    [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '-z'
    ],
    readGitOptions(options)
  );

  return output
    .split('\0')
    .filter(Boolean)
    .map(
      (filePath) => ({
        path: normalizeGitPath(filePath),
        kind: 'ignored',
        ignored: true,
        staged: false,
        hasStaged: false,
        hasUnstaged: false,
        partiallyStaged: false
      })
    )
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function getFileDiff(root, change, options = {}) {
  throwIfAborted(options.signal);

  if (!change?.path) {
    return emptyFileDiff('');
  }

  if (change.untracked) {
    return getUntrackedFileDiff(root, change.path, options);
  }

  const contextLines = clampContextLines(options.contextLines);
  const commonArgs = [
    'diff',
    '--no-ext-diff',
    '--no-color',
    `--unified=${contextLines}`,
    ...diffWhitespaceArgs(options.ignorePolicy)
  ];
  const pathspecs = changePathspecs(change);
  const stagedPatchPromise = change.hasStaged || change.staged
    ? execGit(
      root,
      literalPathspecArgs([...commonArgs, '--cached', '--', ...pathspecs]),
      readGitOptions(options)
    )
    : Promise.resolve('');
  const unstagedPatchPromise = change.hasUnstaged || (!change.staged && !change.deletedInView)
    ? execGit(
      root,
      literalPathspecArgs([...commonArgs, '--', ...pathspecs]),
      readGitOptions(options)
    )
    : Promise.resolve('');
  const [stagedPatch, unstagedPatch] = await Promise.all(
    [stagedPatchPromise, unstagedPatchPromise]
  );
  throwIfAborted(options.signal);
  const stagedDiff = parseFileDiff(
    stagedPatch,
    { path: change.path, source: 'staged' }
  );
  const unstagedDiff = parseFileDiff(
    unstagedPatch,
    { path: change.path, source: 'unstaged' }
  );
  const structuralMetadata = hasStructuralDiffMetadata(stagedDiff)
    || hasStructuralDiffMetadata(unstagedDiff);
  const hunks = [...stagedDiff.hunks, ...unstagedDiff.hunks].map(
    (hunk) => toggleSafeHunk(hunk, structuralMetadata)
  );
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
    canToggleHunks: !binary && !change.conflict && !structuralMetadata && hunks.length > 0,
    hunks,
    differenceCount: hunks.length,
    includedCount: hunks.filter((hunk) => hunk.included).length,
    message: binary
      ? 'Binary file preview is not available. You can still include or exclude the whole file.'
      : structuralMetadata
        ? 'Partial inclusion is disabled for file mode, rename, or copy metadata.'
        : hunks.length === 0
          ? 'No textual differences for the selected whitespace policy.'
          : ''
  };
}

function publicHunk(hunk) {
  const { rawLines, ...safeHunk } = hunk;
  return safeHunk;
}

function toggleSafeHunk(hunk, structuralMetadata) {
  return {
    ...publicHunk(hunk),
    canToggle: !structuralMetadata && hunk.canToggle !== false
  };
}

function hasStructuralDiffMetadata(parsedDiff) {
  return (parsedDiff?.headerLines || []).some(
    (line) => STRUCTURAL_DIFF_HEADER.test(line)
  );
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
  const pathspecs = changePathspecs(change);
  const [stagedPatch, unstagedPatch] = await Promise.all(
    [
      execGit(
        root,
        literalPathspecArgs([...commonArgs, '--cached', '--', ...pathspecs]),
        readGitOptions(options)
      ),
      execGit(
        root,
        literalPathspecArgs([...commonArgs, '--', ...pathspecs]),
        readGitOptions(options)
      )
    ]
  );
  throwIfAborted(options.signal);
  const stagedDiff = parseFileDiff(
    stagedPatch,
    { path: change.path, source: 'staged' }
  );
  const unstagedDiff = parseFileDiff(
    unstagedPatch,
    { path: change.path, source: 'unstaged' }
  );
  const parsed = checked ? unstagedDiff : stagedDiff;

  if (stagedDiff.binary || unstagedDiff.binary) {
    throw new Error('Partial inclusion is not available for binary files.');
  }

  if (hasStructuralDiffMetadata(stagedDiff) || hasStructuralDiffMetadata(unstagedDiff)) {
    throw new Error('Partial inclusion is not available for file mode, rename, or copy metadata.');
  }

  const selectedPatch = buildHunkPatch(parsed, String(hunkId || ''));
  const applyArgs = ['apply', '--cached', '--recount', '--whitespace=nowarn'];

  if (!checked) {
    applyArgs.push('--reverse');
  }

  if (contextLines === 0) {
    applyArgs.push('--unidiff-zero');
  }

  applyArgs.push('-');
  await execGit(
    root,
    applyArgs,
    {
      stdin: selectedPatch,
      ...writeGitOptions(options)
    }
  );
}

async function getUntrackedFileDiff(root, relativePath, options = {}) {
  throwIfAborted(options.signal);
  const absolutePath = resolveRepositoryFile(root, relativePath);
  const fileStat = await fs.promises.lstat(absolutePath);
  throwIfAborted(options.signal);

  if (fileStat.isSymbolicLink()) {
    return unavailableUntrackedFileDiff(
      relativePath,
      'Symbolic link preview is not available.'
    );
  }

  if (!fileStat.isFile()) {
    return unavailableUntrackedFileDiff(relativePath, 'Only regular files can be previewed.');
  }

  const realRoot = await fs.promises.realpath(root);
  const realFilePath = await fs.promises.realpath(absolutePath);
  assertPathInsideRoot(realRoot, realFilePath);
  throwIfAborted(options.signal);

  if (fileStat.size > MAX_UNTRACKED_PREVIEW_BYTES) {
    return {
      ...emptyFileDiff(relativePath),
      message: 'This untracked file is too large for inline preview.'
    };
  }

  const noFollowFlag = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
  const fileHandle = await fs.promises.open(
    absolutePath,
    fs.constants.O_RDONLY | noFollowFlag
  );
  let content;

  try {
    const openedStat = await fileHandle.stat();

    if (!openedStat.isFile()) {
      return unavailableUntrackedFileDiff(relativePath, 'Only regular files can be previewed.');
    }

    if (openedStat.dev !== fileStat.dev || openedStat.ino !== fileStat.ino) {
      throw new Error('The selected file changed before it could be previewed safely.');
    }

    const chunks = [];
    let bytesRead = 0;

    while (bytesRead <= MAX_UNTRACKED_PREVIEW_BYTES) {
      throwIfAborted(options.signal);
      const bufferLength = Math.min(
        UNTRACKED_READ_CHUNK_BYTES,
        MAX_UNTRACKED_PREVIEW_BYTES + 1 - bytesRead
      );
      const buffer = Buffer.allocUnsafe(bufferLength);
      const result = await fileHandle.read(
        buffer,
        0,
        buffer.length,
        bytesRead
      );

      if (result.bytesRead === 0) {
        break;
      }

      chunks.push(buffer.subarray(0, result.bytesRead));
      bytesRead += result.bytesRead;
    }

    if (bytesRead > MAX_UNTRACKED_PREVIEW_BYTES) {
      return unavailableUntrackedFileDiff(
        relativePath,
        'This untracked file is too large for inline preview.'
      );
    }

    content = Buffer.concat(chunks, bytesRead);
  } finally {
    await fileHandle.close();
  }

  throwIfAborted(options.signal);

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

function unavailableUntrackedFileDiff(relativePath, message) {
  return {
    ...emptyFileDiff(relativePath),
    kind: 'untracked',
    message
  };
}

function resolveRepositoryFile(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const absolutePath = path.resolve(resolvedRoot, relativePath);

  assertPathInsideRoot(resolvedRoot, absolutePath);
  return absolutePath;
}

function assertPathInsideRoot(root, candidatePath) {
  const relative = path.relative(path.resolve(root), path.resolve(candidatePath));

  if (!relative
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)) {
    throw new Error('The selected file is outside the repository.');
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  throw error;
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

async function getLastCommitSummary(root, options = {}) {
  try {
    const output = await execGit(
      root,
      ['log', '-1', '--pretty=format:%h %s'],
      readGitOptions(options)
    );
    return output.trim();
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    return '';
  }
}

async function getBlame(root, relativePath, options = {}) {
  throwIfAborted(options.signal);

  if (!relativePath) {
    return {};
  }

  try {
    const output = await execGit(
      root,
      literalPathspecArgs(
        [
          'blame',
          '--line-porcelain',
          '--',
          normalizeGitPath(relativePath)
        ]
      ),
      readGitOptions(options)
    );
    const blame = {};
    let currentLine;
    let currentHash = '';
    let currentAuthor = '';

    output.split(/\r?\n/).forEach(
      (line) => {
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
      }
    );

    return blame;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    return {};
  }
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function rethrowInterruptedGitError(error) {
  if (isAbortError(error) || error?.killed || error?.signal) {
    throw error;
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

async function getObjectText(root, ref, relativePath, options = {}) {
  throwIfAborted(options.signal);
  const safePath = normalizeGitPath(relativePath);

  if (!safePath) {
    return '';
  }

  try {
    if (ref === 'INDEX') {
      return await execGit(
        root,
        ['show', `:${safePath}`],
        readGitOptions(options)
      );
    }

    return await execGit(
      root,
      ['show', `${ref}:${safePath}`],
      readGitOptions(options)
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

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
  setPathsStaged,
  setHunkIncluded,
  unstageAll,
  unstagePaths,
  commit
};
