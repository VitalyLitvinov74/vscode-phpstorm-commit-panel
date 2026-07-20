'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { renderWebview } = require('../src/webview');

function run() {
  const html = renderWebview({ cspSource: 'vscode-resource:' });
  const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  assert.match(
    html,
    /grid-template-columns:\s*14px 16px minmax\(0, 1fr\) 24px/,
    'changes tree rows must stay compact and single-line'
  );
  assert.match(
    html,
    /function setLocalChecked\(paths, checked\)/,
    'checkboxes must update the webview state optimistically'
  );
  assert.match(
    html,
    /const layoutVersion = 3;/,
    'layout version must reset old persisted pane widths'
  );
  assert.match(
    html,
    /--checkbox-checked-bg:/,
    'checkboxes must use a subdued theme-aware checkbox palette'
  );
  assert.match(
    html,
    /appearance:\s*none;/,
    'checkboxes must use the custom subdued checkbox style instead of the bright native accent'
  );
  assert.ok(!html.includes('accent-color: var(--blue);'), 'checkboxes must not use bright button blue');
  assert.ok(!html.includes('file-meta'), 'old wide file metadata column must not return');
  assert.ok(!html.includes('folder-icon'), 'old extra folder icon column must not return');

  assert.ok(
    extensionSource.includes('applyOptimisticStaging(paths, checked);'),
    'extension host must optimistically update staged state'
  );
  assert.ok(
    extensionSource.includes('enqueueStagingOperation(this.state.selectedRoot, paths, checked);'),
    'checkbox staging must run through the non-blocking staging queue'
  );
  assert.ok(
    !extensionSource.includes("enqueueOperation('Updating Git index...'"),
    'checkbox staging must not use the blocking busy operation path'
  );
  assert.doesNotMatch(
    extensionSource,
    /vscode\.window\.show(?:Error|Warning|Information)Message/,
    'extension must not use VS Code notification popups because they can play notification sounds'
  );
  assert.deepEqual(
    manifest.extensionKind,
    ['workspace'],
    'Git panel must run in the workspace/remote extension host so WSL repositories use WSL git'
  );
}

run();
