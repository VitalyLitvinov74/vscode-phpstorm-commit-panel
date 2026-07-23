'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildFileIconTheme,
  mergeHostStatePatch,
  planStateRender,
  reconcileOptimisticHunkStates,
  reconcileOptimisticStagingChanges,
  reconcileVersionedField,
  renderWebview,
  resolveFolderCheckboxChecked,
  resolveHunkFocusIndex,
  synchronizeDiffPreviewWithChanges
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
  const settingsPanelSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'settingsPanel.js'),
    'utf8'
  );
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
  testPartialHostPatchUsesAuthoritativeBase();
  testAuthoritativePreviewSurvivesUnrelatedPartialPatch();
  testVersionedAmendSurvivesAnOlderHostPatch();
  testSettledHunkRequestReleasesItsOptimisticLock();
  testSettledHunkFocusSurvivesAnAuthoritativeIdChange();
  testSelectiveStateRenderPlan();

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
    /elements\['commit-language'\]\.disabled = gitInteractionBusy;/,
    'language selector must lock while Git work or repository selection is pending'
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
    /function captureChangesListFocus\(\)[\s\S]*?function restoreChangesListFocus\(focusTarget, selectedRoot\)[\s\S]*?focus\(\{ preventScroll: true \}\)/,
    'necessary tree rebuilds must restore the focused file or folder checkbox'
  );
  assert.match(
    html,
    /cancelChangesScrollRestore\(\);[\s\S]*?scrollRestoreFrame = requestFrame\(\s*function \(\)/,
    'a newer changes render must cancel an older scroll restoration frame'
  );
  assert.match(
    html,
    /const renderPlan = planStateRender\([\s\S]*?render\(\s*renderPlan,\s*\{[\s\S]*?changesScrollTop: scrollTop,[\s\S]*?changesFocus: changesFocus,[\s\S]*?previousSelectedPath: previousSelectedPath[\s\S]*?\}\s*\)/,
    'incoming state must use a selective render plan and preserve scroll only when the tree changes'
  );
  assert.match(
    html,
    /function setLocalChecked\(paths, checked\)[\s\S]*?scheduleLocalStagingRender\(pathSet\);/,
    'checkbox staging must schedule one local render instead of rendering every rapid click synchronously'
  );
  assert.match(
    html,
    /function scheduleLocalStagingRender\(paths\)[\s\S]*?localRenderFrame = requestFrame[\s\S]*?renderLocalStagingState\(changedPaths\);/,
    'rapid checkbox changes must be coalesced into one in-place render frame'
  );
  assert.match(
    html,
    /if \(plan\.changes\) \{[\s\S]*?cancelLocalStagingRender\(\);[\s\S]*?renderChanges\(/,
    'a full tree render must cancel an older queued local staging frame'
  );
  assert.doesNotMatch(
    html,
    /function scheduleLocalStagingRender\(paths\)(?:(?!function renderLocalStagingState)[\s\S])*(?:renderChanges|renderDiffPreview)\(/,
    'local staging must not replace the changes tree or diff content'
  );
  assert.match(
    html,
    /row\.dataset\.folderPath = node\.path;/,
    'folder rows must expose stable paths for in-place checkbox and counter updates'
  );
  assert.match(
    html,
    /function folderRow\(node, depth\)[\s\S]*?checkbox\.addEventListener\('click', function \(event\) \{[\s\S]*?const paths = collectFilePaths\(node\);[\s\S]*?const checked = resolveFolderCheckboxChecked\(\s*paths\.length,\s*countFullyCheckedPaths\(paths\)\s*\);[\s\S]*?setLocalChecked\(paths, checked\);[\s\S]*?queueStagingChanges\(paths, checked\);/,
    'folder checkbox clicks must use live descendant state so a second click after full selection unchecks every descendant'
  );
  assert.match(
    html,
    /function queueStagingChanges\(paths, checked\)[\s\S]*?type: 'applyStagingBatch'[\s\S]*?root: root[\s\S]*?requestId: requestId[\s\S]*?changes: changes/,
    'checkbox clicks must immediately send a repository-scoped staging batch to the extension host'
  );
  assert.doesNotMatch(
    html,
    /stagingDebounceDelayMs|pendingStagingStates|flushPendingStagingChanges/,
    'the webview must not hold staging changes in a second debounce queue'
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
  // Приемочный свидетель: pointermove не должен синхронно перечитывать layout.
  assert.match(
    html,
    /function startResize\(event\)[\s\S]*?left: rect\.left,[\s\S]*?maxLeft: maxLeftPaneWidth\(rect\)[\s\S]*?function moveResize\(event\)[\s\S]*?event\.clientX - dragStart\.left/,
    'the horizontal splitter must reuse geometry captured on pointerdown'
  );
  assert.doesNotMatch(
    html,
    /function moveResize\(event\)(?:(?!function stopResize)[\s\S])*?getBoundingClientRect/,
    'horizontal pointermove must not force a synchronous layout read'
  );
  assert.match(
    html,
    /function startChangesResize\(event\)[\s\S]*?top: rect\.top,[\s\S]*?maximum: bounds\.maximum[\s\S]*?function moveChangesResize\(event\)[\s\S]*?event\.clientY - changesResizeStart\.top/,
    'the vertical splitter must reuse geometry captured on pointerdown'
  );
  assert.doesNotMatch(
    html,
    /function moveChangesResize\(event\)(?:(?!function stopChangesResize)[\s\S])*?getBoundingClientRect/,
    'vertical pointermove must not force a synchronous layout read'
  );
  assert.match(
    html,
    /function scheduleLayoutSize\(\)[\s\S]*?applyLayoutSize\(\);[\s\S]*?function applyLayoutSize\(shellRect\)[\s\S]*?applyPaneSize\(rect\);[\s\S]*?applyChangesPaneSize\(rect\);/,
    'both splitters and window resize must share one animation-frame layout pass'
  );
  assert.match(
    html,
    /function applyChangesPaneSize\(rect\)[\s\S]*?changesPaneBounds\(rect\)[\s\S]*?const appliedChangesPaneHeight = clamp\([\s\S]*?appliedChangesPaneHeight \+ 'px'/,
    'persisted changes pane height must be clamped without losing its preferred size'
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
    /function openConfirmation\(action, title, message\)[\s\S]*?const requestedRoot = state\.selectedRoot;[\s\S]*?pendingConfirmation = \{[\s\S]*?root: requestedRoot,[\s\S]*?path: requestedPath/,
    'destructive confirmation must capture the repository and path when the dialog opens'
  );
  assert.match(
    html,
    /state\.selectedRoot === confirmation\.root[\s\S]*?type: confirmation\.action,[\s\S]*?root: confirmation\.root,[\s\S]*?path: confirmation\.path/,
    'a confirmation must be discarded after a repository switch and otherwise use captured targets'
  );
  assert.match(
    html,
    /elements\['rollback-selected'\]\.disabled =[\s\S]*?selectedChange\.kind === 'added'[\s\S]*?selectedChange\.kind === 'copied'/,
    'rollback must stay disabled for copied destinations that Git cannot restore safely'
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
    /checkbox\.addEventListener\(\s*'change'[\s\S]*?const root = state\.selectedRoot;[\s\S]*?event\.target\.disabled = true;[\s\S]*?renderLocalHunkIncluded\(section, checked\);[\s\S]*?type: 'toggleHunk'[\s\S]*?root: root[\s\S]*?requestId: requestId[\s\S]*?hunkId: hunk\.id[\s\S]*?checked: checked/,
    'hunk checkboxes must lock locally and send repository-scoped requests with stable ids'
  );
  assert.match(
    html,
    /function reconcileOptimisticHunkStates\([\s\S]*?failed\.has\(requestId\)[\s\S]*?confirmed\.has\(requestId\)[\s\S]*?continue;/,
    'settled hunk request ids must release their exact optimistic locks'
  );
  assert.match(
    html,
    /checkbox\.disabled =[\s\S]*?isHunkStagingPending\(hunk\?\.id\)[\s\S]*?function isHunkStagingPending\(hunkId\)[\s\S]*?optimisticHunkStates\.values\(\)/,
    'a pending hunk checkbox must remain disabled until its exact request settles'
  );
  assert.match(
    html,
    /type: 'selectChange', root: state\.selectedRoot, path: selectedPath/,
    'selecting a file while preview is visible must load its inline diff'
  );
  assert.match(
    html,
    /function selectPath\(filePath\)[\s\S]*?if \(selectedPath === filePath\) \{[\s\S]*?return;[\s\S]*?renderSelection\(previousSelectedPath, selectedPath\);[\s\S]*?type: 'selectChange', root: state\.selectedRoot, path: selectedPath[\s\S]*?function openSelectedDiff\(\)/,
    'selection must ignore no-op clicks, update row classes in place, and sync a real change to the host'
  );
  [
    'stageAll',
    'unstageAll',
    'locateActiveFile',
    'setAmend',
    'generateCommitMessage',
    'commit',
    'commitAndPush',
    'selectChange',
    'openDiff',
    'openFile'
  ].forEach(
    (messageType) => {
      assert.match(
        html,
        new RegExp(`type: '${messageType}',[\\s\\S]{0,120}?root: state\\.selectedRoot`),
        `${messageType} must be scoped to the repository visible when the action was requested`
      );
    }
  );
  // Приемочный свидетель: запоздалый UI старого repository не может направить Git action в новый root.
  assert.match(
    html,
    /let pendingSelectedPath = '';[\s\S]*?else if \(pendingSelectedPath\)[\s\S]*?nextSelectedPath === pendingSelectedPath[\s\S]*?pendingSelectionExists && selectedPath === pendingSelectedPath[\s\S]*?keepLocalSelection = true/,
    'late host selections must not replace a newer repository-local selection request'
  );
  assert.match(
    html,
    /type: 'selectRepository',[\s\S]*?root: root,[\s\S]*?requestId: requestId/,
    'repository selection must include a unique request id'
  );
  assert.match(
    html,
    /pendingRepositorySelection\.requestId === settledRepositorySelectionRequestId[\s\S]*?renderPlan\.repositories = true;[\s\S]*?renderPlan\.commit = true/,
    'repository dropdown rollback must wait for the exact host settlement request id'
  );
  assert.match(
    html,
    /function isGitInteractionBusy\(\)[\s\S]*?Boolean\(pendingRepositorySelection\)/,
    'a pending repository selection must count as a Git interaction lock'
  );
  assert.match(
    html,
    /pendingRepositorySelection = \{[\s\S]*?renderCommitPanel\(\);[\s\S]*?updateInteractiveState\(\);[\s\S]*?type: 'selectRepository'/,
    'Git controls must lock locally while a repository selection is pending'
  );
  assert.match(
    html,
    /function selectPath\(filePath\) \{[\s\S]*?if \(isGitInteractionBusy\(\)\)[\s\S]*?function openSelectedDiff\(\)[\s\S]*?!isGitInteractionBusy\(\)/,
    'old change rows and keyboard navigation must not act while repository selection is pending'
  );
  assert.match(
    html,
    /function updateChangesRootState\(changes\)[\s\S]*?disabled = isGitInteractionBusy\(\)[\s\S]*?function folderRow\(node, depth\)[\s\S]*?checkbox\.disabled = isGitInteractionBusy\(\)[\s\S]*?function fileRow\(change, depth, options\)[\s\S]*?checkbox\.disabled = isGitInteractionBusy\(\)/,
    'a local tree rerender must preserve the pending repository interaction lock'
  );
  assert.match(
    html,
    /function applyOptimisticStagingOverlay\(nextState\)[\s\S]*?reconcileOptimisticStagingChanges\([\s\S]*?nextState\.confirmedStagingRequestIds,[\s\S]*?nextState\.failedStagingRequestIds/,
    'late host refreshes must keep checkbox state visible until its exact Git request is confirmed or failed'
  );
  assert.match(
    html,
    /let hostState = state;[\s\S]*?const mergedHostState = mergeHostStatePatch\([\s\S]*?hostState,[\s\S]*?event\.data\.state,[\s\S]*?event\.data\.partial[\s\S]*?const nextState = synchronizeDiffPreviewWithChanges\(mergedHostState\);[\s\S]*?hostState = nextState;/,
    'small host patches must merge into a separate authoritative state instead of an optimistic UI state'
  );
  assert.doesNotMatch(
    html,
    /function applyOptimisticStagingOverlay\(nextState\)[\s\S]*?nextState\.errorText[\s\S]*?optimisticStagingStates\.clear\(\)/,
    'an unrelated or older error must not clear newer optimistic staging changes'
  );
  assert.match(
    html,
    /const previewOptimisticState = optimisticStagingStates\.get\(previewPath\);[\s\S]*?applyCheckedToDiffPreview\([\s\S]*?nextState\.diffPreview,[\s\S]*?Boolean\(previewOptimisticState\.checked\)/,
    'incoming Git state must apply the same optimistic staging overlay to the selected diff'
  );
  assert.match(
    html,
    /function renderDiffPreview\(\)/,
    'inline diff must render from the host-provided model'
  );
  assert.match(
    html,
    /function currentDiffPreview\(\)[\s\S]*?preview\.path[\s\S]*?preview\.path !== selectedPath[\s\S]*?return undefined;/,
    'a late diff model for another path must never replace the current preview'
  );
  assert.match(
    html,
    /elements\.message\.addEventListener\(\s*'input'[\s\S]*?localMessageVersion = Math\.max\([\s\S]*?localMessageVersion \+= 1;[\s\S]*?renderCommitMessageControls\(\);[\s\S]*?type: 'setMessage'[\s\S]*?messageVersion: localMessageVersion/,
    'typing must send each monotonic draft update immediately without rendering the tree or diff'
  );
  assert.match(
    html,
    /if \(nextMessageVersion < localMessageVersion\)[\s\S]*?message: state\.message,[\s\S]*?messageVersion: localMessageVersion/,
    'a stale host state must not overwrite a newer local commit draft'
  );
  // Приемочный свидетель: уничтожение webview не должно уничтожать черновик коммита.
  assert.match(
    html,
    /message: persistedMessage,[\s\S]*?messageVersion: persistedMessageVersion[\s\S]*?function persistCommitDraft\(message, messageVersion\)[\s\S]*?vscode\.setState/,
    'the webview state must persist both the commit draft and its monotonic version'
  );
  assert.match(
    html,
    /const restoredMessage = String\(state\.message \|\| ''\);[\s\S]*?elements\.message\.value = restoredMessage;[\s\S]*?type: 'setMessage',[\s\S]*?messageVersion: localMessageVersion[\s\S]*?type: 'ready'/,
    'a recreated webview must restore its visible draft to the host before requesting initial state'
  );
  assert.match(
    html,
    /persistCommitDraft\(message, localMessageVersion\);/,
    'every immediate draft update must also persist in webview state'
  );
  assert.match(
    html,
    /const busy = isGitInteractionBusy\(\);[\s\S]*?elements\['repo-select'\]\.disabled = busy;[\s\S]*?const gitInteractionBusy = isGitInteractionBusy\(\);[\s\S]*?textarea\.disabled = gitInteractionBusy;[\s\S]*?elements\.amend\.disabled = gitInteractionBusy;/,
    'repository, commit text, and amend controls must lock during user operations'
  );
  assert.match(
    html,
    /if \(textarea\.value !== message\) \{[\s\S]*?textarea\.value = message;/,
    'a generated or cleared host message must update the textarea even if it previously had focus'
  );
  assert.doesNotMatch(
    html,
    /document\.activeElement !== textarea/,
    'textarea focus must not block a version-validated host draft update'
  );
  assert.doesNotMatch(
    html,
    /messageDebounce|pendingMessage|flushPendingMessageUpdate|scheduleMessageUpdate/,
    'commit drafts must not wait in a lossy timer queue'
  );
  assert.doesNotMatch(
    html,
    /function toggleDiffPreview\(\)(?:(?!function applyPreviewLayout)[\s\S])*?setDiffPreviewEnabled(?:(?!function applyPreviewLayout)[\s\S])*?type: 'selectChange'/,
    'showing the inline preview must not issue a duplicate selection request'
  );
  assert.match(
    html,
    /function captureDiffRenderPosition\(\)[\s\S]*?focusedHunkId[\s\S]*?function finishDiffRender\(renderPosition\)[\s\S]*?scrollTop = renderPosition\.scrollTop[\s\S]*?focus\(\{ preventScroll: true \}\)/,
    'a same-file diff rebuild must restore its scroll position and focused hunk checkbox'
  );
  assert.match(
    html,
    /const pendingHunkRequestIdsBefore = Array\.from\(optimisticHunkStates\.keys\(\)\)[\s\S]*?pendingHunkRequestsChanged[\s\S]*?renderPlan\.commit = true;/,
    'settling an exact hunk request must refresh disabled controls even when the visible diff is unchanged'
  );
  assert.match(
    html,
    /pendingHunkFocus = \{[\s\S]*?requestId: requestId,[\s\S]*?index: index,[\s\S]*?rawPatch:[\s\S]*?function takeSettledHunkFocus\(nextState\)[\s\S]*?includes\(requestId\)[\s\S]*?restoreSettledHunkFocus\(settledHunkFocus\)/,
    'the exact settled hunk request must restore its keyboard focus even when Git changes the hunk id'
  );
  assert.match(
    html,
    /function restoreSettledHunkFocus\(focusTarget\)[\s\S]*?!document\.hasFocus\(\)[\s\S]*?!focusWasNotMoved/,
    'hunk settlement must not steal focus after the user leaves the webview or moves to another control'
  );
  assert.match(
    html,
    /function renderDiffHunk\(hunk, index, preview\)[\s\S]*?checkbox\.disabled = isGitInteractionBusy\(\)[\s\S]*?isHunkStagingPending\(hunk\.id\)/,
    'a pending hunk checkbox must stay disabled across diff rerenders'
  );
  assert.match(
    html,
    /collapsedFoldersByRoot[\s\S]*?function switchCollapsedFolderScope\(nextRoot\)/,
    'collapsed directory state must be scoped to each repository'
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

  assert.doesNotMatch(
    extensionSource,
    /applyOptimisticStagingStates/,
    'the host must not publish a pre-Git checkbox state that a failure cannot roll back'
  );
  assert.doesNotMatch(
    webviewSource,
    /previousOptimisticStates[\s\S]*?confirmedOptimisticState/,
    'a settled file request must not be reinserted only to cover a stale diff preview'
  );
  assert.match(
    extensionSource,
    /await git\.setPathsStaged\([\s\S]*?completedBatches\.push\(batch\);[\s\S]*?await this\.refreshStagingRoots\(touchedRoots\);[\s\S]*?confirmedStagingRequestIds\.push\(\.\.\.batch\.requestIds\);/,
    'the extension host may confirm a checkbox only after Git succeeds and status is authoritative'
  );
  assert.ok(
    extensionSource.includes("case 'applyStagingBatch':"),
    'extension host must accept immediate repository-scoped staging batches'
  );
  assert.match(
    extensionSource,
    /async applyStagingBatch\(changeStates, requestId, requestedRoot\)[\s\S]*?const normalizedRequestId = String\(requestId \|\| ''\)\.slice\(0, 200\);[\s\S]*?requestId: normalizedRequestId/,
    'webview staging request ids must reach Git without a second debounce'
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
    'a Git status read started before a staging request must not overwrite newer queued staging intent'
  );
  assert.match(
    extensionSource,
    /confirmedStagingRequestIds\.push\(\.\.\.batch\.requestIds\);[\s\S]*?confirmedStagingRequestIds: \[\.\.\.new Set\(confirmedStagingRequestIds\)\]/,
    'the extension host must acknowledge the exact staging request only after its Git command succeeds'
  );
  assert.match(
    extensionSource,
    /for \(const batch of batches\)[\s\S]*?git\.setPathsStaged\([\s\S]*?batch\.root,[\s\S]*?batch\.stagePaths,[\s\S]*?batch\.unstagePaths/,
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
    Object.keys(generatorSettings).some(
      (key) => key.startsWith('phpstormGitPanel.codexCli.')
    ),
    false,
    'Codex-only fields must not remain permanently visible in native settings'
  );
  assert.ok(
    settingsPanelSource.includes(
      "codexSettings.hidden = provider.value !== 'codexCli';"
    ),
    'the extension settings panel must reveal Codex options only for Codex CLI'
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
  // Приемочный свидетель: расширение не меняет глобальные настройки среды пользователя.
  assert.doesNotMatch(
    extensionSource,
    /accessibility\.signals|accessibility\.signalOptions|terminal\.integrated\.enableBell|ConfigurationTarget\.Global|ensureEditorSoundsDisabled/,
    'the extension must leave global sound and accessibility preferences unchanged'
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

function testPartialHostPatchUsesAuthoritativeBase() {
  const authoritativeChange = change('failed.txt', false);
  const authoritativeState = {
    changes: [authoritativeChange],
    failedStagingRequestIds: []
  };
  const optimisticUiState = {
    ...authoritativeState,
    changes: [change('failed.txt', true)]
  };
  const mergedHostState = mergeHostStatePatch(
    authoritativeState,
    { failedStagingRequestIds: ['failed-request'] },
    true
  );
  const reconciled = reconcileOptimisticStagingChanges(
    mergedHostState.changes,
    new Map(
      [['failed.txt', { checked: true, requestId: 'failed-request' }]]
    ),
    [],
    mergedHostState.failedStagingRequestIds
  );

  // Приемочный свидетель: partial failure откатывается к host base, а не к optimistic UI.
  assert.equal(optimisticUiState.changes[0].staged, true);
  assert.equal(reconciled.changes[0].staged, false);
  assert.equal(reconciled.optimisticStagingStates.size, 0);

  const clearedRepositoryState = mergeHostStatePatch(
    { selectedRoot: '/repo', diffPreview: { path: 'failed.txt' } },
    JSON.parse(JSON.stringify({ selectedRoot: null, diffPreview: null })),
    true
  );
  assert.equal(clearedRepositoryState.selectedRoot, null);
  assert.equal(clearedRepositoryState.diffPreview, null);
}

function testAuthoritativePreviewSurvivesUnrelatedPartialPatch() {
  const staleHostState = {
    selectedRoot: '/repo',
    changes: [change('selected.txt', true)],
    diffPreview: {
      path: 'selected.txt',
      fileIncluded: false,
      filePartiallyIncluded: false,
      includedCount: 0,
      hunks: [{ id: 'selected-hunk', included: false }]
    },
    amend: false
  };
  const synchronizedState = synchronizeDiffPreviewWithChanges(staleHostState);
  const afterUnrelatedPartial = synchronizeDiffPreviewWithChanges(
    mergeHostStatePatch(
      synchronizedState,
      { amend: true },
      true
    )
  );

  // Приемочный свидетель: staging ack остаётся видимым после несвязанного partial до фонового diff refresh.
  assert.equal(synchronizedState.diffPreview.fileIncluded, true);
  assert.equal(synchronizedState.diffPreview.hunks[0].included, true);
  assert.equal(afterUnrelatedPartial.diffPreview.fileIncluded, true);
  assert.equal(afterUnrelatedPartial.diffPreview.hunks[0].included, true);
  assert.strictEqual(
    afterUnrelatedPartial.diffPreview,
    synchronizedState.diffPreview,
    'an already synchronized preview must retain identity and avoid a redundant diff rerender'
  );
}

function testVersionedAmendSurvivesAnOlderHostPatch() {
  const authoritativeState = {
    selectedRoot: '/repo-a',
    amend: false,
    amendVersion: 0,
    statusText: '1/1 checked'
  };
  const localState = {
    ...authoritativeState,
    amend: true,
    amendVersion: 1
  };
  const oldPartialState = mergeHostStatePatch(
    authoritativeState,
    { statusText: 'Updating...' },
    true
  );
  const preserved = reconcileVersionedField(
    oldPartialState,
    localState,
    'amend',
    'amendVersion',
    1
  );

  // Приемочный свидетель: фоновый partial state не откатывает ещё не подтверждённый Amend.
  assert.equal(preserved.state.amend, true);
  assert.equal(preserved.state.amendVersion, 1);

  const repositoryReset = reconcileVersionedField(
    {
      ...oldPartialState,
      selectedRoot: '/repo-b',
      amend: false,
      amendVersion: 2
    },
    preserved.state,
    'amend',
    'amendVersion',
    preserved.version
  );

  assert.equal(repositoryReset.state.amend, false);
  assert.equal(repositoryReset.version, 2);
  // Контрольный факт вне области изменения: более новая версия хоста остаётся авторитетной.
}

function testSettledHunkRequestReleasesItsOptimisticLock() {
  const requestId = 'hunk-request';
  const pending = new Map(
    [
      [
        requestId,
        {
          root: '/repo',
          path: 'file.txt',
          hunkId: 'hunk-1',
          checked: true
        }
      ]
    ]
  );
  const unchangedPreview = {
    path: 'file.txt',
    hunks: [{ id: 'hunk-1', included: false }]
  };
  const beforeSettlement = reconcileOptimisticHunkStates(
    pending,
    [],
    [],
    unchangedPreview
  );
  const afterConfirmation = reconcileOptimisticHunkStates(
    pending,
    [requestId],
    [],
    unchangedPreview
  );
  const afterFailure = reconcileOptimisticHunkStates(
    pending,
    [],
    [requestId],
    unchangedPreview
  );

  assert.equal(beforeSettlement.size, 1);
  // Приемочный свидетель: exact ack снимает lock даже если concurrent Git change вернул старый diff.
  assert.equal(afterConfirmation.size, 0);
  assert.equal(afterFailure.size, 0);
  // Контрольный факт вне области изменения: незавершённый request сохраняет optimistic overlay.
}

function testParentFolderUncheckSurvivesStaleGitStates() {
  const originallyPartial = [
    change('parent/already-checked.cs', true),
    change('parent/previously-unchecked.cs', false),
    change('outside/must-stay-checked.cs', true)
  ];
  const selectedRequest = 'panel-1';
  const unselectedRequest = 'panel-2';

  const selectedOverlayEntries = originallyPartial.slice(0, 2).map(
    (item) => [item.path, { checked: true, requestId: selectedRequest }]
  );
  const selectedOverlay = new Map(selectedOverlayEntries);
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

  const unselectedOverlayEntries = originallyPartial.slice(0, 2).map(
    (item) => [item.path, { checked: false, requestId: unselectedRequest }]
  );
  const unselectedOverlay = new Map(unselectedOverlayEntries);
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

  // Приемочный свидетель: подтверждение не должно возвращать устаревшее состояние Git.
  const confirmedFileStates = new Map(
    [
      ['parent/previously-unchecked.cs', { checked: true, requestId: selectedRequest }]
    ]
  );
  const confirmedFile = reconcileOptimisticStagingChanges(
    [change('parent/previously-unchecked.cs', true)],
    confirmedFileStates,
    [selectedRequest]
  );
  const externallyUnstagedLater = reconcileOptimisticStagingChanges(
    [change('parent/previously-unchecked.cs', false)],
    confirmedFile.optimisticStagingStates,
    [],
    []
  );

  // Приемочный свидетель: settled overlay не маскирует последующий внешний unstage.
  assert.equal(
    confirmedFile.optimisticStagingStates.size,
    0,
    'an exact authoritative confirmation must release the optimistic file state'
  );
  assert.equal(
    externallyUnstagedLater.changes[0].staged,
    false,
    'a later external index change must remain visible after the request settles'
  );

  const mixedRequestStates = new Map(
    [
      ['parent/already-checked.cs', { checked: false, requestId: selectedRequest }],
      ['parent/previously-unchecked.cs', { checked: true, requestId: unselectedRequest }]
    ]
  );
  const failedOlderRequest = reconcileOptimisticStagingChanges(
    originallyPartial,
    mixedRequestStates,
    [],
    [selectedRequest]
  );

  assert.equal(
    failedOlderRequest.optimisticStagingStates.has('parent/already-checked.cs'),
    false,
    'a failed staging request must revert only its own optimistic path'
  );
  assert.equal(
    failedOlderRequest.optimisticStagingStates.has('parent/previously-unchecked.cs'),
    true,
    'a newer optimistic staging request must survive an older request failure'
  );
  // Контрольный факт вне области изменения: соседний запрос остаётся оптимистичным.
}

function testSettledHunkFocusSurvivesAnAuthoritativeIdChange() {
  const authoritativeHunks = [
    {
      id: 'new-source-id',
      header: '@@ -1 +1 @@',
      rawLines: ['@@ -1 +1 @@', '-old', '+new']
    }
  ];
  const focusTarget = {
    index: 0,
    hunkId: 'old-source-id',
    header: '@@ -1 +1 @@',
    rawPatch: ['@@ -1 +1 @@', '-old', '+new'].join('\n')
  };

  // Приемочный свидетель: после exact settlement фокус следует за hunk при смене source-derived id.
  assert.equal(resolveHunkFocusIndex(authoritativeHunks, focusTarget), 0);
  assert.equal(resolveHunkFocusIndex([], focusTarget), -1);
}

function testSelectiveStateRenderPlan() {
  assert.doesNotMatch(
    planStateRender.toString(),
    /JSON\.stringify|hunk\.lines\.map/,
    'the render planner must not serialize or scan every rendered diff line'
  );

  const baseState = {
    repositories: [{ root: 'repo-a', name: 'Repo A' }],
    selectedRoot: 'repo-a',
    changes: [change('src/app.js', false)],
    ignoredFiles: [],
    showIgnored: false,
    diffPreviewEnabled: true,
    selectedPath: 'src/app.js',
    diffLoading: false,
    diffPreview: {
      path: 'src/app.js',
      differenceCount: 1,
      includedCount: 0,
      hunks: [{ id: 'hunk-a', included: false, canToggle: true, lines: [{ type: 'add' }] }]
    },
    message: '',
    statusText: '0/1 checked',
    busy: false,
    stagedCount: 0,
    totalCount: 1
  };
  const textOnlyState = {
    ...baseState,
    message: 'Keep the caret stable',
    statusText: 'Commit message updated'
  };
  const textOnlyPlan = planStateRender(
    baseState,
    textOnlyState,
    baseState.selectedPath,
    textOnlyState.selectedPath
  );

  assert.equal(textOnlyPlan.repositories, false, 'message updates must preserve the repository selector node');
  assert.equal(textOnlyPlan.changes, false, 'message updates must preserve every changes tree node');
  assert.equal(textOnlyPlan.selection, false, 'message updates must not touch row selection classes');
  assert.equal(textOnlyPlan.diff, false, 'message updates must preserve the rendered diff nodes');
  assert.equal(textOnlyPlan.commit, true, 'message updates must refresh lightweight commit controls');

  const errorOnlyState = {
    ...baseState,
    errorText: 'A staging operation failed'
  };
  const errorOnlyPlan = planStateRender(
    baseState,
    errorOnlyState,
    baseState.selectedPath,
    errorOnlyState.selectedPath
  );
  assert.equal(
    errorOnlyPlan.diff,
    false,
    'an error banner update alone must not reconstruct the diff'
  );

  const secondChange = change('src/other.js', true);
  const selectionState = {
    ...baseState,
    changes: baseState.changes.concat(secondChange),
    selectedPath: 'src/other.js'
  };
  const selectionBaseline = { ...selectionState, selectedPath: 'src/app.js' };
  const selectionPlan = planStateRender(
    selectionBaseline,
    selectionState,
    selectionBaseline.selectedPath,
    selectionState.selectedPath
  );

  assert.equal(selectionPlan.changes, false, 'selection-only updates must not reconstruct the changes list');
  assert.equal(selectionPlan.selection, true, 'selection-only updates must toggle existing row classes');
  assert.equal(selectionPlan.diff, true, 'selection changes must update the preview');

  const changedGitState = {
    ...baseState,
    changes: [change('src/app.js', true)],
    stagedCount: 1
  };
  const changedGitPlan = planStateRender(
    baseState,
    changedGitState,
    baseState.selectedPath,
    baseState.selectedPath
  );
  assert.equal(
    changedGitPlan.changes,
    true,
    'a real staging-state change must rerender the tree'
  );

  const changedDiffState = {
    ...baseState,
    diffPreview: {
      ...baseState.diffPreview,
      hunks: [{ id: 'hunk-b', included: false, canToggle: true, lines: [{ type: 'add' }] }]
    }
  };
  const changedDiffPlan = planStateRender(
    baseState,
    changedDiffState,
    baseState.selectedPath,
    baseState.selectedPath
  );
  assert.equal(
    changedDiffPlan.diff,
    true,
    'a new hunk id must rerender the diff without comparing every diff line'
  );

  const firstBlameState = {
    ...baseState,
    diffPreview: {
      ...baseState.diffPreview,
      blame: { 1: 'Alice, first revision' }
    }
  };
  const changedBlameState = {
    ...firstBlameState,
    diffPreview: {
      ...firstBlameState.diffPreview,
      blame: { 1: 'Bob, corrected revision' }
    }
  };
  const changedBlamePlan = planStateRender(
    firstBlameState,
    changedBlameState,
    baseState.selectedPath,
    baseState.selectedPath
  );

  // Приемочный свидетель: смена подписи blame при том же числе строк должна быть видна.
  assert.equal(
    changedBlamePlan.diff,
    true,
    'changed blame values must rerender the diff even when blame key count is unchanged'
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
