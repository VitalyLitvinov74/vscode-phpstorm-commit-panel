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
    /grid-template-columns:\s*18px 16px 16px minmax\(0, 1fr\) 30px/,
    'changes tree rows must reserve compact columns for disclosure, checkbox, file icon, label, and status'
  );
  assert.match(
    html,
    /className = 'entry-icon folder-icon'/,
    'folder rows must render Explorer-style folder icons'
  );
  assert.match(
    html,
    /className = 'entry-icon file-icon file-icon-' \+ kind/,
    'file rows must render Explorer-style file icons'
  );
  assert.match(
    html,
    /function fileIconKind\(filePath\)/,
    'file icons must be selected from the file path extension'
  );
  assert.match(
    html,
    /function appendDockerIcon\(icon\)/,
    'Dockerfile rows must render a Docker-specific icon instead of a generic document'
  );
  assert.match(
    html,
    /createFileBadge\('C#'\)/,
    'C# rows must render the Explorer-like C# badge icon'
  );
  assert.match(
    html,
    /function appendEnvIcon\(icon\)/,
    'env files must render a settings-style icon instead of a generic document'
  );
  assert.match(
    html,
    /\.folder-icon\s*\{[\s\S]*?color:\s*color-mix\(in srgb, var\(--muted\) 86%, var\(--text\) 14%\);/,
    'folder icons must use the muted Explorer-like outline color'
  );
  assert.match(
    html,
    /\.disclosure-button\.collapsed::before\s*\{[\s\S]*?border-width:\s*4\.5px 0 4\.5px 6px;/,
    'collapsed tree disclosure arrows must be readable CSS triangles'
  );
  assert.match(
    html,
    /\.disclosure-button\.expanded::before\s*\{[\s\S]*?border-width:\s*6px 4\.5px 0 4\.5px;/,
    'expanded tree disclosure arrows must be readable CSS triangles'
  );
  assert.match(
    html,
    /<button id="expand-all"[\s\S]*?<svg viewBox="0 0 16 16"/,
    'toolbar expand all control must use an aligned SVG icon'
  );
  assert.match(
    html,
    /<button id="collapse-all"[\s\S]*?<svg viewBox="0 0 16 16"/,
    'toolbar collapse all control must use an aligned SVG icon'
  );
  assert.match(
    html,
    /id="view-mode-toggle"[\s\S]*?<svg viewBox="0 0 16 16"/,
    'changes toolbar eye button must be the visible view-mode toggle'
  );
  assert.match(
    html,
    /function toggleViewMode\(\)/,
    'eye button must toggle directory and flat list view modes'
  );
  assert.match(
    html,
    /let viewMode = persisted\.viewMode === 'flat' \? 'flat' : 'directory';/,
    'view mode must persist across webview reloads'
  );
  assert.match(
    html,
    /id="group-flat"/,
    'view menu must include a flat list option'
  );
  assert.match(
    html,
    /showDirectory: true/,
    'flat list mode must show each file directory beside the file name'
  );
  assert.ok(
    !html.includes('\\\\u25BE') && !html.includes('\\\\u25B8') && !html.includes('&#x25BE;'),
    'changes tree must not render disclosure arrows as font-dependent unicode glyphs'
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
  assert.match(
    html,
    /id="group-menu"/,
    'changes toolbar must expose a PhpStorm-style group/show menu trigger'
  );
  assert.match(
    html,
    /<div class="menu-section-title">Group By<\/div>/,
    'changes toolbar menu must include a Group By section'
  );
  assert.match(
    html,
    /<span>Directory<\/span>/,
    'changes toolbar menu must show Directory grouping'
  );
  assert.match(
    html,
    /<div class="menu-section-title">Show<\/div>/,
    'changes toolbar menu must include a Show section'
  );
  assert.match(
    html,
    /function expandAllFolders\(\)/,
    'changes toolbar must include a real expand all tree action'
  );
  assert.match(
    html,
    /function collapseAllFolders\(\)/,
    'changes toolbar must include a real collapse all tree action'
  );
  assert.ok(!html.includes('accent-color: var(--blue);'), 'checkboxes must not use bright button blue');
  assert.ok(!html.includes("return '?';"), 'untracked files must not be shown as unclear question marks');
  assert.match(
    html,
    /return 'new';/,
    'untracked files must use an explicit short status label'
  );
  assert.match(
    html,
    /return 'Untracked file';/,
    'untracked files must have an explicit tooltip description'
  );
  assert.ok(!html.includes('file-meta'), 'old wide file metadata column must not return');

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
