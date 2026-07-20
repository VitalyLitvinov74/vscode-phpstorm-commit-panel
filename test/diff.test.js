'use strict';

const assert = require('assert');
const {
  buildHunkPatch,
  createUntrackedFileDiff,
  parseFileDiff
} = require('../src/diff');

function run() {
  testParsesLineNumbersAndMultipleHunks();
  testBuildsOneSafeHunkPatch();
  testCreatesReadableUntrackedPreview();
  testHandlesEmptyAndBinaryDiffs();
}

function testParsesLineNumbersAndMultipleHunks() {
  const patch = [
    'diff --git a/example.txt b/example.txt',
    'index 1111111..2222222 100644',
    '--- a/example.txt',
    '+++ b/example.txt',
    '@@ -1,3 +1,3 @@',
    ' one',
    '-old two',
    '+new two',
    ' three',
    '@@ -8,2 +8,3 @@',
    ' eight',
    '+nine',
    ' ten',
    ''
  ].join('\n');

  const parsed = parseFileDiff(patch, { path: 'example.txt', source: 'unstaged' });

  assert.equal(parsed.hunks.length, 2);
  assert.equal(parsed.hunks[0].source, 'unstaged');
  assert.equal(parsed.hunks[0].included, false);
  assert.deepEqual(
    parsed.hunks[0].lines.map((line) => [line.type, line.oldLine, line.newLine, line.text]),
    [
      ['context', 1, 1, 'one'],
      ['delete', 2, null, 'old two'],
      ['add', null, 2, 'new two'],
      ['context', 3, 3, 'three']
    ]
  );
  assert.notEqual(parsed.hunks[0].id, parsed.hunks[1].id);
}

function testBuildsOneSafeHunkPatch() {
  const patch = [
    'diff --git a/example.txt b/example.txt',
    'index 1111111..2222222 100644',
    '--- a/example.txt',
    '+++ b/example.txt',
    '@@ -1 +1 @@',
    '-one',
    '+ONE',
    '@@ -5 +5 @@',
    '-five',
    '+FIVE',
    ''
  ].join('\n');
  const parsed = parseFileDiff(patch, { path: 'example.txt', source: 'staged' });
  const selected = buildHunkPatch(parsed, parsed.hunks[1].id);

  assert.match(selected, /^diff --git a\/example\.txt b\/example\.txt/m);
  assert.match(selected, /@@ -5 \+5 @@/);
  assert.doesNotMatch(selected, /@@ -1 \+1 @@/);
  assert.ok(selected.endsWith('\n'));
}

function testCreatesReadableUntrackedPreview() {
  const parsed = createUntrackedFileDiff('new.txt', 'alpha\nbeta\n');

  assert.equal(parsed.path, 'new.txt');
  assert.equal(parsed.hunks.length, 1);
  assert.equal(parsed.hunks[0].canToggle, false);
  assert.deepEqual(parsed.hunks[0].lines.map((line) => line.type), ['add', 'add']);
  assert.deepEqual(parsed.hunks[0].lines.map((line) => line.newLine), [1, 2]);
}

function testHandlesEmptyAndBinaryDiffs() {
  assert.equal(parseFileDiff('', { path: 'empty.txt' }).hunks.length, 0);

  const binary = parseFileDiff([
    'diff --git a/image.png b/image.png',
    'index 1111111..2222222 100644',
    'Binary files a/image.png and b/image.png differ',
    ''
  ].join('\n'), { path: 'image.png' });

  assert.equal(binary.binary, true);
  assert.equal(binary.hunks.length, 0);
}

run();
