'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildFileIconTheme, renderWebview } = require('../src/webview');

function run() {
  const html = renderWebview({ cspSource: 'vscode-resource:' });
  const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const webviewSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'webview.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const fixtureIconTheme = buildFileIconTheme(
    {
      asWebviewUri(uri) {
        return {
          toString() {
            return 'webview-resource://' + uri.fsPath.replace(/\\/g, '/');
          }
        };
      }
    },
    {
      extensionUri: {
        fsPath: path.join(__dirname, 'fixtures', 'icon-theme')
      },
      themePath: './themes/test-icon-theme.json'
    }
  );

  assert.match(
    html,
    /grid-template-columns:\s*18px 16px 16px minmax\(0, 1fr\) 30px/,
    'changes tree rows must reserve compact columns for disclosure, checkbox, file icon, label, and status'
  );
  assert.match(
    html,
    /className = 'entry-icon folder-icon'/,
    'folder rows must reserve an Explorer icon slot'
  );
  assert.match(
    html,
    /className = 'entry-icon file-icon'/,
    'file rows must reserve an Explorer icon slot'
  );
  assert.match(
    html,
    /function appendThemeIcon\(container, iconUri, fallbackType\)/,
    'file and folder icons must render from the active VS Code icon theme'
  );
  assert.match(
    html,
    /function resolveFileIcon\(filePath\)/,
    'file icons must be selected through the active icon theme mappings'
  );
  assert.match(
    html,
    /function resolveFolderIcon\(folderName, expanded\)/,
    'folder icons must be selected through the active icon theme mappings'
  );
  assert.match(
    html,
    /className = 'theme-icon-img'/,
    'icons must render as image resources from the current VS Code file icon theme'
  );
  assert.equal(
    fixtureIconTheme.fileExtensions.cs,
    'file_cs',
    'icon theme file extension mappings must be loaded'
  );
  assert.equal(
    fixtureIconTheme.fileNames.dockerfile,
    'file_docker',
    'icon theme file name mappings must be normalized case-insensitively'
  );
  assert.match(
    fixtureIconTheme.definitions.folder,
    /webview-resource:\/\/.*themes\/icons\/folder\/folder\.svg/,
    'folder icon definitions must resolve to webview-safe theme image URIs'
  );
  assert.ok(
    !html.includes('appendDockerIcon') && !html.includes('createFileBadge') && !html.includes('fileIconKind'),
    'custom hand-drawn icon renderers must not return'
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
    /<button id="last-commit" class="last-commit" title="Previous commit" hidden><\/button>/,
    'commit header must not show the old previous-commit placeholder label'
  );
  assert.doesNotMatch(
    html,
    new RegExp('>last' + ' commit', 'i'),
    'commit header must not render the old visible previous-commit placeholder'
  );
  assert.match(
    html,
    /<select id="commit-language" class="language-select"[\s\S]*?<option value="auto">Auto<\/option>[\s\S]*?<option value="en">English<\/option>[\s\S]*?<option value="ru">Русский<\/option>/,
    'Generate control row must include a commit message language selector'
  );
  assert.match(
    html,
    /type: 'setCommitLanguage', language: event\.target\.value/,
    'language selector changes must be sent to the extension host'
  );
  assert.match(
    html,
    /elements\['commit-language'\]\.disabled = Boolean\(state\.busy\);/,
    'language selector must stay available as a setting and only be disabled while the panel is busy'
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
  assert.doesNotMatch(
    html,
    /font-weight:\s*(?:[5-9]00|bold|bolder)/,
    'panel text must not use bold font weights'
  );
  assert.match(
    html,
    /function setLocalChecked\(paths, checked\)/,
    'checkboxes must update the webview state optimistically'
  );
  assert.match(
    html,
    /function captureChangesListScrollTop\(\)/,
    'changes list rerenders must capture the current scroll position'
  );
  assert.match(
    html,
    /function restoreChangesListScrollTop\(scrollTop, selectedRoot\)/,
    'changes list rerenders must restore the captured scroll position'
  );
  assert.match(
    html,
    /window\.requestAnimationFrame\(restore\)/,
    'changes list scroll restoration must survive browser layout updates after rerender'
  );
  assert.match(
    html,
    /render\(\{ changesScrollTop: scrollTop \}\)/,
    'incoming state updates for the same repository must keep the changes list scroll position'
  );
  assert.match(
    html,
    /function renderChangesKeepingScroll\(\)[\s\S]*?scrollTop: captureChangesListScrollTop\(\)/,
    'local changes list rerenders must preserve scrollTop'
  );
  assert.match(
    html,
    /function setLocalChecked\(paths, checked\)[\s\S]*?renderChangesKeepingScroll\(\);/,
    'checkbox staging must not jump the changes list back to the top'
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
    extensionSource.includes('resolveActiveFileIconTheme();'),
    'extension host must use the active VS Code file icon theme'
  );
  assert.ok(
    extensionSource.includes('localResourceRoots.push(fileIconTheme.extensionUri);'),
    'webview must allow image resources from the active icon theme extension'
  );
  assert.ok(
    extensionSource.includes("const COMMIT_LANGUAGE_STORAGE_KEY = 'commitLanguage';"),
    'commit message language choice must be persisted in extension state'
  );
  assert.ok(
    extensionSource.includes('formatCommitLanguageInstruction(commitLanguage)'),
    'language selector value must affect the Language Model prompt'
  );
  assert.ok(
    extensionSource.includes('Write the natural-language commit message text in Russian'),
    'Russian commit message generation must be explicitly supported'
  );
  assert.ok(
    webviewSource.includes('findIconThemeInExtensionRoots(activeThemeId)'),
    'icon theme resolver must fall back to installed VS Code extension roots instead of bundling copied icons'
  );
  assert.ok(
    !fs.existsSync(path.join(__dirname, '..', 'resources', 'file-icons')),
    'VSIX must not bundle a copied file icon theme'
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
  assert.ok(
    extensionSource.includes("['accessibility.signals.sound', 'never']"),
    'extension must disable VS Code accessibility signal sounds globally'
  );
  assert.ok(
    extensionSource.includes("['accessibility.signals.diffLineDeleted.sound', 'never']"),
    'extension must disable diff deleted-line sounds'
  );
  assert.ok(
    extensionSource.includes("['accessibility.signals.diffLineModified.sound', 'never']"),
    'extension must disable diff modified-line sounds'
  );
  assert.ok(
    extensionSource.includes("['accessibility.signalOptions.volume', 0]"),
    'extension must force VS Code signal volume to zero'
  );
  assert.ok(
    extensionSource.includes("['terminal.integrated.enableBell', false]"),
    'extension must also disable the integrated terminal bell'
  );
  assert.ok(
    extensionSource.includes('vscode.ConfigurationTarget.Global'),
    'sound settings must be written to the current VS Code host global settings'
  );
  assert.match(
    extensionSource,
    /async openDiff\(change\)[\s\S]*?await ensureEditorSoundsDisabled\(\);[\s\S]*?'vscode\.diff'/,
    'diff opening must ensure editor sounds are disabled before showing the diff editor'
  );
  assert.deepEqual(
    manifest.extensionKind,
    ['workspace'],
    'Git panel must run in the workspace/remote extension host so WSL repositories use WSL git'
  );
  assert.equal(
    manifest.contributes.views.phpstormGitPanel[0].when,
    undefined,
    'Activity Bar panel must stay visible in WSL even before a workspace folder is opened'
  );
}

run();
