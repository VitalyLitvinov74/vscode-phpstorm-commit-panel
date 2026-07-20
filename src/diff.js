'use strict';

const crypto = require('crypto');

function parseFileDiff(patch, options = {}) {
  const normalizedPatch = normalizePatch(patch);
  const source = options.source === 'staged' ? 'staged' : 'unstaged';
  const filePath = String(options.path || '');
  const headerLines = [];
  const hunks = [];
  let currentHunk;
  let binary = false;

  normalizedPatch.split('\n').forEach((rawLine) => {
    const range = parseHunkHeader(rawLine);

    if (range) {
      if (currentHunk) {
        hunks.push(finalizeHunk(currentHunk, filePath, source));
      }

      currentHunk = {
        header: rawLine,
        oldStart: range.oldStart,
        oldCount: range.oldCount,
        newStart: range.newStart,
        newCount: range.newCount,
        oldCursor: range.oldStart,
        newCursor: range.newStart,
        rawLines: [rawLine],
        lines: []
      };
      return;
    }

    if (!currentHunk) {
      if (/^(?:Binary files .* differ|GIT binary patch)$/.test(rawLine)) {
        binary = true;
      }

      if (rawLine) {
        headerLines.push(rawLine);
      }
      return;
    }

    if (!rawLine) {
      return;
    }

    currentHunk.rawLines.push(rawLine);

    if (rawLine === '\\ No newline at end of file') {
      currentHunk.lines.push({
        type: 'meta',
        oldLine: null,
        newLine: null,
        text: rawLine
      });
      return;
    }

    const prefix = rawLine[0];
    const text = rawLine.slice(1);

    if (prefix === '+') {
      currentHunk.lines.push({
        type: 'add',
        oldLine: null,
        newLine: currentHunk.newCursor,
        text
      });
      currentHunk.newCursor += 1;
      return;
    }

    if (prefix === '-') {
      currentHunk.lines.push({
        type: 'delete',
        oldLine: currentHunk.oldCursor,
        newLine: null,
        text
      });
      currentHunk.oldCursor += 1;
      return;
    }

    if (prefix === ' ') {
      currentHunk.lines.push({
        type: 'context',
        oldLine: currentHunk.oldCursor,
        newLine: currentHunk.newCursor,
        text
      });
      currentHunk.oldCursor += 1;
      currentHunk.newCursor += 1;
    }
  });

  if (currentHunk) {
    hunks.push(finalizeHunk(currentHunk, filePath, source));
  }

  return {
    path: filePath,
    source,
    headerLines,
    binary,
    hunks,
    differenceCount: hunks.length,
    includedCount: hunks.filter((hunk) => hunk.included).length
  };
}

function parseHunkHeader(line) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);

  if (!match) {
    return undefined;
  }

  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4])
  };
}

function finalizeHunk(hunk, filePath, source) {
  const rawPatch = hunk.rawLines.join('\n');
  const id = crypto
    .createHash('sha256')
    .update([source, filePath, rawPatch].join('\0'))
    .digest('hex')
    .slice(0, 24);

  return {
    id,
    source,
    included: source === 'staged',
    canToggle: true,
    header: hunk.header,
    oldStart: hunk.oldStart,
    oldCount: hunk.oldCount,
    newStart: hunk.newStart,
    newCount: hunk.newCount,
    lines: hunk.lines,
    rawLines: hunk.rawLines
  };
}

function buildHunkPatch(parsedDiff, hunkId) {
  const hunk = parsedDiff?.hunks?.find((candidate) => candidate.id === hunkId);

  if (!hunk || hunk.canToggle === false || parsedDiff.binary) {
    throw new Error('The selected diff fragment is no longer available. Refresh the preview and try again.');
  }

  const lines = [
    ...(parsedDiff.headerLines || []),
    ...(hunk.rawLines || [])
  ];

  return lines.join('\n').replace(/\n*$/, '\n');
}

function createUntrackedFileDiff(filePath, content) {
  const normalized = String(content || '').replace(/\r\n/g, '\n');
  const contentLines = normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n')
    : normalized.split('\n');
  const lines = contentLines.length === 1 && contentLines[0] === '' ? [] : contentLines;
  const rawLines = [
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`)
  ];
  const id = crypto
    .createHash('sha256')
    .update(['untracked', filePath, normalized].join('\0'))
    .digest('hex')
    .slice(0, 24);
  const hunk = {
    id,
    source: 'unstaged',
    included: false,
    canToggle: false,
    header: rawLines[0],
    oldStart: 0,
    oldCount: 0,
    newStart: 1,
    newCount: lines.length,
    lines: lines.map((line, index) => ({
      type: 'add',
      oldLine: null,
      newLine: index + 1,
      text: line
    })),
    rawLines
  };

  return {
    path: String(filePath || ''),
    source: 'unstaged',
    headerLines: [
      `diff --git a/${filePath} b/${filePath}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${filePath}`
    ],
    binary: false,
    hunks: lines.length > 0 ? [hunk] : [],
    differenceCount: lines.length > 0 ? 1 : 0,
    includedCount: 0
  };
}

function normalizePatch(patch) {
  return String(patch || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

module.exports = {
  buildHunkPatch,
  createUntrackedFileDiff,
  parseFileDiff
};
