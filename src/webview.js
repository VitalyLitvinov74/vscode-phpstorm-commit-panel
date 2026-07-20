'use strict';

const fs = require('fs');
const path = require('path');

let vscodeModule;

function renderWebview(webview, fileIconThemeSource) {
  const nonce = getNonce();
  const activeFileIcons = buildFileIconTheme(webview, fileIconThemeSource);

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
      --checkbox-bg: var(--vscode-checkbox-background, var(--input-bg));
      --checkbox-border: var(--vscode-checkbox-border, color-mix(in srgb, var(--muted) 58%, transparent));
      --checkbox-checked-bg: color-mix(in srgb, var(--vscode-checkbox-selectBackground, var(--accent)) 42%, var(--checkbox-bg) 58%);
      --checkbox-checked-border: color-mix(in srgb, var(--vscode-checkbox-selectBorder, var(--accent)) 50%, var(--checkbox-border) 50%);
      --checkbox-mark: var(--vscode-checkbox-selectForeground, var(--vscode-checkbox-foreground, var(--text)));
      --danger: var(--vscode-errorForeground);
      --success: var(--vscode-gitDecoration-addedResourceForeground);
      --modified: var(--vscode-gitDecoration-modifiedResourceForeground);
      --deleted: var(--vscode-gitDecoration-deletedResourceForeground);
      --untracked: var(--vscode-gitDecoration-untrackedResourceForeground);
      --left-pane-width: 42vw;
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
      font-weight: 400;
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
      grid-template-rows: 30px 28px 1fr;
      background: var(--panel-bg);
      border-right: 1px solid var(--border-soft);
    }

    .right {
      display: grid;
      grid-template-rows: 42px 1fr 42px;
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
      position: relative;
      display: flex;
      align-items: center;
      gap: 0;
      min-width: 0;
      overflow: visible;
      padding: 3px 7px;
      border-bottom: 1px solid var(--border-soft);
      background: color-mix(in srgb, var(--panel-bg) 82%, var(--editor-bg) 18%);
    }

    .toolbar .spacer,
    .commit-header .spacer {
      flex: 1;
    }

    .toolbar-group {
      display: inline-flex;
      align-items: center;
      gap: 1px;
      min-width: 0;
    }

    .tool-button {
      position: relative;
      width: 24px;
      height: 22px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      font-size: 13px;
      font-weight: 400;
      line-height: 1;
      border-radius: 3px;
    }

    .tool-button svg {
      width: 15px;
      height: 15px;
      display: block;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.92;
    }

    .tool-button:hover:not(:disabled) {
      color: var(--text);
    }

    .tool-button.active {
      color: var(--text);
      background: color-mix(in srgb, var(--surface-hover) 70%, transparent);
    }

    .tool-button.active::after {
      content: '';
      position: absolute;
      right: 3px;
      bottom: 2px;
      left: 3px;
      height: 1px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 60%, transparent);
    }

    .tool-separator {
      width: 1px;
      height: 17px;
      margin: 0 7px;
      background: var(--border-soft);
    }

    .toolbar-menu {
      position: absolute;
      z-index: 10;
      top: 30px;
      left: 184px;
      width: 284px;
      padding: 9px 10px 10px;
      color: var(--text);
      background: color-mix(in srgb, var(--editor-bg) 88%, var(--panel-bg) 12%);
      border: 1px solid color-mix(in srgb, var(--border-soft) 75%, transparent);
      border-radius: 7px;
      box-shadow: 0 8px 24px color-mix(in srgb, black 36%, transparent);
    }

    .toolbar-menu[hidden] {
      display: none;
    }

    .menu-section-title {
      padding: 4px 8px 5px;
      color: color-mix(in srgb, var(--muted) 84%, transparent);
      font-size: 11px;
      font-weight: 400;
      text-transform: none;
    }

    .menu-item {
      width: 100%;
      height: 25px;
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
      padding: 0 8px;
      color: var(--text);
      border-radius: 4px;
      text-align: left;
    }

    .menu-item.selected {
      color: var(--surface-active-fg);
      background: color-mix(in srgb, var(--surface-active) 86%, var(--accent) 14%);
    }

    .menu-check {
      color: inherit;
      font-size: 11px;
      text-align: center;
    }

    .menu-shortcut {
      color: color-mix(in srgb, currentColor 78%, transparent);
      font-size: 11px;
    }

    .menu-item:disabled {
      opacity: 0.62;
    }

    .repo-select {
      min-width: 0;
      max-width: 230px;
      height: 22px;
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
      gap: 6px;
      padding: 0 8px;
      border-bottom: 1px solid var(--border-soft);
      background: color-mix(in srgb, var(--panel-bg) 72%, var(--editor-bg) 28%);
    }

    .disclosure {
      width: 16px;
      height: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: color-mix(in srgb, var(--muted) 88%, var(--text) 12%);
    }

    .disclosure::before {
      content: '';
      width: 0;
      height: 0;
      border-style: solid;
      border-width: 5px 4px 0 4px;
      border-color: currentColor transparent transparent transparent;
      transform: translateY(1px);
    }

    .changes-title {
      min-width: 0;
      overflow: hidden;
      color: var(--text);
      font-weight: 400;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .changes-count {
      height: 18px;
      min-width: 22px;
      padding: 1px 6px;
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
      padding: 2px 4px 8px;
    }

    .empty {
      margin: 6px 3px;
      padding: 10px 11px;
      color: var(--muted);
      background: color-mix(in srgb, var(--surface-soft) 45%, transparent);
      border: 1px solid var(--border-soft);
      border-radius: 4px;
      line-height: 1.45;
    }

    .empty-title {
      color: var(--text);
      font-weight: 400;
      margin-bottom: 5px;
    }

    .empty-text {
      max-width: 420px;
    }

    .tree-row {
      display: grid;
      grid-template-columns: 18px 16px 16px minmax(0, 1fr) 30px;
      align-items: center;
      gap: 4px;
      min-height: 22px;
      padding: 0 4px;
      border: 1px solid transparent;
      border-radius: 2px;
      cursor: default;
    }

    .tree-row + .tree-row {
      margin-top: 0;
    }

    .tree-row:hover {
      background: var(--surface-hover);
    }

    .tree-row.selected {
      color: var(--surface-active-fg);
      background: var(--surface-active);
    }

    .disclosure-button {
      width: 18px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: color-mix(in srgb, var(--muted) 86%, var(--text) 14%);
      line-height: 1;
    }

    .disclosure-button::before {
      content: '';
      width: 0;
      height: 0;
      border-style: solid;
      opacity: 0.9;
    }

    .disclosure-button.collapsed::before {
      margin-left: 2px;
      border-width: 4.5px 0 4.5px 6px;
      border-color: transparent transparent transparent currentColor;
    }

    .disclosure-button.expanded::before {
      margin-top: 1px;
      border-width: 6px 4.5px 0 4.5px;
      border-color: currentColor transparent transparent transparent;
    }

    .disclosure-spacer {
      width: 18px;
      height: 20px;
    }

    .tree-row:hover .disclosure-button,
    .tree-row.selected .disclosure-button {
      color: currentColor;
    }

    .entry-icon {
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 16px;
      pointer-events: none;
    }

    .theme-icon-img {
      width: 16px;
      height: 16px;
      display: block;
      object-fit: contain;
    }

    .file-checkbox,
    .amend-label input {
      appearance: none;
      display: inline-grid;
      place-content: center;
      width: 13px;
      height: 13px;
      margin: 0;
      background: var(--checkbox-bg);
      border: 1px solid var(--checkbox-border);
      border-radius: 2px;
      cursor: pointer;
    }

    .file-checkbox::before,
    .amend-label input::before {
      content: '';
      width: 7px;
      height: 4px;
      border-left: 2px solid var(--checkbox-mark);
      border-bottom: 2px solid var(--checkbox-mark);
      opacity: 0;
      transform: rotate(-45deg) translate(0, -1px);
    }

    .file-checkbox:checked,
    .amend-label input:checked,
    .file-checkbox:indeterminate {
      background: var(--checkbox-checked-bg);
      border-color: var(--checkbox-checked-border);
    }

    .file-checkbox:checked::before,
    .amend-label input:checked::before {
      opacity: 0.86;
    }

    .file-checkbox:indeterminate::before {
      width: 7px;
      height: 0;
      border-left: 0;
      border-bottom: 2px solid var(--checkbox-mark);
      opacity: 0.86;
      transform: none;
    }

    .file-checkbox:focus-visible,
    .amend-label input:focus-visible {
      outline: 1px solid color-mix(in srgb, var(--accent) 60%, transparent);
      outline-offset: 1px;
    }

    .file-checkbox:disabled,
    .amend-label input:disabled {
      cursor: default;
      opacity: 0.45;
    }

    .status {
      width: 30px;
      height: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10px;
      font-weight: 400;
      justify-self: end;
      text-transform: uppercase;
    }

    .folder-main {
      min-width: 0;
      overflow: hidden;
      color: inherit;
      font-weight: 400;
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

    .file-main {
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .file-name {
      min-width: 0;
      flex: 0 1 auto;
      overflow: hidden;
      color: inherit;
      font-weight: 400;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-directory {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      color: var(--muted);
      font-size: 12px;
      font-weight: 400;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .commit-header {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      padding: 7px 12px;
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
      width: 14px;
      height: 14px;
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

    .last-commit[hidden] {
      display: none;
    }

    .header-icon {
      width: 28px;
      height: 26px;
      color: var(--muted);
    }

    .language-select {
      height: 26px;
      min-width: 92px;
      padding: 0 6px;
      color: var(--text);
      background: var(--vscode-dropdown-background, var(--vscode-button-secondaryBackground, transparent));
      border: 1px solid var(--vscode-dropdown-border, var(--border-soft));
      border-radius: 4px;
      outline: none;
    }

    .language-select:focus {
      border-color: var(--accent);
    }

    .language-select:disabled {
      opacity: 0.45;
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
      padding: 0 12px 12px;
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
      padding: 8px 10px;
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      line-height: 1.45;
    }

    .commit-message:focus {
      border-color: var(--accent);
    }

    .busy-overlay {
      position: absolute;
      inset: 0 12px 12px;
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
      padding: 6px 12px;
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
      font-weight: 400;
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
      <div id="changes-toolbar" class="toolbar">
        <div class="toolbar-group" aria-label="Repository actions">
          <button id="refresh" class="tool-button" title="Refresh changes">&#x21BB;</button>
          <button id="unstage-all" class="tool-button" title="Uncheck all changes">&minus;</button>
          <button id="stage-all" class="tool-button" title="Check all changes">+</button>
        </div>
        <span class="tool-separator" aria-hidden="true"></span>
        <div class="toolbar-group" aria-label="View actions">
          <button id="view-mode-toggle" class="tool-button view-mode-toggle active" title="Directory view. Click to show flat list" aria-label="Toggle changes view" aria-pressed="true">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M1.8 8s2.2-4 6.2-4 6.2 4 6.2 4-2.2 4-6.2 4-6.2-4-6.2-4z"></path>
              <circle cx="8" cy="8" r="1.8"></circle>
            </svg>
          </button>
          <button id="group-menu" class="tool-button" title="Group and show options" aria-haspopup="menu" aria-expanded="false">&#x25A4;</button>
        </div>
        <span class="tool-separator" aria-hidden="true"></span>
        <div class="toolbar-group" aria-label="Tree actions">
          <button id="expand-all" class="tool-button" title="Expand all directories" aria-label="Expand all directories">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4.5 5.5 8 9l3.5-3.5"></path>
              <path d="M4.5 9.5 8 13l3.5-3.5"></path>
            </svg>
          </button>
          <button id="collapse-all" class="tool-button" title="Collapse all directories" aria-label="Collapse all directories">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4.5 6.5 8 3l3.5 3.5"></path>
              <path d="M4.5 10.5 8 7l3.5 3.5"></path>
            </svg>
          </button>
        </div>
        <span class="spacer"></span>
        <select id="repo-select" class="repo-select" title="Repository"></select>
        <div id="view-menu" class="toolbar-menu" role="menu" hidden>
          <div class="menu-section-title">Group By</div>
          <button id="group-directory" class="menu-item selected" type="button" role="menuitemcheckbox" aria-checked="true">
            <span class="menu-check">&#x2713;</span>
            <span>Directory</span>
            <span class="menu-shortcut">Ctrl+Alt+P</span>
          </button>
          <button id="group-flat" class="menu-item" type="button" role="menuitemcheckbox" aria-checked="false">
            <span class="menu-check"></span>
            <span>Flat List</span>
            <span class="menu-shortcut"></span>
          </button>
          <div class="menu-section-title">Show</div>
          <button id="show-ignored" class="menu-item" type="button" role="menuitemcheckbox" aria-checked="false" disabled>
            <span class="menu-check"></span>
            <span>Ignored Files</span>
            <span class="menu-shortcut"></span>
          </button>
        </div>
      </div>
      <div class="changes-header">
        <span class="disclosure" aria-hidden="true"></span>
        <span class="changes-title">Changes</span>
        <span id="changes-count" class="changes-count">0</span>
        <span id="changes-summary" class="changes-summary">updating...</span>
      </div>
      <div id="changes-list" class="changes-list" role="listbox" aria-label="Changed files"></div>
    </section>

    <div id="splitter" class="splitter" role="separator" aria-orientation="vertical" aria-label="Resize changes and commit panels" tabindex="0"></div>

    <section class="right" aria-label="Commit">
      <div class="commit-header">
        <label class="amend-label" title="Amend previous commit">
          <input id="amend" type="checkbox">
          <span>Amend</span>
        </label>
        <button id="last-commit" class="last-commit" title="Previous commit" hidden></button>
        <span class="spacer"></span>
        <button id="history" class="header-icon" title="History">&#x25F7;</button>
        <select id="commit-language" class="language-select" title="Commit message language" aria-label="Commit message language">
          <option value="auto">Auto</option>
          <option value="en">English</option>
          <option value="ru">Русский</option>
        </select>
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
      const activeFileIcons = ${serializeForScript(activeFileIcons)};
      const elements = {};
      const persisted = vscode.getState() || {};
      const layoutVersion = 3;
      const hasPersistedPaneWidth = persisted.layoutVersion === layoutVersion
        && Number.isFinite(Number(persisted.leftPaneWidth));
      let state = {
        repositories: [],
        changes: [],
        message: '',
        amend: false,
        commitLanguage: 'auto',
        busy: false,
        statusText: 'Loading...',
        stagedCount: 0,
        totalCount: 0
      };
      const minLeftPaneWidth = 280;
      const minRightPaneWidth = 320;
      const splitterWidth = 12;
      let selectedPath = '';
      let viewMode = persisted.viewMode === 'flat' ? 'flat' : 'directory';
      let leftPaneWidth = hasPersistedPaneWidth
        ? Number(persisted.leftPaneWidth)
        : 0;
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
          'changes-toolbar',
          'refresh',
          'unstage-all',
          'stage-all',
          'view-mode-toggle',
          'group-menu',
          'expand-all',
          'collapse-all',
          'view-menu',
          'group-directory',
          'group-flat',
          'show-ignored',
          'repo-select',
          'changes-count',
          'changes-summary',
          'changes-list',
          'amend',
          'last-commit',
          'history',
          'commit-language',
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
        elements['view-mode-toggle'].addEventListener('click', toggleViewMode);
        elements['group-menu'].addEventListener('click', function (event) {
          event.stopPropagation();
          toggleViewMenu();
        });
        elements['view-menu'].addEventListener('click', function (event) {
          event.stopPropagation();
        });
        elements['group-directory'].addEventListener('click', function () {
          setViewMode('directory');
          closeViewMenu();
        });
        elements['group-flat'].addEventListener('click', function () {
          setViewMode('flat');
          closeViewMenu();
        });
        elements['expand-all'].addEventListener('click', expandAllFolders);
        elements['collapse-all'].addEventListener('click', collapseAllFolders);
        elements['repo-select'].addEventListener('change', function (event) {
          vscode.postMessage({ type: 'selectRepository', root: event.target.value });
        });
        elements.amend.addEventListener('change', function (event) {
          vscode.postMessage({ type: 'setAmend', amend: event.target.checked });
        });
        elements['commit-language'].addEventListener('change', function (event) {
          vscode.postMessage({ type: 'setCommitLanguage', language: event.target.value });
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
        document.addEventListener('click', closeViewMenu);
        document.addEventListener('keydown', function (event) {
          if (event.key === 'Escape') {
            closeViewMenu();
          }
        });
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
        leftPaneWidth = defaultLeftPaneWidth(elements.shell.getBoundingClientRect());
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
          if (!leftPaneWidth) {
            leftPaneWidth = defaultLeftPaneWidth(rect);
          }

          leftPaneWidth = clamp(leftPaneWidth, minLeftPaneWidth, maxLeftPaneWidth(rect));
        }

        elements.shell.style.setProperty('--left-pane-width', leftPaneWidth + 'px');
      }

      function persistUiState() {
        const nextState = Object.assign({}, vscode.getState() || {}, {
          layoutVersion: layoutVersion,
          leftPaneWidth: leftPaneWidth,
          collapsedFolders: Array.from(collapsedFolders),
          viewMode: viewMode
        });
        vscode.setState(nextState);
      }

      function currentLeftPanePixels(shellRect) {
        return clamp(leftPaneWidth, minLeftPaneWidth, maxLeftPaneWidth(shellRect));
      }

      function maxLeftPaneWidth(shellRect) {
        return Math.max(minLeftPaneWidth, shellRect.width - minRightPaneWidth - splitterWidth);
      }

      function defaultLeftPaneWidth(shellRect) {
        return clamp(Math.round(shellRect.width * 0.42), minLeftPaneWidth, maxLeftPaneWidth(shellRect));
      }

      function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
      }

      function render() {
        renderRepositories();
        renderChanges();
        renderCommitPanel();
      }

      function toggleViewMenu() {
        const menu = elements['view-menu'];
        const isOpen = !menu.hidden;

        if (isOpen) {
          closeViewMenu();
          return;
        }

        positionViewMenu();
        menu.hidden = false;
        elements['group-menu'].setAttribute('aria-expanded', 'true');
        elements['group-menu'].classList.add('active');
      }

      function closeViewMenu() {
        if (!elements['view-menu'] || elements['view-menu'].hidden) {
          return;
        }

        elements['view-menu'].hidden = true;
        elements['group-menu'].setAttribute('aria-expanded', 'false');
        elements['group-menu'].classList.remove('active');
      }

      function toggleViewMode() {
        setViewMode(viewMode === 'directory' ? 'flat' : 'directory');
      }

      function setViewMode(mode) {
        if (mode !== 'directory' && mode !== 'flat') {
          return;
        }

        if (viewMode === mode) {
          renderViewModeControls();
          return;
        }

        viewMode = mode;
        persistUiState();
        renderChanges();
        renderCommitPanel();
      }

      function positionViewMenu() {
        const toolbarRect = elements['changes-toolbar'].getBoundingClientRect();
        const buttonRect = elements['group-menu'].getBoundingClientRect();
        const menuWidth = 284;
        const left = clamp(
          Math.round(buttonRect.left - toolbarRect.left - 8),
          4,
          Math.max(4, Math.round(toolbarRect.width - menuWidth - 4))
        );

        elements['view-menu'].style.left = left + 'px';
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

        const fragment = document.createDocumentFragment();

        if (viewMode === 'flat') {
          changes
            .slice()
            .sort(compareChangesByPath)
            .forEach(function (change) {
              fragment.appendChild(fileRow(change, 0, { showDirectory: true }));
            });
        } else {
          const tree = buildChangeTree(changes);

          tree.children.forEach(function (node) {
            appendTreeNode(fragment, node, 0);
          });
        }

        elements['changes-list'].appendChild(fragment);
      }

      function expandAllFolders() {
        if (!state.selectedRoot || (state.changes || []).length === 0) {
          return;
        }

        collapsedFolders.clear();
        persistUiState();
        renderChanges();
      }

      function collapseAllFolders() {
        const paths = collectFolderPaths();

        if (paths.length === 0) {
          return;
        }

        collapsedFolders = new Set(paths);
        persistUiState();
        renderChanges();
      }

      function collectFolderPaths() {
        const tree = buildChangeTree(state.changes || []);
        const paths = [];

        tree.children.forEach(function walk(node) {
          if (node.type !== 'folder') {
            return;
          }

          if (node.path) {
            paths.push(node.path);
          }

          node.children.forEach(walk);
        });

        return paths;
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
        disclosure.className = 'disclosure-button ' + (expanded ? 'expanded' : 'collapsed');
        disclosure.type = 'button';
        disclosure.title = expanded ? 'Collapse folder' : 'Expand folder';
        disclosure.setAttribute('aria-label', disclosure.title);
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
          const paths = collectFilePaths(node);
          setLocalChecked(paths, event.target.checked);
          vscode.postMessage({
            type: 'toggleChanges',
            paths: paths,
            checked: event.target.checked
          });
        });

        const name = document.createElement('span');
        name.className = 'folder-main';
        name.textContent = node.name;

        const count = document.createElement('span');
        count.className = 'folder-count';
        count.textContent = node.stagedCount + '/' + node.fileCount;

        const icon = createFolderIcon(node, expanded);

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

      function fileRow(change, depth, options) {
        const row = document.createElement('div');
        const description = statusDescription(change);
        const showDirectory = Boolean(options && options.showDirectory);
        row.className = 'tree-row file-row' + (change.path === selectedPath ? ' selected' : '');
        row.style.paddingLeft = treePadding(depth);
        row.title = change.path + '\\n' + description + ' / ' + (change.staged ? 'checked' : 'unchecked');
        row.dataset.path = change.path;

        const spacer = document.createElement('span');
        spacer.className = 'disclosure-spacer';
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
          setLocalChecked([change.path], event.target.checked);
          vscode.postMessage({
            type: 'toggleChange',
            path: change.path,
            checked: event.target.checked
          });
        });

        const status = document.createElement('span');
        status.className = 'status ' + (change.kind || 'changed');
        status.textContent = statusLabel(change);
        status.title = description;
        status.setAttribute('aria-label', description);

        const main = document.createElement('span');
        main.className = 'file-main';

        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = baseName(change.path);

        const icon = createFileIcon(change.path);

        main.appendChild(name);
        if (showDirectory) {
          const directory = directoryName(change.path);

          if (directory) {
            const directoryNode = document.createElement('span');
            directoryNode.className = 'file-directory';
            directoryNode.textContent = directory;
            main.appendChild(directoryNode);
          }
        }

        row.appendChild(spacer);
        row.appendChild(checkbox);
        row.appendChild(icon);
        row.appendChild(main);
        row.appendChild(status);
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

      function setLocalChecked(paths, checked) {
        const pathSet = new Set(paths);
        const changes = (state.changes || []).map(function (change) {
          if (!pathSet.has(change.path)) {
            return change;
          }

          return Object.assign({}, change, {
            staged: checked
          });
        });
        const stagedCount = changes.filter(function (change) { return change.staged; }).length;

        state = Object.assign({}, state, {
          changes: changes,
          stagedCount: stagedCount,
          totalCount: changes.length,
          canGenerate: stagedCount > 0,
          statusText: changeSummaryFromCounts(stagedCount, changes.length),
          errorText: ''
        });

        renderChanges();
        renderCommitPanel();
      }

      function treePadding(depth) {
        return 4 + depth * 14 + 'px';
      }

      function renderCommitPanel() {
        const message = state.message || '';
        const textarea = elements.message;

        if (document.activeElement !== textarea && textarea.value !== message) {
          textarea.value = message;
        }

        elements.amend.checked = Boolean(state.amend);
        const previousCommit = String(state.lastCommit || '').trim();
        elements['last-commit'].hidden = !previousCommit;
        elements['last-commit'].textContent = previousCommit ? previousCommit + '\\u2304' : '';
        elements['last-commit'].title = previousCommit || 'Previous commit';
        elements['commit-language'].value = normalizeCommitLanguage(state.commitLanguage);
        elements['busy-overlay'].classList.toggle('visible', Boolean(state.busy));
        elements['busy-text'].textContent = state.busyText || 'Loading...';

        const hasMessage = textarea.value.trim().length > 0;
        const hasRepo = Boolean(state.selectedRoot);
        const hasChanges = (state.totalCount || 0) > 0;
        const hasFolders = viewMode === 'directory' && hasChanges && collectFolderPaths().length > 0;
        elements.commit.disabled = Boolean(state.busy) || !hasRepo || !hasMessage;
        elements['commit-push'].disabled = Boolean(state.busy) || !hasRepo || !hasMessage;
        elements.generate.disabled = Boolean(state.busy) || !hasRepo || !state.canGenerate;
        elements['commit-language'].disabled = Boolean(state.busy);
        elements['stage-all'].disabled = Boolean(state.busy) || !hasRepo || !hasChanges;
        elements['unstage-all'].disabled = Boolean(state.busy) || !hasRepo || state.stagedCount === 0;
        elements['view-mode-toggle'].disabled = !hasRepo || !hasChanges;
        elements['group-menu'].disabled = !hasRepo;
        elements['expand-all'].disabled = !hasFolders;
        elements['collapse-all'].disabled = !hasFolders;
        renderViewModeControls();

        elements['footer-status'].textContent = state.errorText || state.statusText || '';
        elements['footer-status'].classList.toggle('error', Boolean(state.errorText));
      }

      function normalizeCommitLanguage(language) {
        return ['auto', 'en', 'ru'].includes(language) ? language : 'auto';
      }

      function renderViewModeControls() {
        const isDirectory = viewMode === 'directory';
        const toggle = elements['view-mode-toggle'];
        toggle.classList.toggle('active', isDirectory);
        toggle.setAttribute('aria-pressed', isDirectory ? 'true' : 'false');
        toggle.title = isDirectory
          ? 'Directory view. Click to show flat list'
          : 'Flat list. Click to group by directory';

        elements['group-directory'].classList.toggle('selected', isDirectory);
        elements['group-directory'].setAttribute('aria-checked', isDirectory ? 'true' : 'false');
        elements['group-directory'].querySelector('.menu-check').textContent = isDirectory ? '\\u2713' : '';

        elements['group-flat'].classList.toggle('selected', !isDirectory);
        elements['group-flat'].setAttribute('aria-checked', isDirectory ? 'false' : 'true');
        elements['group-flat'].querySelector('.menu-check').textContent = isDirectory ? '' : '\\u2713';
      }

      function changeSummary() {
        const total = state.totalCount || 0;
        const staged = state.stagedCount || 0;

        if (total === 0) {
          return 'clean';
        }

        return changeSummaryFromCounts(staged, total);
      }

      function changeSummaryFromCounts(staged, total) {
        if (total === 0) {
          return 'clean';
        }

        return staged + '/' + total + ' checked';
      }

      function createFolderIcon(node, expanded) {
        const icon = document.createElement('span');
        icon.className = 'entry-icon folder-icon';
        icon.setAttribute('aria-hidden', 'true');
        appendThemeIcon(icon, resolveFolderIcon(node.name, expanded), 'folder');

        return icon;
      }

      function createFileIcon(filePath) {
        const icon = document.createElement('span');
        icon.className = 'entry-icon file-icon';
        icon.setAttribute('aria-hidden', 'true');
        appendThemeIcon(icon, resolveFileIcon(filePath), 'file');

        return icon;
      }

      function appendThemeIcon(container, iconUri, fallbackType) {
        if (!iconUri) {
          container.classList.add('missing-theme-icon', 'missing-theme-icon-' + fallbackType);
          return;
        }

        const image = document.createElement('img');
        image.className = 'theme-icon-img';
        image.src = iconUri;
        image.alt = '';
        image.decoding = 'async';
        image.draggable = false;
        container.appendChild(image);
      }

      function resolveFolderIcon(folderName, expanded) {
        const names = expanded
          ? activeFileIcons.folderNamesExpanded || {}
          : activeFileIcons.folderNames || {};
        const fallbackNames = activeFileIcons.folderNames || {};
        const specific = iconDefinitionId(names, folderName)
          || iconDefinitionId(fallbackNames, folderName);

        return iconUri(specific || (expanded ? activeFileIcons.folderExpanded : activeFileIcons.folder));
      }

      function resolveFileIcon(filePath) {
        const normalizedPath = String(filePath || '').replace(/\\\\/g, '/');
        const name = baseName(normalizedPath);
        const byName = iconDefinitionId(activeFileIcons.fileNames || {}, name);

        if (byName) {
          return iconUri(byName);
        }

        const lowerName = name.toLowerCase();
        const parts = lowerName.split('.');

        for (let index = 1; index < parts.length; index += 1) {
          const extension = parts.slice(index).join('.');
          const byExtension = activeFileIcons.fileExtensions?.[extension];

          if (byExtension) {
            return iconUri(byExtension);
          }
        }

        return iconUri(activeFileIcons.file);
      }

      function iconDefinitionId(iconMap, key) {
        if (!key) {
          return '';
        }

        return iconMap[key] || iconMap[String(key).toLowerCase()] || '';
      }

      function iconUri(definitionId) {
        return activeFileIcons.definitions?.[definitionId] || '';
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
          return 'new';
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

      function statusDescription(change) {
        if (change.kind === 'untracked') {
          return 'Untracked file';
        }
        if (change.kind === 'added') {
          return 'Added file';
        }
        if (change.kind === 'deleted') {
          return 'Deleted file';
        }
        if (change.kind === 'renamed') {
          return 'Renamed file';
        }
        if (change.kind === 'copied') {
          return 'Copied file';
        }
        if (change.kind === 'conflict') {
          return 'Merge conflict';
        }
        return 'Modified file';
      }

      function compareChangesByPath(left, right) {
        return String(left.path || '').localeCompare(String(right.path || ''));
      }

      function baseName(filePath) {
        const parts = String(filePath || '').split('/');
        return parts[parts.length - 1] || filePath;
      }

      function directoryName(filePath) {
        const parts = String(filePath || '').split('/');
        parts.pop();

        return parts.join('\\\\');
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

function resolveActiveFileIconTheme() {
  const vscode = getVscodeModule();

  if (!vscode) {
    return undefined;
  }

  const activeThemeId = vscode.workspace
    .getConfiguration('workbench')
    .get('iconTheme');

  if (!activeThemeId) {
    return undefined;
  }

  return findIconThemeInVscodeExtensions(activeThemeId)
    || findIconThemeInExtensionRoots(activeThemeId);
}

function findIconThemeInVscodeExtensions(activeThemeId) {
  const vscode = getVscodeModule();

  for (const extension of vscode.extensions.all) {
    const iconThemes = extension.packageJSON?.contributes?.iconThemes || [];
    const theme = iconThemes.find(
      function (candidate) {
        return candidate.id === activeThemeId;
      }
    );

    if (!theme?.path) {
      continue;
    }

    return {
      id: activeThemeId,
      extensionId: extension.id,
      extensionUri: extension.extensionUri,
      themePath: theme.path
    };
  }

  return undefined;
}

function findIconThemeInExtensionRoots(activeThemeId) {
  const vscode = getVscodeModule();

  if (!vscode) {
    return undefined;
  }

  for (const root of extensionSearchRoots()) {
    if (!fs.existsSync(root)) {
      continue;
    }

    let extensionDirs;

    try {
      extensionDirs = fs.readdirSync(root, { withFileTypes: true })
        .filter(
          function (entry) {
            return entry.isDirectory();
          }
        )
        .map(
          function (entry) {
            return path.join(root, entry.name);
          }
        );
    } catch (_) {
      continue;
    }

    for (const extensionDir of extensionDirs) {
      const packageJsonPath = path.join(extensionDir, 'package.json');

      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }

      let packageJson;

      try {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      } catch (_) {
        continue;
      }
      const iconThemes = packageJson.contributes?.iconThemes || [];
      const theme = iconThemes.find(
        function (candidate) {
          return candidate.id === activeThemeId;
        }
      );

      if (!theme?.path) {
        continue;
      }

      return {
        id: activeThemeId,
        extensionId: packageJson.publisher + '.' + packageJson.name,
        extensionUri: vscode.Uri.file(extensionDir),
        themePath: theme.path
      };
    }
  }

  return undefined;
}

function extensionSearchRoots() {
  const roots = new Set();

  addExtensionRoot(roots, process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.vscode', 'extensions'));
  addExtensionRoot(roots, process.env.HOME && path.join(process.env.HOME, '.vscode', 'extensions'));
  addExtensionRoot(roots, process.env.HOME && path.join(process.env.HOME, '.vscode-server', 'extensions'));

  if (process.platform === 'linux' && fs.existsSync('/mnt/c/Users')) {
    try {
      fs.readdirSync('/mnt/c/Users', { withFileTypes: true })
        .filter(
          function (entry) {
            return entry.isDirectory();
          }
        )
        .forEach(
          function (entry) {
            addExtensionRoot(
              roots,
              path.join('/mnt/c/Users', entry.name, '.vscode', 'extensions')
            );
          }
        );
    } catch (_) {
      // Ignore inaccessible Windows profiles.
    }
  }

  return Array.from(roots);
}

function addExtensionRoot(roots, root) {
  if (root) {
    roots.add(root);
  }
}

function buildFileIconTheme(webview, themeSource) {
  const empty = {
    definitions: {},
    file: '',
    folder: '',
    folderExpanded: '',
    fileExtensions: {},
    fileNames: {},
    folderNames: {},
    folderNamesExpanded: {}
  };

  if (!themeSource?.extensionUri || !themeSource.themePath || !webview || typeof webview.asWebviewUri !== 'function') {
    return empty;
  }

  const themePath = normalizedThemePath(themeSource.themePath);
  const themeJsonUri = resourceUri(themeSource.extensionUri, themePathParts(themePath));

  if (!themeJsonUri.fsPath || !fs.existsSync(themeJsonUri.fsPath)) {
    return empty;
  }

  let theme;

  try {
    theme = JSON.parse(fs.readFileSync(themeJsonUri.fsPath, 'utf8'));
  } catch (_) {
    return empty;
  }
  const themeDirectory = path.posix.dirname(themePath);
  const definitions = {};

  Object.entries(theme.iconDefinitions || {}).forEach(
    function ([id, definition]) {
      if (!definition || !definition.iconPath) {
        return;
      }

      const iconRelativePath = path.posix.normalize(
        path.posix.join(
          themeDirectory,
          normalizedThemePath(definition.iconPath)
        )
      );
      const iconUri = resourceUri(
        themeSource.extensionUri,
        themePathParts(iconRelativePath)
      );

      definitions[id] = String(webview.asWebviewUri(iconUri));
    }
  );

  return {
    definitions: definitions,
    file: theme.file || '',
    folder: theme.folder || '',
    folderExpanded: theme.folderExpanded || theme.folder || '',
    fileExtensions: normalizedIconMap(theme.fileExtensions || {}),
    fileNames: normalizedIconMap(theme.fileNames || {}),
    folderNames: normalizedIconMap(theme.folderNames || {}),
    folderNamesExpanded: normalizedIconMap(theme.folderNamesExpanded || {})
  };
}

function resourceUri(extensionUri, relativeParts) {
  const vscode = getVscodeModule();

  if (vscode && vscode.Uri && typeof vscode.Uri.joinPath === 'function' && extensionUri.scheme) {
    return vscode.Uri.joinPath(extensionUri, ...relativeParts);
  }

  const root = typeof extensionUri === 'string'
    ? extensionUri
    : extensionUri.fsPath;

  return {
    fsPath: path.join(root, ...relativeParts)
  };
}

function normalizedThemePath(themePath) {
  return String(themePath || '')
    .replace(/^\.\//, '')
    .replace(/\\/g, '/');
}

function themePathParts(themePath) {
  return normalizedThemePath(themePath)
    .split(/[\\/]+/)
    .filter(
      function (part) {
        return part && part !== '.';
      }
    );
}

function normalizedIconMap(iconMap) {
  return Object.entries(iconMap || {}).reduce(
    function (result, [key, value]) {
      result[key] = value;
      result[String(key).toLowerCase()] = value;

      return result;
    },
    {}
  );
}

function serializeForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function getVscodeModule() {
  if (vscodeModule !== undefined) {
    return vscodeModule;
  }

  try {
    vscodeModule = require('vscode');
  } catch (_) {
    vscodeModule = null;
  }

  return vscodeModule;
}

module.exports = {
  buildFileIconTheme,
  renderWebview,
  resolveActiveFileIconTheme
};
