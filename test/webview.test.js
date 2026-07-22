'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildFileIconTheme,
  reconcileOptimisticStagingChanges,
  renderWebview,
  resolveFolderCheckboxChecked
} = require('../src/webview');

function run() {
  const webview = {
    cspSource: 'vscode-resource:',
    asWebviewUri(uri) {
      return {
        toString() {
          return 'webview-resource://' + uri.fsPath.replace(/\\/g, '/');
        }
      };
    }
  };
  const html = renderWebview(
    webview,
    undefined,
    { fsPath: path.join(__dirname, '..') }
  );
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

  assert.equal(
    resolveFolderCheckboxChecked(60, 2),
    true,
    'a partially checked folder checkbox must resolve to checked'
  );
  assert.equal(
    resolveFolderCheckboxChecked(60, 60),
    false,
    'a fully checked folder must resolve to unchecked'
  );
  assert.equal(
    resolveFolderCheckboxChecked(60, 0),
    true,
    'an unchecked folder must be allowed to resolve to checked'
  );
  assert.equal(
    resolveFolderCheckboxChecked(0, 0),
    false,
    'an empty folder must not resolve to checked'
  );
  assert.match(
    html,
    /function resolveFolderCheckboxChecked\(fileCount, fullyCheckedCount\)/,
    'the tested folder checkbox rule must be injected into the webview runtime'
  );

  testParentFolderUncheckSurvivesStaleGitStates();

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
    /id="view-options"[\s\S]*?aria-haspopup="menu"[\s\S]*?actions-show\.svg/,
    'the view-options button must use the real PhpStorm eye asset'
  );
  assert.doesNotMatch(
    html,
    /function toggleViewMode\(\)/,
    'the removed one-click eye toggle must not return'
  );
  assert.ok(!html.includes('id="group-menu"'), 'a duplicate group menu trigger must not remain beside the eye');
  assert.match(
    html,
    /let viewMode = persisted\.viewMode === 'flat' \? 'flat' : 'directory';/,
    'view mode must persist across webview reloads'
  );
  assert.match(
    html,
    /event\.ctrlKey && event\.altKey && event\.key\.toLowerCase\(\) === 'p'/,
    'the displayed Ctrl+Alt+P shortcut must toggle directory grouping'
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
    /<button id="generate" class="ai-button"[^>]*aria-label="Generate commit message"[^>]*>[\s\S]*?<svg[^>]*viewBox="0 0 24 24"[\s\S]*?<\/svg>[\s\S]*?<\/button>/,
    'commit message generation must use an accessible SVG icon button'
  );
  assert.doesNotMatch(
    html,
    /<button id="generate"[^>]*>\s*Generate\s*<\/button>/,
    'commit message generation button must not render the old text label'
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
    /function setLocalChecked\(paths, checked\)[\s\S]*?scheduleLocalRender\(\);/,
    'checkbox staging must schedule one local render instead of rendering every rapid click synchronously'
  );
  assert.match(
    html,
    /function scheduleLocalRender\(\)[\s\S]*?window\.requestAnimationFrame[\s\S]*?renderChangesKeepingScroll\(\);[\s\S]*?renderCommitPanel\(\);[\s\S]*?renderDiffPreview\(\);/,
    'rapid checkbox changes must be coalesced into one render frame'
  );
  assert.match(
    html,
    /function folderRow\(node, depth\)[\s\S]*?checkbox\.addEventListener\('click', function \(event\) \{[\s\S]*?const paths = collectFilePaths\(node\);[\s\S]*?const checked = resolveFolderCheckboxChecked\(\s*paths\.length,\s*countFullyCheckedPaths\(paths\)\s*\);[\s\S]*?setLocalChecked\(paths, checked\);[\s\S]*?queueStagingChanges\(paths, checked\);/,
    'folder checkbox clicks must use live descendant state so a second click after full selection unchecks every descendant'
  );
  assert.match(
    html,
    /const stagingDebounceDelayMs = 350;[\s\S]*?const pendingStagingStates = new Map\(\);[\s\S]*?function queueStagingChanges\(paths, checked\)/,
    'checkbox clicks must be debounced in the webview before they reach the extension host'
  );
  assert.match(
    html,
    /function flushPendingStagingChanges\(\)[\s\S]*?type: 'applyStagingBatch'[\s\S]*?requestId: requestId[\s\S]*?changes: changes/,
    'the webview must send one staging batch after the debounce window'
  );
  assert.doesNotMatch(
    html,
    /type: 'toggleChange'/,
    'file checkbox clicks must not send immediate single-file staging messages'
  );
  assert.doesNotMatch(
    html,
    /type: 'toggleChanges'/,
    'folder checkbox clicks must not send immediate multi-file staging messages'
  );
  assert.match(
    html,
    /const layoutVersion = 4;/,
    'layout version must reset persisted dimensions for the new preview layout'
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
    /id="show-ignored"[\s\S]*?role="menuitemcheckbox"[\s\S]*?<span>Ignored Files<\/span>/,
    'ignored files must be a working view option rather than a placeholder'
  );
  assert.doesNotMatch(
    html,
    /id="show-ignored"[^>]*disabled/,
    'ignored files option must not be disabled'
  );
  assert.match(
    html,
    /type: 'setShowIgnored', showIgnored: showIgnored/,
    'ignored-files view option must request real Git data from the extension host'
  );
  assert.match(
    html,
    /id="diff-preview-toggle"[\s\S]*?aria-pressed="false"[\s\S]*?actions-preview-details\.svg/,
    'a separate button with the real PhpStorm PreviewDetails asset must control inline diff'
  );
  assert.match(
    html,
    /type: 'setDiffPreviewEnabled', enabled: diffPreviewVisible/,
    'preview visibility must be synchronized with the extension host'
  );
  assert.match(
    html,
    /class="changes-pane"[\s\S]*?class="commit-pane"[\s\S]*?id="diff-preview" class="diff-preview"/,
    'preview layout must have changes, commit, and inline diff regions'
  );
  assert.match(
    html,
    /\.shell\.preview-visible[\s\S]*?grid-template-rows:/,
    'enabling preview must switch to the PhpStorm two-row left pane layout'
  );
  assert.match(
    html,
    /function resizeChangesWithKeyboard\(event\)/,
    'the preview commit splitter must remain keyboard-resizable'
  );
  assert.match(
    html,
    /id="changes-root-checkbox"/,
    'Changes root must expose the PhpStorm-style include checkbox'
  );
  [
    'diff-prev-change',
    'diff-next-change',
    'diff-edit-source',
    'diff-prev-file',
    'diff-next-file',
    'diff-open-native',
    'diff-viewer',
    'diff-ignore-policy',
    'diff-highlight-policy',
    'diff-collapse-unchanged',
    'diff-settings',
    'diff-help',
    'diff-stats',
    'diff-file-checkbox'
  ].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `inline diff toolbar must include ${id}`);
  });
  ['rollback-selected', 'shelve-selected', 'confirm-dialog'].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `changes toolbar workflow must include ${id}`);
  });
  assert.match(
    html,
    /type: pendingConfirmationAction[\s\S]*?path: selectedPath/,
    'destructive or state-moving file actions must wait for explicit in-panel confirmation'
  );
  [
    'Do not ignore',
    'Trim whitespaces',
    'Ignore whitespaces',
    'Ignore whitespaces and empty lines',
    'Ignore imports and formatting',
    'Unified viewer',
    'Side-by-side viewer',
    'Highlight words',
    'Highlight lines',
    'Do not highlight'
  ].forEach((label) => {
    assert.ok(html.includes(label), `inline diff controls must include ${label}`);
  });
  assert.match(
    html,
    /type: 'toggleHunk'[\s\S]*?hunkId: hunk\.id[\s\S]*?checked: event\.target\.checked/,
    'hunk checkboxes must request partial inclusion through stable hunk ids'
  );
  assert.match(
    html,
    /type: 'selectChange', path: selectedPath/,
    'selecting a file while preview is visible must load its inline diff'
  );
  assert.match(
    html,
    /function selectPath\(filePath\)[\s\S]*?vscode\.postMessage\(\{ type: 'selectChange', path: selectedPath \}\);[\s\S]*?function openSelectedDiff\(\)/,
    'selecting a row must sync selectedPath to the extension host even when inline diff is hidden'
  );
  assert.match(
    html,
    /const keepLocalSelection = sameRoot[\s\S]*?!nextSelectedPath[\s\S]*?\(stateWithOverlay\.changes \|\| \[\]\)\.some/,
    'late host refreshes without selectedPath must not erase a still-visible local row selection'
  );
  assert.match(
    html,
    /function applyOptimisticStagingOverlay\(nextState\)[\s\S]*?reconcileOptimisticStagingChanges\([\s\S]*?nextState\.confirmedStagingRequestIds/,
    'late host refreshes must keep the latest debounced checkbox state visible until its exact Git request is confirmed'
  );
  assert.match(
    html,
    /function renderDiffPreview\(\)/,
    'inline diff must render from the host-provided model'
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
    extensionSource.includes('applyOptimisticStagingStates(pathStates);'),
    'extension host must optimistically update staged state'
  );
  assert.ok(
    extensionSource.includes("case 'applyStagingBatch':"),
    'extension host must accept debounced webview staging batches'
  );
  assert.ok(
    extensionSource.includes('requestId: String(requestId || \'\').slice(0, 200)'),
    'debounced webview staging batches must flush to Git without a second debounce'
  );
  assert.ok(
    extensionSource.includes('queueStagingStates('),
    'checkbox staging must run through the non-blocking staging queue'
  );
  assert.ok(
    extensionSource.includes('this.stagingBatch.add(root, [relativePath], checked, requestId);'),
    'rapid checkbox staging requests must be coalesced by path'
  );
  assert.match(
    extensionSource,
    /const stagingStateVersion = this\.stagingStateVersion;[\s\S]*?if \(stagingStateVersion !== this\.stagingStateVersion\)/,
    'a Git status read started before a staging request must not overwrite newer optimistic state'
  );
  assert.match(
    extensionSource,
    /confirmedStagingRequestIds\.push\(\.\.\.batch\.requestIds\);[\s\S]*?confirmedStagingRequestIds: \[\.\.\.new Set\(confirmedStagingRequestIds\)\]/,
    'the extension host must acknowledge the exact staging request only after its Git command succeeds'
  );
  assert.match(
    extensionSource,
    /for \(const batch of batches\)[\s\S]*?git\.stagePaths\(batch\.root, batch\.stagePaths\)[\s\S]*?git\.unstagePaths\(batch\.root, batch\.unstagePaths\)/,
    'one queued staging flush must apply grouped stage and unstage paths'
  );
  assert.ok(
    extensionSource.includes('preserveErrorText: stagingErrorText'),
    'a failed folder staging operation must remain visible after Git state is refreshed'
  );
  assert.match(
    extensionSource,
    /const preservedErrorText =[\s\S]*?: this\.stagingErrorText;/,
    'background refreshes must not erase a staging error before the user can read it'
  );
  assert.ok(
    extensionSource.includes('git.getFileDiff('),
    'extension host must load real Git data for the inline preview'
  );
  assert.ok(
    extensionSource.includes('this.diffRequestId === requestId'),
    'late diff responses must not overwrite the current preview selection or options'
  );
  assert.ok(
    extensionSource.includes('git.setHunkIncluded('),
    'extension host must own and validate partial hunk staging'
  );
  assert.ok(
    extensionSource.includes('git.listIgnoredFiles('),
    'extension host must load ignored paths only when requested'
  );
  assert.ok(
    extensionSource.includes('git.rollbackPath(') && extensionSource.includes('git.shelvePath('),
    'extension host must implement the selected-file rollback and shelve actions'
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
  const generatorSettings = manifest.contributes.configuration.properties;
  assert.equal(
    generatorSettings['phpstormGitPanel.commitMessageGenerator'].default,
    'vscodeLanguageModel',
    'the existing VS Code Language Model provider must remain the default'
  );
  assert.deepEqual(
    generatorSettings['phpstormGitPanel.commitMessageGenerator'].enum,
    ['vscodeLanguageModel', 'codexCli'],
    'settings must let users switch between the standard provider and Codex CLI'
  );
  assert.equal(
    generatorSettings['phpstormGitPanel.commitMessageGenerator'].scope,
    'window',
    'the provider selector must be visible in normal extension settings'
  );
  assert.equal(
    generatorSettings['phpstormGitPanel.codexCli.executablePath'].scope,
    'machine',
    'the external executable path must not be controlled by repository settings'
  );
  assert.equal(
    generatorSettings['phpstormGitPanel.codexCli.model'].default,
    'gpt-5.6-luna',
    'Codex CLI must default to the economical model selected for commit generation'
  );
  assert.equal(
    generatorSettings['phpstormGitPanel.codexCli.model'].scope,
    'window',
    'the Codex model selector must be visible in normal extension settings'
  );
  assert.equal(
    generatorSettings['phpstormGitPanel.codexCli.reasoningEffort'].default,
    'low',
    'Codex CLI must default to low reasoning effort for short commit messages'
  );
  assert.equal(
    generatorSettings['phpstormGitPanel.codexCli.reasoningEffort'].scope,
    'window',
    'Codex generation options must be visible in normal extension settings'
  );
  assert.ok(
    extensionSource.includes("'workbench.action.openRemoteSettings'")
      && extensionSource.includes("query: '@ext:vetal.phpstorm-git-panel'"),
    'the panel settings button must open this extension in the WSL remote settings scope'
  );
  assert.equal(
    generatorSettings['phpstormGitPanel.codexCli.timeoutMs'].scope,
    'window',
    'the Codex timeout must be visible in normal extension settings'
  );
  assert.ok(
    extensionSource.includes("generatorSettings.provider === 'codexCli'")
      && extensionSource.includes('generateCommitMessageWithVsCodeLanguageModel(generationContext)'),
    'the Generate action must route through the configured provider while preserving the standard path'
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

function testParentFolderUncheckSurvivesStaleGitStates() {
  const originallyPartial = [
    change('parent/already-checked.cs', true),
    change('parent/previously-unchecked.cs', false),
    change('outside/must-stay-checked.cs', true)
  ];
  const selectedRequest = 'panel-1';
  const unselectedRequest = 'panel-2';

  const selectedOverlay = new Map(originallyPartial.slice(0, 2).map((item) => [
    item.path,
    { checked: true, requestId: selectedRequest }
  ]));
  const selectedBeforeConfirmation = reconcileOptimisticStagingChanges(
    originallyPartial,
    selectedOverlay,
    []
  );

  assert.deepEqual(
    selectedBeforeConfirmation.changes.map((item) => item.staged),
    [true, true, true],
    'a stale partial Git state must not undo the parent folder or change an outside file'
  );

  const unselectedOverlay = new Map(originallyPartial.slice(0, 2).map((item) => [
    item.path,
    { checked: false, requestId: unselectedRequest }
  ]));
  const staleSelectAllConfirmation = reconcileOptimisticStagingChanges(
    [
      change('parent/already-checked.cs', true),
      change('parent/previously-unchecked.cs', true),
      change('outside/must-stay-checked.cs', true)
    ],
    unselectedOverlay,
    [selectedRequest]
  );

  assert.deepEqual(
    staleSelectAllConfirmation.changes.map((item) => item.staged),
    [false, false, true],
    'confirming an older select-all request must not restore the parent or change an outside file'
  );
  assert.equal(
    staleSelectAllConfirmation.optimisticStagingStates.size,
    2,
    'the newer parent uncheck must remain pending until its own request is confirmed'
  );

  const confirmedUncheck = reconcileOptimisticStagingChanges(
    [
      change('parent/already-checked.cs', false),
      change('parent/previously-unchecked.cs', false),
      change('outside/must-stay-checked.cs', true)
    ],
    staleSelectAllConfirmation.optimisticStagingStates,
    [unselectedRequest]
  );

  assert.deepEqual(
    confirmedUncheck.changes.map((item) => item.staged),
    [false, false, true],
    'all descendants must remain unchecked and the outside file unchanged after confirmation'
  );
  assert.equal(
    confirmedUncheck.optimisticStagingStates.size,
    0,
    'the optimistic parent uncheck may clear only after its exact request is confirmed'
  );
}

function change(path, staged) {
  return {
    path,
    staged,
    hasStaged: staged,
    hasUnstaged: !staged,
    partiallyStaged: false
  };
}

run();
