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
      --border: var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      --muted: var(--vscode-descriptionForeground);
      --text: var(--vscode-foreground);
      --blue: var(--vscode-button-background);
      --blue-fg: var(--vscode-button-foreground);
      --blue-hover: var(--vscode-button-hoverBackground);
      --input-bg: var(--vscode-input-background);
      --input-border: var(--vscode-input-border);
      --row-hover: var(--vscode-list-hoverBackground);
      --row-active: var(--vscode-list-activeSelectionBackground);
      --row-active-fg: var(--vscode-list-activeSelectionForeground);
      --danger: var(--vscode-errorForeground);
      --success: var(--vscode-gitDecoration-addedResourceForeground);
      --modified: var(--vscode-gitDecoration-modifiedResourceForeground);
      --deleted: var(--vscode-gitDecoration-deletedResourceForeground);
      --untracked: var(--vscode-gitDecoration-untrackedResourceForeground);
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
      border-radius: 3px;
      cursor: pointer;
    }

    button:hover:not(:disabled) {
      background: var(--row-hover);
    }

    button:disabled {
      cursor: default;
      opacity: 0.45;
    }

    .shell {
      display: grid;
      grid-template-columns: minmax(280px, 40%) minmax(360px, 1fr);
      height: 100vh;
      min-width: 680px;
    }

    .left,
    .right {
      min-width: 0;
      min-height: 0;
    }

    .left {
      display: grid;
      grid-template-rows: 34px 34px 1fr;
      border-right: 1px solid var(--border);
      background: var(--panel-bg);
    }

    .right {
      display: grid;
      grid-template-rows: 46px 1fr 44px;
      background: var(--editor-bg);
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-bottom: 1px solid var(--border);
      min-width: 0;
    }

    .toolbar .spacer {
      flex: 1;
    }

    .tool-button {
      width: 26px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      font-weight: 600;
    }

    .repo-select {
      min-width: 0;
      max-width: 210px;
      color: var(--text);
      background: var(--input-bg);
      border: 1px solid var(--input-border, transparent);
      border-radius: 3px;
      padding: 2px 6px;
    }

    .changes-banner {
      margin: 8px 14px;
      height: 25px;
      padding: 4px 18px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-radius: 4px;
      color: var(--blue-fg);
      background: var(--blue);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
    }

    .banner-status {
      color: color-mix(in srgb, var(--blue-fg) 75%, transparent);
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      font-weight: 400;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .changes-list {
      overflow: auto;
      padding: 2px 0 12px;
    }

    .empty {
      padding: 18px 22px;
      color: var(--muted);
      line-height: 1.45;
    }

    .file-row {
      display: grid;
      grid-template-columns: 24px 18px minmax(0, 1fr) auto;
      align-items: center;
      gap: 6px;
      min-height: 28px;
      padding: 3px 12px 3px 14px;
      cursor: default;
    }

    .file-row:hover {
      background: var(--row-hover);
    }

    .file-row.selected {
      color: var(--row-active-fg);
      background: var(--row-active);
    }

    .file-checkbox {
      width: 15px;
      height: 15px;
      margin: 0;
      accent-color: var(--blue);
      cursor: pointer;
    }

    .status {
      width: 18px;
      text-align: center;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      font-weight: 700;
    }

    .status.added,
    .status.copied {
      color: var(--success);
    }

    .status.modified,
    .status.renamed,
    .status.changed {
      color: var(--modified);
    }

    .status.deleted {
      color: var(--deleted);
    }

    .status.untracked {
      color: var(--untracked);
    }

    .status.conflict {
      color: var(--danger);
    }

    .file-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-path {
      color: var(--muted);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 180px;
    }

    .commit-header {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
      padding: 8px 14px;
      border-bottom: 1px solid var(--border);
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
      color: var(--vscode-textLink-foreground);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 420px;
      padding: 2px 4px;
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
      border: 1px solid var(--border);
      background: var(--vscode-button-secondaryBackground, transparent);
    }

    .commit-editor-wrap {
      position: relative;
      min-height: 0;
      padding: 0 14px 14px;
      display: grid;
    }

    .commit-message {
      width: 100%;
      height: 100%;
      min-height: 180px;
      resize: none;
      color: var(--vscode-input-foreground);
      background: var(--input-bg);
      border: 1px solid var(--input-border, var(--border));
      outline: none;
      padding: 10px 12px;
      line-height: 1.45;
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
    }

    .commit-message:focus {
      border-color: var(--vscode-focusBorder);
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
      border-top: 1px solid var(--border);
      background: var(--editor-bg);
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
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--muted);
      margin-left: 8px;
    }

    .footer-status.error {
      color: var(--danger);
    }

    .gear {
      margin-left: auto;
      width: 28px;
      height: 28px;
      color: var(--muted);
      font-size: 16px;
    }

    @media (max-width: 760px) {
      .shell {
        grid-template-columns: 1fr;
        grid-template-rows: 44% 56%;
        min-width: 0;
      }

      .left {
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="left" aria-label="Changes">
      <div class="toolbar">
        <button id="refresh" class="tool-button" title="Refresh">↻</button>
        <button id="unstage-all" class="tool-button" title="Uncheck all changes">−</button>
        <button id="stage-all" class="tool-button" title="Check all changes">＋</button>
        <button id="open-selected" class="tool-button" title="Open selected change">◉</button>
        <span class="spacer"></span>
        <select id="repo-select" class="repo-select" title="Repository"></select>
      </div>
      <div id="changes-banner" class="changes-banner">
        <span>Changes</span>
        <span id="banner-status" class="banner-status">updating...</span>
      </div>
      <div id="changes-list" class="changes-list" role="listbox" aria-label="Changed files"></div>
    </section>

    <section class="right" aria-label="Commit">
      <div class="commit-header">
        <label class="amend-label" title="Amend the last commit">
          <input id="amend" type="checkbox">
          <span>Amend</span>
        </label>
        <button id="last-commit" class="last-commit" title="Last commit">last commit⌄</button>
        <span class="spacer"></span>
        <button id="history" class="header-icon" title="History">◷</button>
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
        <button id="settings" class="gear" title="Settings">⚙</button>
      </div>
    </section>
  </main>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const elements = {};
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
      let selectedPath = '';

      window.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'state') {
          state = event.data.state || state;
          render();
        }
      });

      document.addEventListener('DOMContentLoaded', function () {
        cacheElements();
        bindEvents();
        vscode.postMessage({ type: 'ready' });
      });

      function cacheElements() {
        [
          'refresh',
          'unstage-all',
          'stage-all',
          'open-selected',
          'repo-select',
          'banner-status',
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
        elements['banner-status'].textContent = state.busy ? 'updating...' : state.statusText;
        elements['changes-list'].replaceChildren();

        const changes = state.changes || [];
        if (!state.selectedRoot) {
          elements['changes-list'].appendChild(empty('No Git repository found in the current workspace.'));
          selectedPath = '';
          return;
        }

        if (changes.length === 0) {
          elements['changes-list'].appendChild(empty('No changes.'));
          selectedPath = '';
          return;
        }

        if (!selectedPath || !changes.some(function (change) { return change.path === selectedPath; })) {
          selectedPath = changes[0].path;
        }

        changes.forEach(function (change) {
          elements['changes-list'].appendChild(fileRow(change));
        });
      }

      function fileRow(change) {
        const row = document.createElement('div');
        row.className = 'file-row' + (change.path === selectedPath ? ' selected' : '');
        row.title = change.path + '\\n' + (change.staged ? 'Checked / staged' : 'Unchecked / unstaged');
        row.dataset.path = change.path;

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

        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = baseName(change.path);

        const dir = document.createElement('span');
        dir.className = 'file-path';
        dir.textContent = directoryName(change.path);

        row.appendChild(checkbox);
        row.appendChild(status);
        row.appendChild(name);
        row.appendChild(dir);
        row.addEventListener('click', function () {
          selectedPath = change.path;
          renderChanges();
        });
        row.addEventListener('dblclick', function () {
          vscode.postMessage({ type: 'openDiff', path: change.path });
        });

        return row;
      }

      function renderCommitPanel() {
        const message = state.message || '';
        const textarea = elements.message;

        if (document.activeElement !== textarea && textarea.value !== message) {
          textarea.value = message;
        }

        elements.amend.checked = Boolean(state.amend);
        elements['last-commit'].textContent = (state.lastCommit || 'last commit') + '⌄';
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

      function empty(text) {
        const node = document.createElement('div');
        node.className = 'empty';
        node.textContent = text;
        return node;
      }

      function statusLabel(change) {
        if (change.kind === 'untracked') {
          return 'U';
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
