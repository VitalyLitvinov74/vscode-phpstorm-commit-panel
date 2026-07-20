'use strict';

const assert = require('assert');
const { StagingBatch } = require('../src/stagingBatch');

function run() {
  testLastCheckboxStateWinsInsideOneFlush();
  testIndependentRootsStaySeparated();
  testRequestIdsSurviveCoalescing();
}

function testLastCheckboxStateWinsInsideOneFlush() {
  const batch = new StagingBatch();
  const root = '/repo';
  const parentPaths = [
    'data-receiving/first.cs',
    'data-receiving/second.cs',
    'data-receiving/nested/third.cs'
  ];

  batch.add(root, parentPaths, true);
  batch.add(root, ['data-receiving/second.cs'], false);

  assert.deepEqual(
    batch.take(),
    [
      {
        root,
        stagePaths: [
          'data-receiving/first.cs',
          'data-receiving/nested/third.cs'
        ],
        unstagePaths: [
          'data-receiving/second.cs'
        ],
        requestIds: []
      }
    ]
  );
}

function testIndependentRootsStaySeparated() {
  const batch = new StagingBatch();

  batch.add('/repo-a', ['a.txt'], true);
  batch.add('/repo-b', ['b.txt'], false);
  batch.add('/repo-a', ['a.txt'], false);

  assert.deepEqual(
    batch.take(),
    [
      {
        root: '/repo-a',
        stagePaths: [],
        unstagePaths: ['a.txt'],
        requestIds: []
      },
      {
        root: '/repo-b',
        stagePaths: [],
        unstagePaths: ['b.txt'],
        requestIds: []
      }
    ]
  );
  assert.equal(batch.hasPending(), false);
}

function testRequestIdsSurviveCoalescing() {
  const batch = new StagingBatch();

  batch.add('/repo', ['parent/a.cs', 'parent/b.cs'], true, 'panel-1');
  batch.add('/repo', ['parent/a.cs', 'parent/b.cs'], false, 'panel-2');

  assert.deepEqual(
    batch.take(),
    [
      {
        root: '/repo',
        stagePaths: [],
        unstagePaths: ['parent/a.cs', 'parent/b.cs'],
        requestIds: ['panel-1', 'panel-2']
      }
    ],
    'coalescing must keep every request id while the last desired checkbox state wins'
  );
}

run();
