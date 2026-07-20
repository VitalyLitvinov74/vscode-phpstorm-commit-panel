'use strict';

function renderWebview(webview) {
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>PhpStorm Commit Panel</title>
  <style nonce="${nonce}">
    :root {
      --panel-bg: var(--vscode-sideBar-background);
      --editor-bg: var(--vscode-editor-background);
      --surface-soft: color-mix(in srgb, var(--vscode-sideBar-background) 84%, var(--vscode-foreground) 16%);
      --surface-hover: var(--vscode-list-hoverBackground);
      --surface-active: var(--vscode-list-activeSelectionBackground);
      --surface-active-fg: var(--vscode-list-activeSelectionForeground);
      --border: var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      --border-soft: color-mix(in srgb, var(--border) 62%, transparent);
      --muted: var(--vscode-descriptionForeground);
      --text: var(--vscode-foreground);
      --accent: var(--vscode-focusBorder, var(--vscode-button-background));
      --blue: var(--vscode-button-background);
      --blue-fg: var(--vscode-button-foreground);
      --blue-hover: var(--vscode-button-hoverBackground);
      --input-bg: var(--vscode-input-background);
      --input-border: var(--vscode-input-border);
      --danger: var(--vscode-errorForeground);
      --success: var(--vscode-gitDecoration-addedResourceForeground);
      --modified: var(--vscode-gitDecoration-modifiedResourceForeground);
      --deleted: var(--vscode-gitDecoration-deletedResourceForeground);
      --untracked: var(--vscode-gitDecoration-untrackedResourceForeground);
      --left-pane-width: 520px;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      height: 100%;
      margin: 0;
      padding: 0;
      color: var(--text);
      background: var(--panel-bg);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      overflow: hidden;
    }

    body.resizing {
      cursor: col-resize;
      user-select: none;
    }

    button,
    textarea,
    select,
    input {
      font: inherit;
    }

    button {
      border: 0;
      color: var(--text);
      background: transparent;
      border-radius: 4px;
      cursor: pointer;
    }

    button:hover:not(:disabled) {
      background: var(--surface-hover);
    }

    button:disabled {
      cursor: default;
      opacity: 0.45;
    }

    .shell {
      display: grid;
      grid-template-columns: var(--left-pane-width) 12px minmax(320px, 1fr);
      height: 100vh;
      min-width: 680px;
      background: var(--editor-bg);
    }

    .left,
    .right {
      min-width: 0;
      min-height: 0;
    }

    .left {
      display: grid;
      grid-template-rows: 34px 38px 1fr;
      background: var(--panel-bg);
      border-right: 1px solid var(--border-soft);
    }

    .right {
      display: grid;
      grid-template-rows: 46px 1fr 44px;
      background: var(--editor-bg);
    }

    .splitter {
      position: relative;
      background: transparent;
      cursor: col-resize;
      outline: none;
    }

    .splitter::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      width: 1px;
      background: var(--border-soft);
      transform: translateX(-50%);
    }

    .splitter::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 2px;
      height: 52px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--muted) 42%, transparent);
      transform: translate(-50%, -50%);
      opacity: 0;
      transition: opacity 0.12s ease, background 0.12s ease;
    }

    .splitter:hover,
    .splitter.dragging,
    .splitter:focus-visible {
      background: color-mix(in srgb, var(--accent) 10%, transparent);
    }

    .splitter:hover::after,
    .splitter.dragging::after,
    .splitter:focus-visible::after {
      opacity: 1;
      background: var(--accent);
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
      padding: 4px 8px;
      border-bottom: 1px solid var(--border-soft);
      background: color-mix(in srgb, var(--panel-bg) 90%, var(--editor-bg) 10%);
    }

    .toolbar .spacer,
    .commit-header .spacer {
      flex: 1;
    }

    .tool-button {
      width: 25px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      font-size: 14px;
      font-weight: 600;
      line-height: 1;
    }

    .tool-button:hover:not(:disabled) {
      color: var(--text);
    }

    .tool-separator {
      width: 1px;
      height: 18px;
      margin: 0 5px;
      background: var(--border-soft);
    }

    .repo-select {
      min-width: 0;
      max-width: 230px;
      height: 24px;
      color: var(--text);
      background: var(--input-bg);
      border: 1px solid var(--input-border, transparent);
      border-radius: 4px;
      padding: 1px 7px;
    }

    .changes-header {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: 8px;
      padding: 0 13px;
      border-bottom: 1px solid var(--border-soft);
      background: color-mix(in srgb, var(--panel-bg) 72%, var(--editor-bg) 28%);
    }

    .disclosure {
      color: var(--muted);
      font-size: 12px;
      transform: translateY(-1px);
    }

    .changes-title {
      min-width: 0;
      overflow: hidden;
      color: var(--text);
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .changes-count {
      height: 20px;
      min-width: 22px;
      padding: 2px 7px;
      color: var(--muted);
      background: color-mix(in srgb, var(--surface-soft) 62%, transparent);
      border: 1px solid var(--border-soft);
      border-radius: 999px;
      font-size: 11px;
      line-height: 14px;
      text-align: center;
    }

    .changes-summary {
      min-width: 0;
      overflow: hidden;
      color: var(--muted);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .changes-list {
      overflow: auto;
      padding: 7px 8px 12px;
    }

    .empty {
      margin: 8px 4px;
      padding: 18px 16px;
      color: var(--muted);
      background: color-mix(in srgb, var(--surface-soft) 45%, transparent);
      border: 1px solid var(--border-soft);
      border-radius: 8px;
      line-height: 1.45;
    }

    .empty-title {
      color: var(--text);
      font-weight: 600;
      margin-bottom: 5px;
    }

    .empty-text {
      max-width: 420px;
    }

    .tree-row {
      display: grid;
      grid-template-columns: 16px 20px 20px minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
      min-height: 28px;
      padding: 2px 7px;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: default;
    }

    .tree-row + .tree-row {
      margin-top: 1px;
    }

    .tree-row:hover {
      background: var(--surface-hover);
    }

    .tree-row.selected {
      color: var(--surface-active-fg);
      background: var(--surface-active);
      border-color: color-mix(in srgb, var(--accent) 28%, transparent);
    }

    .disclosure-button {
      width: 16px;
      height: 22px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      font-size: 11px;
      line-height: 1;
    }

    .file-checkbox {
      width: 14px;
      height: 14px;
      margin: 0;
      accent-color: var(--blue);
      cursor: pointer;
    }

    .status {
      width: 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 5px;
      background: color-mix(in srgb, var(--muted) 12%, transparent);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      font-weight: 700;
    }

    .folder-icon {
      color: var(--muted);
      font-size: 14px;
      line-height: 1;
    }

    .folder-main {
      min-width: 0;
      overflow: hidden;
      color: inherit;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .folder-count {
      color: var(--muted);
      font-size: 11px;
      white-space: nowrap;
    }

    .tree-row.selected .folder-count {
      color: color-mix(in srgb, var(--surface-active-fg) 72%, transparent);
    }

    .status.added,
    .status.copied {
      color: var(--success);
      background: color-mix(in srgb, var(--success) 14%, transparent);
    }

    .status.modified,
    .status.renamed,
    .status.changed {
      color: var(--modified);
      background: color-mix(in srgb, var(--modified) 14%, transparent);
    }

    .status.deleted {
      color: var(--deleted);
      background: color-mix(in srgb, var(--deleted) 14%, transparent);
    }

    .status.untracked {
      color: var(--untracked);
      background: color-mix(in srgb, var(--untracked) 14%, transparent);
    }

    .status.conflict {
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 14%, transparent);
    }

    .file-main {
      min-width: 0;
      display: grid;
      gap: 1px;
    }

    .file-name {
      overflow: hidden;
      color: inherit;
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-path {
      min-height: 14px;
      overflow: hidden;
      color: var(--muted);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tree-row.selected .file-path {
      color: color-mix(in srgb, var(--surface-active-fg) 72%, transparent);
    }

    .file-meta {
      color: var(--muted);
      font-size: 11px;
      text-transform: lowercase;
      white-space: nowrap;
    }

    .tree-row.selected .file-meta {
      color: color-mix(in srgb, var(--surface-active-fg) 72%, transparent);
    }

    .commit-header {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
      padding: 8px 14px;
      border-bottom: 1px solid var(--border-soft);
      background: var(--editor-bg);
    }

    .amend-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }

    .amend-label input {
      width: 15px;
      height: 15px;
      margin: 0;
      accent-color: var(--blue);
    }

    .last-commit {
      min-width: 0;
      max-width: 420px;
      overflow: hidden;
      padding: 2px 4px;
      color: var(--vscode-textLink-foreground);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .header-icon {
      width: 28px;
      height: 26px;
      color: var(--muted);
    }

    .ai-button {
      width: auto;
      min-width: 82px;
      height: 26px;
      padding: 0 9px;
      color: var(--text);
      background: var(--vscode-button-secondaryBackground, transparent);
      border: 1px solid var(--border-soft);
    }

    .commit-editor-wrap {
      position: relative;
      min-height: 0;
      display: grid;
      padding: 0 14px 14px;
    }

    .commit-message {
      width: 100%;
      height: 100%;
      min-height: 180px;
      resize: none;
      color: var(--vscode-input-foreground);
      background: var(--input-bg);
      border: 1px solid var(--input-border, var(--border-soft));
      outline: none;
      padding: 10px 12px;
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      line-height: 1.45;
    }

    .commit-message:focus {
      border-color: var(--accent);
    }

    .busy-overlay {
      position: absolute;
      inset: 0 14px 14px;
      display: none;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 12px;
      color: var(--muted);
      background: color-mix(in srgb, var(--editor-bg) 86%, transparent);
      pointer-events: none;
    }

    .busy-overlay.visible {
      display: flex;
    }

    .spinner {
      width: 34px;
      height: 34px;
      border: 4px solid color-mix(in srgb, var(--muted) 28%, transparent);
      border-top-color: var(--muted);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .commit-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      background: var(--editor-bg);
      border-top: 1px solid var(--border-soft);
    }

    .primary {
      height: 30px;
      min-width: 92px;
      padding: 0 18px;
      color: var(--blue-fg);
      background: var(--blue);
      border-radius: 4px;
      font-weight: 600;
    }

    .primary:hover:not(:disabled) {
      background: var(--blue-hover);
    }

    .secondary {
      height: 30px;
      min-width: 166px;
      padding: 0 16px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      border-radius: 4px;
    }

    .secondary:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .footer-status {
      min-width: 0;
      overflow: hidden;
      color: var(--muted);
      margin-left: 8px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .footer-status.error {
      color: var(--danger);
    }

    .gear {
      width: 28px;
      height: 28px;
      margin-left: auto;
      color: var(--muted);
      font-size: 16px;
    }

    @media (max-width: 760px) {
      .shell {
        grid-template-columns: 1fr;
        grid-template-rows: 44% 6px 56%;
        min-width: 0;
      }

      .left {
        border-right: 0;
        border-bottom: 1px solid var(--border-soft);
      }

      .splitter {
        cursor: row-resize;
      }
    }
  </style>
</head>
<body>
  <main id="shell" class="shell">
    <section class="left" aria-label="Changes">
      <div class="toolbar">
        <button id="refresh" class="tool-button" title="Refresh">&#x21BB;</button>
        <button id="unstage-all" class="tool-button" title="Uncheck all changes">&minus;</button>
        <button id="stage-all" class="tool-button" title="Check all changes">+</button>
        <span class="tool-separator" aria-hidden="true"></span>
        <button id="open-selected" class="tool-button" title="Open selected change">&#x25CE;</button>
        <span class="spacer"></span>
        <select id="repo-select" class="repo-select" title="Repository"></select>
      </div>
      <div class="changes-header">
        <span class="disclosure" aria-hidden="true">&#x25BE;</span>
        <span class="changes-title">Changes</span>
        <span id="changes-count" class="changes-count">0</span>
        <span id="changes-summary" class="changes-summary">updating...</span>
      </div>
      <div id="changes-list" class="changes-list" role="listbox" aria-label="Changed files"></div>
    </section>

    <div id="splitter" class="splitter" role="separator" aria-orientation="vertical" aria-label="Resize changes and commit panels" tabindex="0"></div>

    <section class="right" aria-label="Commit">
      <div class="commit-header">
        <label class="amend-label" title="Amend the last commit">
          <input id="amend" type="checkbox">
          <span>Amend</span>
        </label>
        <button id="last-commit" class="last-commit" title="Last commit">last commit&#x2304;</button>
        <span class="spacer"></span>
        <button id="history" class="header-icon" title="History">&#x25F7;</button>
        <button id="generate" class="ai-button" title="Generate commit message with VS Code Language Model API">Generate</button>
      </div>

      <div class="commit-editor-wrap">
        <textarea id="message" class="commit-message" spellcheck="false" placeholder="Commit message"></textarea>
        <div id="busy-overlay" class="busy-overlay" aria-live="polite">
          <div class="spinner" aria-hidden="true"></div>
          <div id="busy-text">Loading...</div>
        </div>
      </div>

      <div class="commit-footer">
        <button id="commit" class="primary">Commit</button>
        <button id="commit-push" class="secondary">Commit and Push...</button>
        <div id="footer-status" class="footer-status"></div>
        <button id="settings" class="gear" title="Settings">&#x2699;</button>
      </div>
    </section>
  </main>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const elements = {};
      const persisted = vscode.getState() || {};
      let state = {
        repositories: [],
        changes: [],
        message: '',
        amend: false,
        busy: false,
        statusText: 'Loading...',
        stagedCount: 0,
        totalCount: 0
      };
      const minLeftPaneWidth = 260;
      const minRightPaneWidth = 320;
      const splitterWidth = 12;
      let selectedPath = '';
      let leftPaneWidth = Number.isFinite(Number(persisted.leftPaneWidth))
        ? Number(persisted.leftPaneWidth)
        : 520;
      let collapsedFolders = new Set(Array.isArray(persisted.collapsedFolders)
        ? persisted.collapsedFolders
        : []);
      let dragStart = null;

      window.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'state') {
          state = event.data.state || state;
          render();
        }
      });

      document.addEventListener('DOMContentLoaded', function () {
        cacheElements();
        applyPaneSize();
        bindEvents();
        vscode.postMessage({ type: 'ready' });
      });

      function cacheElements() {
        [
          'shell',
          'splitter',
          'refresh',
          'unstage-all',
          'stage-all',
          'open-selected',
          'repo-select',
          'changes-count',
          'changes-summary',
          'changes-list',
          'amend',
          'last-commit',
          'history',
          'generate',
          'message',
          'busy-overlay',
          'busy-text',
          'commit',
          'commit-push',
          'footer-status',
          'settings'
        ].forEach(function (id) {
          elements[id] = document.getElementById(id);
        });
      }

      function bindEvents() {
        elements.refresh.addEventListener('click', function () {
          vscode.postMessage({ type: 'refresh' });
        });
        elements['stage-all'].addEventListener('click', function () {
          vscode.postMessage({ type: 'stageAll' });
        });
        elements['unstage-all'].addEventListener('click', function () {
          vscode.postMessage({ type: 'unstageAll' });
        });
        elements['open-selected'].addEventListener('click', function () {
          if (selectedPath) {
            vscode.postMessage({ type: 'openDiff', path: selectedPath });
          }
        });
        elements['repo-select'].addEventListener('change', function (event) {
          vscode.postMessage({ type: 'selectRepository', root: event.target.value });
        });
        elements.amend.addEventListener('change', function (event) {
          vscode.postMessage({ type: 'setAmend', amend: event.target.checked });
        });
        elements.generate.addEventListener('click', function () {
          vscode.postMessage({ type: 'generateCommitMessage' });
        });
        elements.message.addEventListener('input', function (event) {
          vscode.postMessage({ type: 'setMessage', message: event.target.value });
        });
        elements.commit.addEventListener('click', function () {
          vscode.postMessage({ type: 'commit' });
        });
        elements['commit-push'].addEventListener('click', function () {
          vscode.postMessage({ type: 'commitAndPush' });
        });
        elements.settings.addEventListener('click', function () {
          vscode.postMessage({ type: 'openSettings' });
        });
        elements['last-commit'].addEventListener('click', function () {
          if (state.lastCommit) {
            elements.message.focus();
          }
        });
        elements.history.addEventListener('click', function () {
          vscode.postMessage({ type: 'refresh' });
        });
        elements.splitter.addEventListener('pointerdown', startResize);
        elements.splitter.addEventListener('dblclick', resetPaneWidth);
        elements.splitter.addEventListener('keydown', resizeWithKeyboard);
        window.addEventListener('resize', applyPaneSize);
      }

      function startResize(event) {
        event.preventDefault();
        dragStart = {
          pointerId: event.pointerId
        };
        elements.splitter.classList.add('dragging');
        document.body.classList.add('resizing');
        elements.splitter.setPointerCapture(event.pointerId);
        elements.splitter.addEventListener('pointermove', moveResize);
        elements.splitter.addEventListener('pointerup', stopResize);
        elements.splitter.addEventListener('pointercancel', stopResize);
      }

      function moveResize(event) {
        if (!dragStart) {
          return;
        }

        const rect = elements.shell.getBoundingClientRect();
        const maxLeft = maxLeftPaneWidth(rect);
        const next = clamp(event.clientX - rect.left, minLeftPaneWidth, maxLeft);
        setLeftPaneWidth(next);
      }

      function stopResize(event) {
        if (!dragStart) {
          return;
        }

        if (elements.splitter.hasPointerCapture(dragStart.pointerId)) {
          elements.splitter.releasePointerCapture(dragStart.pointerId);
        }
        dragStart = null;
        elements.splitter.classList.remove('dragging');
        document.body.classList.remove('resizing');
        elements.splitter.removeEventListener('pointermove', moveResize);
        elements.splitter.removeEventListener('pointerup', stopResize);
        elements.splitter.removeEventListener('pointercancel', stopResize);
        persistUiState();
      }

      function resizeWithKeyboard(event) {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(event.key)) {
          return;
        }

        event.preventDefault();
        const rect = elements.shell.getBoundingClientRect();
        const current = currentLeftPanePixels(rect);
        const maxLeft = maxLeftPaneWidth(rect);
        let next = current;

        if (event.key === 'ArrowLeft') {
          next = current - 24;
        } else if (event.key === 'ArrowRight') {
          next = current + 24;
        } else if (event.key === 'Home') {
          next = minLeftPaneWidth;
        } else if (event.key === 'End') {
          next = maxLeft;
        }

        setLeftPaneWidth(clamp(next, minLeftPaneWidth, maxLeft));
        persistUiState();
      }

      function resetPaneWidth() {
        leftPaneWidth = Math.round(elements.shell.getBoundingClientRect().width * 0.5);
        applyPaneSize();
        persistUiState();
      }

      function setLeftPaneWidth(value) {
        leftPaneWidth = value;
        applyPaneSize();
      }

      function applyPaneSize() {
        if (!elements.shell) {
          return;
        }

        const rect = elements.shell.getBoundingClientRect();
        if (rect.width > 0) {
          leftPaneWidth = clamp(leftPaneWidth, minLeftPaneWidth, maxLeftPaneWidth(rect));
        }

        elements.shell.style.setProperty('--left-pane-width', leftPaneWidth + 'px');
      }

      function persistUiState() {
        const nextState = Object.assign({}, vscode.getState() || {}, {
          leftPaneWidth: leftPaneWidth,
          collapsedFolders: Array.from(collapsedFolders)
        });
        vscode.setState(nextState);
      }

      function currentLeftPanePixels(shellRect) {
        return clamp(leftPaneWidth, minLeftPaneWidth, maxLeftPaneWidth(shellRect));
      }

      function maxLeftPaneWidth(shellRect) {
        return Math.max(minLeftPaneWidth, shellRect.width - minRightPaneWidth - splitterWidth);
      }

      function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
      }

      function render() {
        renderRepositories();
        renderChanges();
        renderCommitPanel();
      }

      function renderRepositories() {
        const select = elements['repo-select'];
        const repositories = state.repositories || [];
        select.replaceChildren();
        select.hidden = repositories.length < 2;

        repositories.forEach(function (repo) {
          const option = document.createElement('option');
          option.value = repo.root;
          option.textContent = repo.name;
          option.selected = repo.root === state.selectedRoot;
          select.appendChild(option);
        });
      }

      function renderChanges() {
        elements['changes-count'].textContent = String(state.totalCount || 0);
        elements['changes-summary'].textContent = state.busy
          ? 'updating...'
          : changeSummary();
        elements['changes-list'].replaceChildren();

        const changes = state.changes || [];
        if (!state.selectedRoot) {
          elements['changes-list'].appendChild(empty('No Git repository', 'Open a folder that contains a Git repository.'));
          selectedPath = '';
          return;
        }

        if (changes.length === 0) {
          elements['changes-list'].appendChild(empty('No local changes', 'Edit files in this repository. Checked files will be staged automatically.'));
          selectedPath = '';
          return;
        }

        if (!selectedPath || !changes.some(function (change) { return change.path === selectedPath; })) {
          selectedPath = changes[0].path;
        }

        const tree = buildChangeTree(changes);
        const fragment = document.createDocumentFragment();

        tree.children.forEach(function (node) {
          appendTreeNode(fragment, node, 0);
        });

        elements['changes-list'].appendChild(fragment);
      }

      function buildChangeTree(changes) {
        const root = folderNode('', '');

        changes.forEach(function (change) {
          const parts = String(change.path || '').split('/').filter(Boolean);
          let parent = root;
          let currentPath = '';

          parts.slice(0, -1).forEach(function (part) {
            currentPath = currentPath ? currentPath + '/' + part : part;

            if (!parent.folders.has(part)) {
              const child = folderNode(part, currentPath);
              parent.folders.set(part, child);
              parent.children.push(child);
            }

            parent = parent.folders.get(part);
          });

          parent.children.push({
            type: 'file',
            name: parts[parts.length - 1] || change.path,
            path: change.path,
            change: change,
            fileCount: 1,
            stagedCount: change.staged ? 1 : 0
          });
        });

        finalizeFolder(root);
        return root;
      }

      function folderNode(name, path) {
        return {
          type: 'folder',
          name: name,
          path: path,
          folders: new Map(),
          children: [],
          fileCount: 0,
          stagedCount: 0
        };
      }

      function finalizeFolder(node) {
        node.fileCount = 0;
        node.stagedCount = 0;

        node.children.forEach(function (child) {
          if (child.type === 'folder') {
            finalizeFolder(child);
          }

          node.fileCount += child.fileCount;
          node.stagedCount += child.stagedCount;
        });

        node.children.sort(function (left, right) {
          if (left.type === 'folder' && right.type !== 'folder') {
            return -1;
          }

          if (left.type !== 'folder' && right.type === 'folder') {
            return 1;
          }

          return left.name.localeCompare(right.name);
        });
      }

      function appendTreeNode(parent, node, depth) {
        if (node.type === 'folder') {
          parent.appendChild(folderRow(node, depth));

          if (isFolderExpanded(node)) {
            node.children.forEach(function (child) {
              appendTreeNode(parent, child, depth + 1);
            });
          }

          return;
        }

        parent.appendChild(fileRow(node.change, depth));
      }

      function folderRow(node, depth) {
        const row = document.createElement('div');
        const expanded = isFolderExpanded(node);
        const allChecked = node.fileCount > 0 && node.stagedCount === node.fileCount;
        const partiallyChecked = node.stagedCount > 0 && node.stagedCount < node.fileCount;

        row.className = 'tree-row folder-row';
        row.style.paddingLeft = treePadding(depth);
        row.title = node.path + '\\n' + node.stagedCount + '/' + node.fileCount + ' checked';

        const disclosure = document.createElement('button');
        disclosure.className = 'disclosure-button';
        disclosure.type = 'button';
        disclosure.title = expanded ? 'Collapse folder' : 'Expand folder';
        disclosure.textContent = expanded ? '\\u25BE' : '\\u25B8';
        disclosure.addEventListener('click', function (event) {
          event.stopPropagation();
          toggleFolder(node.path);
        });

        const checkbox = document.createElement('input');
        checkbox.className = 'file-checkbox';
        checkbox.type = 'checkbox';
        checkbox.checked = allChecked;
        checkbox.indeterminate = partiallyChecked;
        checkbox.disabled = Boolean(state.busy);
        checkbox.addEventListener('click', function (event) {
          event.stopPropagation();
        });
        checkbox.addEventListener('change', function (event) {
          vscode.postMessage({
            type: 'toggleChanges',
            paths: collectFilePaths(node),
            checked: event.target.checked
          });
        });

        const icon = document.createElement('span');
        icon.className = 'folder-icon';
        icon.textContent = '\\u25A3';

        const name = document.createElement('span');
        name.className = 'folder-main';
        name.textContent = node.name;

        const count = document.createElement('span');
        count.className = 'folder-count';
        count.textContent = node.stagedCount + '/' + node.fileCount;

        row.appendChild(disclosure);
        row.appendChild(checkbox);
        row.appendChild(icon);
        row.appendChild(name);
        row.appendChild(count);
        row.addEventListener('click', function () {
          toggleFolder(node.path);
        });

        return row;
      }

      function fileRow(change, depth) {
        const row = document.createElement('div');
        row.className = 'tree-row file-row' + (change.path === selectedPath ? ' selected' : '');
        row.style.paddingLeft = treePadding(depth);
        row.title = change.path + '\\n' + (change.staged ? 'Checked / staged' : 'Unchecked / unstaged');
        row.dataset.path = change.path;

        const spacer = document.createElement('span');
        spacer.className = 'disclosure-button';
        spacer.setAttribute('aria-hidden', 'true');

        const checkbox = document.createElement('input');
        checkbox.className = 'file-checkbox';
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(change.staged);
        checkbox.disabled = Boolean(state.busy);
        checkbox.addEventListener('click', function (event) {
          event.stopPropagation();
        });
        checkbox.addEventListener('change', function (event) {
          vscode.postMessage({
            type: 'toggleChange',
            path: change.path,
            checked: event.target.checked
          });
        });

        const status = document.createElement('span');
        status.className = 'status ' + (change.kind || 'changed');
        status.textContent = statusLabel(change);

        const main = document.createElement('span');
        main.className = 'file-main';

        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = baseName(change.path);

        const dir = document.createElement('span');
        dir.className = 'file-path';
        dir.textContent = directoryName(change.path) || 'workspace root';

        const meta = document.createElement('span');
        meta.className = 'file-meta';
        meta.textContent = change.kind || 'changed';

        main.appendChild(name);
        main.appendChild(dir);
        row.appendChild(spacer);
        row.appendChild(checkbox);
        row.appendChild(status);
        row.appendChild(main);
        row.appendChild(meta);
        row.addEventListener('click', function () {
          selectedPath = change.path;
          renderChanges();
        });
        row.addEventListener('dblclick', function () {
          vscode.postMessage({ type: 'openDiff', path: change.path });
        });

        return row;
      }

      function isFolderExpanded(node) {
        return !collapsedFolders.has(node.path);
      }

      function toggleFolder(path) {
        if (collapsedFolders.has(path)) {
          collapsedFolders.delete(path);
        } else {
          collapsedFolders.add(path);
        }

        persistUiState();
        renderChanges();
      }

      function collectFilePaths(node) {
        if (node.type === 'file') {
          return [node.path];
        }

        return node.children.flatMap(collectFilePaths);
      }

      function treePadding(depth) {
        return 7 + depth * 18 + 'px';
      }

      function renderCommitPanel() {
        const message = state.message || '';
        const textarea = elements.message;

        if (document.activeElement !== textarea && textarea.value !== message) {
          textarea.value = message;
        }

        elements.amend.checked = Boolean(state.amend);
        elements['last-commit'].textContent = (state.lastCommit || 'last commit') + '\\u2304';
        elements['busy-overlay'].classList.toggle('visible', Boolean(state.busy));
        elements['busy-text'].textContent = state.busyText || 'Loading...';

        const hasMessage = textarea.value.trim().length > 0;
        const hasRepo = Boolean(state.selectedRoot);
        elements.commit.disabled = Boolean(state.busy) || !hasRepo || !hasMessage;
        elements['commit-push'].disabled = Boolean(state.busy) || !hasRepo || !hasMessage;
        elements.generate.disabled = Boolean(state.busy) || !hasRepo || !state.canGenerate;
        elements['stage-all'].disabled = Boolean(state.busy) || !hasRepo || state.totalCount === 0;
        elements['unstage-all'].disabled = Boolean(state.busy) || !hasRepo || state.stagedCount === 0;
        elements['open-selected'].disabled = Boolean(state.busy) || !selectedPath;

        elements['footer-status'].textContent = state.errorText || state.statusText || '';
        elements['footer-status'].classList.toggle('error', Boolean(state.errorText));
      }

      function changeSummary() {
        const total = state.totalCount || 0;
        const staged = state.stagedCount || 0;

        if (total === 0) {
          return 'clean';
        }

        return staged + '/' + total + ' checked';
      }

      function empty(title, text) {
        const node = document.createElement('div');
        node.className = 'empty';

        const titleNode = document.createElement('div');
        titleNode.className = 'empty-title';
        titleNode.textContent = title;

        const textNode = document.createElement('div');
        textNode.className = 'empty-text';
        textNode.textContent = text;

        node.appendChild(titleNode);
        node.appendChild(textNode);

        return node;
      }

      function statusLabel(change) {
        if (change.kind === 'untracked') {
          return '?';
        }
        if (change.kind === 'added') {
          return 'A';
        }
        if (change.kind === 'deleted') {
          return 'D';
        }
        if (change.kind === 'renamed') {
          return 'R';
        }
        if (change.kind === 'copied') {
          return 'C';
        }
        if (change.kind === 'conflict') {
          return '!';
        }
        return 'M';
      }

      function baseName(filePath) {
        const parts = String(filePath || '').split('/');
        return parts[parts.length - 1] || filePath;
      }

      function directoryName(filePath) {
        const parts = String(filePath || '').split('/');
        parts.pop();
        return parts.join('/');
      }
    }());
  </script>
</body>
</html>`;
}

function getNonce() {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let i = 0; i < 32; i += 1) {
    nonce += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return nonce;
}

module.exports = {
  renderWebview
};
