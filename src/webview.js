'use strict';

const fs = require('fs');
const path = require('path');

let vscodeModule;

function resolveFolderCheckboxChecked(fileCount, fullyCheckedCount) {
  const total = Math.max(0, Number(fileCount) || 0);
  const checked = Math.max(0, Number(fullyCheckedCount) || 0);

  return total > 0 && checked < total;
}

function reconcileOptimisticStagingChanges(changes, optimisticStagingStates, confirmedRequestIds) {
  const confirmed = new Set((Array.isArray(confirmedRequestIds) ? confirmedRequestIds : [])
    .map((requestId) => String(requestId || ''))
    .filter(Boolean));
  const remaining = new Map();

  for (const [filePath, optimisticState] of optimisticStagingStates.entries()) {
    if (!confirmed.has(String(optimisticState?.requestId || ''))) {
      remaining.set(filePath, optimisticState);
    }
  }

  let hasOverlay = false;
  const reconciledChanges = (Array.isArray(changes) ? changes : []).map((change) => {
    const optimisticState = remaining.get(change.path);

    if (!optimisticState) {
      return change;
    }

    const checked = Boolean(optimisticState.checked);
    hasOverlay = true;
    return {
      ...change,
      staged: checked,
      hasStaged: checked,
      hasUnstaged: !checked,
      partiallyStaged: false
    };
  });

  return {
    changes: reconciledChanges,
    hasOverlay,
    optimisticStagingStates: remaining
  };
}

function renderWebview(webview, fileIconThemeSource, extensionUri) {
  const nonce = getNonce();
  const activeFileIcons = buildFileIconTheme(webview, fileIconThemeSource);
  const actionIcons = buildBundledActionIcons(webview, extensionUri);
  const showActionIcon = renderActionIcon(actionIcons.show, '');
  const previewDetailsActionIcon = renderActionIcon(actionIcons.previewDetails, '');
  const folderCheckboxResolverSource = resolveFolderCheckboxChecked.toString();
  const stagingReconciliationSource = reconcileOptimisticStagingChanges.toString();

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
      --token-keyword: var(--vscode-symbolIcon-keywordForeground, #c586c0);
      --token-string: var(--vscode-symbolIcon-stringForeground, #ce9178);
      --token-number: var(--vscode-symbolIcon-numberForeground, #b5cea8);
      --token-variable: var(--vscode-symbolIcon-variableForeground, #9cdcfe);
      --token-comment: var(--vscode-descriptionForeground, #6a9955);
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
      grid-template-rows: minmax(0, 1fr);
      height: 100vh;
      min-width: 680px;
      background: var(--editor-bg);
    }

    .changes-pane,
    .commit-pane,
    .diff-preview {
      min-width: 0;
      min-height: 0;
    }

    .changes-pane {
      grid-column: 1;
      grid-row: 1;
      display: grid;
      grid-template-rows: 30px 28px 1fr;
      background: var(--panel-bg);
      border-right: 1px solid var(--border-soft);
    }

    .commit-pane {
      grid-column: 3;
      grid-row: 1;
      display: grid;
      grid-template-rows: 42px 1fr 42px;
      background: var(--editor-bg);
    }

    .shell.preview-visible {
      grid-template-rows: var(--changes-pane-height, minmax(150px, 56%)) 7px minmax(155px, 1fr);
    }

    .shell.preview-visible .changes-pane {
      grid-column: 1;
      grid-row: 1;
      border-bottom: 1px solid var(--border-soft);
    }

    .shell.preview-visible .commit-pane {
      grid-column: 1;
      grid-row: 3;
      border-right: 1px solid var(--border-soft);
    }

    .diff-preview {
      display: none;
      grid-column: 3;
      grid-row: 1 / 4;
      grid-template-rows: 38px 30px minmax(0, 1fr);
      background: var(--editor-bg);
    }

    .shell.preview-visible .diff-preview {
      display: grid;
    }

    .splitter {
      grid-column: 2;
      grid-row: 1 / 4;
      position: relative;
      background: transparent;
      cursor: col-resize;
      outline: none;
    }

    .commit-splitter {
      display: none;
      grid-column: 1;
      grid-row: 2;
      position: relative;
      cursor: row-resize;
      background: transparent;
    }

    .shell.preview-visible .commit-splitter {
      display: block;
    }

    .commit-splitter::before {
      content: '';
      position: absolute;
      top: 50%;
      right: 0;
      left: 0;
      height: 1px;
      background: var(--border-soft);
      transform: translateY(-50%);
    }

    .commit-splitter:hover,
    .commit-splitter.dragging,
    .commit-splitter:focus-visible {
      background: color-mix(in srgb, var(--accent) 10%, transparent);
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

    .jetbrains-action-icon {
      width: 16px;
      height: 16px;
      display: block;
    }

    body.vscode-light .jetbrains-action-icon.dark,
    body:not(.vscode-light) .jetbrains-action-icon.light {
      display: none;
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

    .diff-toolbar {
      position: relative;
      display: flex;
      align-items: center;
      gap: 3px;
      min-width: 0;
      padding: 4px 8px;
      border-bottom: 1px solid var(--border-soft);
      background: color-mix(in srgb, var(--panel-bg) 55%, var(--editor-bg) 45%);
    }

    .diff-toolbar .tool-button {
      flex: 0 0 24px;
    }

    .diff-select {
      height: 25px;
      min-width: 112px;
      max-width: 190px;
      color: var(--text);
      background: var(--vscode-dropdown-background, var(--input-bg));
      border: 1px solid var(--vscode-dropdown-border, var(--border-soft));
      border-radius: 4px;
      padding: 0 6px;
      outline: none;
    }

    .diff-select:focus {
      border-color: var(--accent);
    }

    .diff-stats {
      min-width: 0;
      margin-left: auto;
      overflow: hidden;
      color: var(--muted);
      font-family: var(--vscode-editor-font-family, monospace);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .diff-pathbar {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      padding: 4px 12px;
      border-bottom: 1px solid var(--border-soft);
      color: var(--muted);
      font-family: var(--vscode-editor-font-family, monospace);
    }

    .diff-revision {
      color: var(--vscode-textLink-foreground);
      white-space: nowrap;
    }

    .diff-path {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .diff-body {
      position: relative;
      min-height: 0;
      overflow: auto;
      background: var(--editor-bg);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: var(--vscode-editor-line-height, 20px);
    }

    .diff-file-header {
      position: sticky;
      z-index: 3;
      top: 0;
      display: flex;
      align-items: center;
      gap: 9px;
      min-height: 29px;
      padding: 4px 9px;
      color: var(--text);
      background: color-mix(in srgb, var(--editor-bg) 91%, var(--panel-bg) 9%);
      border-bottom: 1px solid var(--border-soft);
    }

    .diff-file-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .diff-hunk {
      scroll-margin-top: 34px;
      border-bottom: 1px solid color-mix(in srgb, var(--border-soft) 55%, transparent);
    }

    .diff-hunk.active {
      box-shadow: inset 2px 0 0 color-mix(in srgb, var(--accent) 78%, transparent);
    }

    .diff-hunk-header {
      position: sticky;
      z-index: 2;
      top: 29px;
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
      min-height: 25px;
      padding: 2px 9px;
      color: var(--muted);
      background: color-mix(in srgb, var(--vscode-diffEditor-unchangedRegionBackground, var(--panel-bg)) 72%, var(--editor-bg) 28%);
      border-bottom: 1px solid var(--border-soft);
    }

    .diff-hunk-header.included {
      color: var(--text);
    }

    .diff-hunk-source {
      color: var(--muted);
      font-family: var(--vscode-font-family);
      font-size: 11px;
      white-space: nowrap;
    }

    .diff-row {
      display: grid;
      grid-template-columns: 52px 52px minmax(max-content, 1fr);
      min-height: 20px;
      white-space: pre;
    }

    .diff-row.hide-line-numbers {
      grid-template-columns: minmax(max-content, 1fr);
    }

    .diff-row.side-by-side {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      border-bottom: 1px solid color-mix(in srgb, var(--border-soft) 32%, transparent);
    }

    .diff-line-number {
      padding: 0 8px 0 4px;
      color: var(--vscode-editorLineNumber-foreground, var(--muted));
      background: color-mix(in srgb, var(--editor-bg) 94%, var(--panel-bg) 6%);
      border-right: 1px solid color-mix(in srgb, var(--border-soft) 58%, transparent);
      text-align: right;
      user-select: none;
    }

    .diff-code {
      min-width: 0;
      padding: 0 10px;
      overflow: hidden;
      color: var(--vscode-editor-foreground, var(--text));
    }

    .indent-guide {
      display: inline-block;
      border-left: 1px solid color-mix(in srgb, var(--muted) 24%, transparent);
    }

    .diff-blame {
      display: inline-block;
      min-width: 118px;
      margin-right: 10px;
      overflow: hidden;
      color: var(--muted);
      font-family: var(--vscode-font-family);
      font-size: 11px;
      text-overflow: ellipsis;
      vertical-align: bottom;
      white-space: nowrap;
    }

    .tok-keyword { color: var(--token-keyword); }
    .tok-string { color: var(--token-string); }
    .tok-number { color: var(--token-number); }
    .tok-variable { color: var(--token-variable); }
    .tok-comment { color: var(--token-comment); }

    .diff-body.soft-wrap .diff-row,
    .diff-body.soft-wrap .diff-code {
      min-width: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .diff-row.add,
    .diff-side.add {
      background: var(--vscode-diffEditor-insertedLineBackground, color-mix(in srgb, var(--success) 16%, transparent));
    }

    .diff-row.delete,
    .diff-side.delete {
      background: var(--vscode-diffEditor-removedLineBackground, color-mix(in srgb, var(--deleted) 16%, transparent));
    }

    .diff-body.highlight-none .diff-row.add,
    .diff-body.highlight-none .diff-row.delete,
    .diff-body.highlight-none .diff-side.add,
    .diff-body.highlight-none .diff-side.delete {
      background: transparent;
    }

    .diff-body.highlight-line .diff-row.add,
    .diff-body.highlight-line .diff-side.add {
      background: color-mix(in srgb, var(--vscode-diffEditor-insertedLineBackground, var(--success)) 82%, transparent);
    }

    .diff-body.highlight-line .diff-row.delete,
    .diff-body.highlight-line .diff-side.delete {
      background: color-mix(in srgb, var(--vscode-diffEditor-removedLineBackground, var(--deleted)) 82%, transparent);
    }

    .diff-mark.add {
      background: var(--vscode-diffEditor-insertedTextBackground, color-mix(in srgb, var(--success) 32%, transparent));
    }

    .diff-mark.delete {
      background: var(--vscode-diffEditor-removedTextBackground, color-mix(in srgb, var(--deleted) 32%, transparent));
    }

    .diff-side {
      display: grid;
      grid-template-columns: 52px minmax(max-content, 1fr);
      min-width: 0;
      border-right: 1px solid var(--border-soft);
    }

    .diff-side.hide-line-numbers {
      grid-template-columns: minmax(max-content, 1fr);
    }

    .diff-omitted {
      padding: 2px 12px;
      color: var(--muted);
      background: var(--vscode-diffEditor-unchangedRegionBackground, var(--panel-bg));
      border-top: 1px solid var(--border-soft);
      border-bottom: 1px solid var(--border-soft);
      font-family: var(--vscode-font-family);
      font-size: 11px;
    }

    .diff-empty {
      margin: 18px;
      padding: 18px;
      color: var(--muted);
      border: 1px solid var(--border-soft);
      border-radius: 5px;
      font-family: var(--vscode-font-family);
      line-height: 1.5;
    }

    .popup-menu {
      position: absolute;
      z-index: 20;
      top: 34px;
      right: 8px;
      width: 246px;
      padding: 7px;
      color: var(--text);
      background: color-mix(in srgb, var(--editor-bg) 88%, var(--panel-bg) 12%);
      border: 1px solid var(--border-soft);
      border-radius: 6px;
      box-shadow: 0 8px 24px color-mix(in srgb, black 36%, transparent);
    }

    .popup-menu[hidden] {
      display: none;
    }

    .popup-menu .menu-item {
      grid-template-columns: 22px minmax(0, 1fr);
    }

    .help-popup {
      width: 280px;
      padding: 11px 13px;
      color: var(--muted);
      line-height: 1.55;
    }

    .help-popup div:first-child {
      color: var(--text);
      margin-bottom: 5px;
    }

    .ignored-group {
      min-height: 24px;
      padding: 5px 8px 2px 26px;
      color: var(--muted);
      font-size: 11px;
    }

    .ignored-row {
      opacity: 0.62;
    }

    .dialog-overlay {
      position: fixed;
      z-index: 100;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 20px;
      background: color-mix(in srgb, black 46%, transparent);
    }

    .dialog-overlay[hidden] {
      display: none;
    }

    .confirm-dialog {
      width: min(430px, 100%);
      padding: 16px;
      color: var(--text);
      background: var(--editor-bg);
      border: 1px solid var(--border);
      border-radius: 7px;
      box-shadow: 0 12px 34px color-mix(in srgb, black 48%, transparent);
    }

    .confirm-title {
      margin-bottom: 9px;
      font-size: 14px;
    }

    .confirm-message {
      color: var(--muted);
      line-height: 1.45;
    }

    .confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }

    .confirm-actions .secondary {
      min-width: 86px;
    }

    @media (max-width: 760px) {
      .shell {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(150px, 44fr) minmax(155px, 56fr);
        min-width: 0;
      }

      .changes-pane {
        border-right: 0;
        border-bottom: 1px solid var(--border-soft);
      }

      .commit-pane {
        grid-column: 1;
        grid-row: 2;
      }

      .shell.preview-visible {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(150px, 34fr) minmax(155px, 32fr) minmax(180px, 34fr);
        overflow: auto;
      }

      .shell.preview-visible .changes-pane {
        grid-column: 1;
        grid-row: 1;
      }

      .shell.preview-visible .commit-pane {
        grid-column: 1;
        grid-row: 2;
      }

      .shell.preview-visible .diff-preview {
        grid-column: 1;
        grid-row: 3;
      }

      .splitter,
      .shell.preview-visible .splitter,
      .shell.preview-visible .commit-splitter {
        display: none;
      }
    }
  </style>
</head>
<body>
  <main id="shell" class="shell">
    <section class="changes-pane" aria-label="Changes">
      <div id="changes-toolbar" class="toolbar">
        <div class="toolbar-group" aria-label="Repository actions">
          <button id="refresh" class="tool-button" title="Refresh changes">&#x21BB;</button>
          <button id="rollback-selected" class="tool-button" title="Rollback selected change" aria-label="Rollback selected change">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5.5 4 2.5 7l3 3M3 7h6a4 4 0 0 1 4 4"></path></svg>
          </button>
          <button id="shelve-selected" class="tool-button" title="Shelve selected change" aria-label="Shelve selected change">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 3.5h11v9h-11zM5 6h6M5 8.5h6M6.5 11h3"></path></svg>
          </button>
          <button id="unstage-all" class="tool-button" title="Uncheck all changes">&minus;</button>
          <button id="stage-all" class="tool-button" title="Check all changes">+</button>
        </div>
        <span class="tool-separator" aria-hidden="true"></span>
        <div class="toolbar-group" aria-label="View actions">
          <button id="view-options" class="tool-button" title="View options" aria-label="View options" aria-haspopup="menu" aria-expanded="false">
            ${showActionIcon}
          </button>
          <button id="diff-preview-toggle" class="tool-button" title="Show diff preview" aria-label="Show diff preview" aria-pressed="false">
            ${previewDetailsActionIcon}
          </button>
          <button id="open-selected-diff" class="tool-button" title="Show diff in editor" aria-label="Show diff in editor">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M3 2.5h7l3 3v8H3zM10 2.5v3h3M5.5 8h5M5.5 10.5h5"></path>
            </svg>
          </button>
          <button id="locate-active-file" class="tool-button" title="Locate active file" aria-label="Locate active file">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="5"></circle>
              <circle cx="8" cy="8" r="1.5"></circle>
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2"></path>
            </svg>
          </button>
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
          <button id="show-ignored" class="menu-item" type="button" role="menuitemcheckbox" aria-checked="false">
            <span class="menu-check"></span>
            <span>Ignored Files</span>
            <span class="menu-shortcut"></span>
          </button>
        </div>
      </div>
      <div class="changes-header">
        <button id="changes-root-toggle" class="disclosure-button expanded" type="button" title="Collapse changes" aria-label="Collapse changes"></button>
        <input id="changes-root-checkbox" class="file-checkbox" type="checkbox" aria-label="Include all changes">
        <span class="changes-title">Changes</span>
        <span id="changes-count" class="changes-count">0</span>
        <span id="changes-summary" class="changes-summary">updating...</span>
      </div>
      <div id="changes-list" class="changes-list" role="listbox" aria-label="Changed files"></div>
    </section>

    <div id="splitter" class="splitter" role="separator" aria-orientation="vertical" aria-label="Resize changes and commit panels" tabindex="0"></div>

    <div id="commit-splitter" class="commit-splitter" role="separator" aria-orientation="horizontal" aria-label="Resize changes and commit panels" tabindex="0"></div>

    <section class="commit-pane" aria-label="Commit">
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

    <section id="diff-preview" class="diff-preview" aria-label="Diff preview">
      <div class="diff-toolbar">
        <button id="diff-prev-change" class="tool-button" title="Previous difference" aria-label="Previous difference">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 10 8 6l4 4"></path></svg>
        </button>
        <button id="diff-next-change" class="tool-button" title="Next difference" aria-label="Next difference">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4"></path></svg>
        </button>
        <button id="diff-edit-source" class="tool-button" title="Edit source" aria-label="Edit source">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 11.8-.5 2 2-.5 7.8-7.8-1.5-1.5zM9.8 5l1.5 1.5"></path></svg>
        </button>
        <span class="tool-separator" aria-hidden="true"></span>
        <button id="diff-prev-file" class="tool-button" title="Previous file" aria-label="Previous file">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m10 4-4 4 4 4"></path></svg>
        </button>
        <button id="diff-next-file" class="tool-button" title="Next file" aria-label="Next file">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m6 4 4 4-4 4"></path></svg>
        </button>
        <button id="diff-open-native" class="tool-button" title="Open diff in editor" aria-label="Open diff in editor">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 2.5h7l3 3v8H3zM10 2.5v3h3M5.5 8h5M5.5 10.5h5"></path></svg>
        </button>
        <select id="diff-viewer" class="diff-select" title="Diff viewer" aria-label="Diff viewer">
          <option value="unified">Unified viewer</option>
          <option value="side-by-side">Side-by-side viewer</option>
        </select>
        <select id="diff-ignore-policy" class="diff-select" title="Whitespace policy" aria-label="Whitespace policy">
          <option value="none">Do not ignore</option>
          <option value="trim">Trim whitespaces</option>
          <option value="all">Ignore whitespaces</option>
          <option value="all-and-empty">Ignore whitespaces and empty lines</option>
          <option value="formatting">Ignore imports and formatting</option>
        </select>
        <select id="diff-highlight-policy" class="diff-select" title="Highlight policy" aria-label="Highlight policy">
          <option value="word">Highlight words</option>
          <option value="word-split">Highlight words (split)</option>
          <option value="char">Highlight characters</option>
          <option value="line">Highlight lines</option>
          <option value="none">Do not highlight</option>
        </select>
        <button id="diff-collapse-unchanged" class="tool-button active" title="Collapse unchanged fragments" aria-label="Collapse unchanged fragments" aria-pressed="true">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 3 4 4 4-4M4 13l4-4 4 4"></path></svg>
        </button>
        <button id="diff-settings" class="tool-button" title="Diff settings" aria-label="Diff settings" aria-haspopup="menu" aria-expanded="false">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="2.2"></circle><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1"></path></svg>
        </button>
        <button id="diff-help" class="tool-button" title="Diff help" aria-label="Diff help" aria-haspopup="dialog">?</button>
        <span id="diff-stats" class="diff-stats">0 differences, 0 included</span>
        <div id="diff-settings-menu" class="popup-menu" role="menu" hidden>
          <button id="diff-show-blame" class="menu-item" type="button" role="menuitemcheckbox" aria-checked="false"><span class="menu-check"></span><span>Annotate with Git Blame</span></button>
          <button id="diff-show-whitespace" class="menu-item" type="button" role="menuitemcheckbox" aria-checked="false"><span class="menu-check"></span><span>Show Whitespaces</span></button>
          <button id="diff-show-line-numbers" class="menu-item selected" type="button" role="menuitemcheckbox" aria-checked="true"><span class="menu-check">&#x2713;</span><span>Show Line Numbers</span></button>
          <button id="diff-show-indent-guides" class="menu-item selected" type="button" role="menuitemcheckbox" aria-checked="true"><span class="menu-check">&#x2713;</span><span>Show Indent Guides</span></button>
          <button id="diff-soft-wrap" class="menu-item" type="button" role="menuitemcheckbox" aria-checked="false"><span class="menu-check"></span><span>Soft-Wrap</span></button>
          <button class="menu-item" type="button" disabled><span class="menu-check"></span><span>Highlighting Level ›</span></button>
          <button id="diff-breadcrumbs" class="menu-item selected" type="button" role="menuitemcheckbox" aria-checked="true"><span class="menu-check">&#x2713;</span><span>Breadcrumbs</span></button>
        </div>
        <div id="diff-help-popup" class="popup-menu help-popup" role="dialog" hidden>
          <div>Inline diff preview</div>
          <div>Use Alt+↑/↓ to move between differences and Alt+←/→ to move between changed files. Check a fragment to include it in the commit.</div>
        </div>
      </div>
      <div id="diff-pathbar" class="diff-pathbar">
        <span id="diff-revision" class="diff-revision"></span>
        <span id="diff-path" class="diff-path">Select a changed file</span>
      </div>
      <div id="diff-body" class="diff-body highlight-word">
        <div class="diff-file-header">
          <input id="diff-file-checkbox" class="file-checkbox" type="checkbox" aria-label="Include current file">
          <span class="diff-file-label">Current version</span>
        </div>
        <div id="diff-content"></div>
      </div>
    </section>

    <div id="confirm-dialog" class="dialog-overlay" hidden>
      <div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <div id="confirm-title" class="confirm-title">Confirm action</div>
        <div id="confirm-message" class="confirm-message"></div>
        <div class="confirm-actions">
          <button id="confirm-cancel" class="secondary">Cancel</button>
          <button id="confirm-accept" class="primary">Continue</button>
        </div>
      </div>
    </div>
  </main>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const activeFileIcons = ${serializeForScript(activeFileIcons)};
      ${folderCheckboxResolverSource}
      ${stagingReconciliationSource}
      const elements = {};
      const persisted = vscode.getState() || {};
      const layoutVersion = 4;
      const hasPersistedPaneWidth = persisted.layoutVersion === layoutVersion
        && Number.isFinite(Number(persisted.leftPaneWidth));
      let state = {
        repositories: [],
        changes: [],
        ignoredFiles: [],
        showIgnored: false,
        diffPreviewEnabled: false,
        selectedPath: '',
        diffPreview: undefined,
        diffLoading: false,
        diffIgnorePolicy: 'none',
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
      let showIgnored = persisted.showIgnored === true;
      let diffPreviewVisible = persisted.diffPreviewVisible === true;
      let changesCollapsed = persisted.changesCollapsed === true;
      let diffViewer = persisted.diffViewer === 'side-by-side' ? 'side-by-side' : 'unified';
      let diffHighlightPolicy = ['word', 'word-split', 'char', 'line', 'none'].includes(persisted.diffHighlightPolicy)
        ? persisted.diffHighlightPolicy
        : 'word';
      let diffIgnorePolicy = ['none', 'trim', 'all', 'all-and-empty', 'formatting'].includes(persisted.diffIgnorePolicy)
        ? persisted.diffIgnorePolicy
        : 'none';
      let collapseUnchanged = persisted.collapseUnchanged !== false;
      let showWhitespace = persisted.showWhitespace === true;
      let showLineNumbers = persisted.showLineNumbers !== false;
      let showIndentGuides = persisted.showIndentGuides !== false;
      let softWrap = persisted.softWrap === true;
      let showBreadcrumbs = persisted.showBreadcrumbs !== false;
      let showBlame = persisted.showBlame === true;
      let activeHunkIndex = 0;
      let changesResizeStart = null;
      let pendingConfirmationAction = '';
      let changesPaneHeight = Number.isFinite(Number(persisted.changesPaneHeight))
        ? Number(persisted.changesPaneHeight)
        : 0;
      let leftPaneWidth = hasPersistedPaneWidth
        ? Number(persisted.leftPaneWidth)
        : 0;
      let collapsedFolders = new Set(Array.isArray(persisted.collapsedFolders)
        ? persisted.collapsedFolders
        : []);
      let dragStart = null;
      let lastRenderedChangesRoot = '';
      let localRenderFrame = 0;
      let stagingDebounceTimer = 0;
      const stagingDebounceDelayMs = 350;
      const pendingStagingStates = new Map();
      const optimisticStagingStates = new Map();
      const stagingRequestSession = ${serializeForScript(nonce)};
      let stagingRequestSequence = 0;
      let pendingStagingRequestId = '';

      window.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'state') {
          const nextState = event.data.state || state;
          const sameRoot = Boolean(state.selectedRoot)
            && state.selectedRoot === nextState.selectedRoot;
          const stateWithOverlay = sameRoot
            ? applyOptimisticStagingOverlay(nextState)
            : nextState;
          const shouldKeepScroll = sameRoot
            && elements['changes-list'];
          const scrollTop = shouldKeepScroll ? captureChangesListScrollTop() : null;
          const nextSelectedPath = typeof stateWithOverlay.selectedPath === 'string'
            ? stateWithOverlay.selectedPath
            : '';
          const keepLocalSelection = sameRoot
            && !nextSelectedPath
            && Boolean(selectedPath)
            && (stateWithOverlay.changes || []).some(function (change) {
              return change.path === selectedPath;
            });

          if (!sameRoot) {
            clearPendingStagingChanges();
            optimisticStagingStates.clear();
          }

          state = keepLocalSelection
            ? Object.assign({}, stateWithOverlay, { selectedPath: selectedPath })
            : stateWithOverlay;
          showIgnored = Boolean(stateWithOverlay.showIgnored);
          diffPreviewVisible = Boolean(stateWithOverlay.diffPreviewEnabled);
          showBlame = Boolean(stateWithOverlay.showBlame);
          diffIgnorePolicy = ['none', 'trim', 'all', 'all-and-empty', 'formatting'].includes(stateWithOverlay.diffIgnorePolicy)
            ? stateWithOverlay.diffIgnorePolicy
            : diffIgnorePolicy;

          if (!keepLocalSelection) {
            selectedPath = nextSelectedPath;
          }
          render({ changesScrollTop: scrollTop });
        }
      });

      document.addEventListener('DOMContentLoaded', function () {
        cacheElements();
        applyPaneSize();
        applyPreviewLayout();
        bindEvents();
        vscode.postMessage({
          type: 'ready',
          ui: {
            showIgnored: showIgnored,
            diffPreviewEnabled: diffPreviewVisible,
            selectedPath: persisted.selectedPath || '',
            diffIgnorePolicy: diffIgnorePolicy,
            showBlame: showBlame
          }
        });
      });

      function cacheElements() {
        [
          'shell',
          'splitter',
          'commit-splitter',
          'changes-toolbar',
          'refresh',
          'rollback-selected',
          'shelve-selected',
          'unstage-all',
          'stage-all',
          'view-options',
          'diff-preview-toggle',
          'open-selected-diff',
          'locate-active-file',
          'expand-all',
          'collapse-all',
          'view-menu',
          'group-directory',
          'group-flat',
          'show-ignored',
          'repo-select',
          'changes-count',
          'changes-summary',
          'changes-root-toggle',
          'changes-root-checkbox',
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
          'settings',
          'diff-preview',
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
          'diff-settings-menu',
          'diff-help-popup',
          'diff-show-blame',
          'diff-show-whitespace',
          'diff-show-line-numbers',
          'diff-show-indent-guides',
          'diff-soft-wrap',
          'diff-breadcrumbs',
          'diff-pathbar',
          'diff-revision',
          'diff-path',
          'diff-body',
          'diff-file-checkbox',
          'diff-content',
          'confirm-dialog',
          'confirm-title',
          'confirm-message',
          'confirm-cancel',
          'confirm-accept'
        ].forEach(function (id) {
          elements[id] = document.getElementById(id);
        });
      }

      function bindEvents() {
        elements.refresh.addEventListener('click', function () {
          vscode.postMessage({ type: 'refresh' });
        });
        elements['rollback-selected'].addEventListener('click', function () {
          openConfirmation(
            'rollbackChange',
            'Rollback selected change?',
            'All tracked edits in ' + selectedPath + ' will be restored to HEAD.'
          );
        });
        elements['shelve-selected'].addEventListener('click', function () {
          openConfirmation(
            'shelveChange',
            'Shelve selected change?',
            'Changes in ' + selectedPath + ' will be moved to a recoverable Git stash.'
          );
        });
        elements['stage-all'].addEventListener('click', function () {
          vscode.postMessage({ type: 'stageAll' });
        });
        elements['unstage-all'].addEventListener('click', function () {
          vscode.postMessage({ type: 'unstageAll' });
        });
        elements['view-options'].addEventListener('click', function (event) {
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
        elements['show-ignored'].addEventListener('click', function () {
          showIgnored = !showIgnored;
          persistUiState();
          renderViewModeControls();
          closeViewMenu();
          vscode.postMessage({ type: 'setShowIgnored', showIgnored: showIgnored });
        });
        elements['diff-preview-toggle'].addEventListener('click', toggleDiffPreview);
        elements['open-selected-diff'].addEventListener('click', openSelectedDiff);
        elements['locate-active-file'].addEventListener('click', function () {
          vscode.postMessage({ type: 'locateActiveFile' });
        });
        elements['expand-all'].addEventListener('click', expandAllFolders);
        elements['collapse-all'].addEventListener('click', collapseAllFolders);
        elements['changes-root-toggle'].addEventListener('click', toggleChangesRoot);
        elements['changes-root-checkbox'].addEventListener('change', function (event) {
          const checked = event.target.checked;
          const paths = (state.changes || []).map(function (change) { return change.path; });
          setLocalChecked(paths, checked);
          queueStagingChanges(paths, checked);
        });
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
        elements['diff-file-checkbox'].addEventListener('change', function (event) {
          if (!selectedPath) {
            return;
          }

          setLocalChecked([selectedPath], event.target.checked);
          queueStagingChanges([selectedPath], event.target.checked);
        });
        elements['diff-prev-change'].addEventListener('click', function () { moveToHunk(-1); });
        elements['diff-next-change'].addEventListener('click', function () { moveToHunk(1); });
        elements['diff-prev-file'].addEventListener('click', function () { moveToFile(-1); });
        elements['diff-next-file'].addEventListener('click', function () { moveToFile(1); });
        elements['diff-edit-source'].addEventListener('click', function () {
          if (selectedPath) {
            vscode.postMessage({ type: 'openFile', path: selectedPath });
          }
        });
        elements['diff-open-native'].addEventListener('click', openSelectedDiff);
        elements['diff-viewer'].addEventListener('change', function (event) {
          diffViewer = event.target.value === 'side-by-side' ? 'side-by-side' : 'unified';
          persistUiState();
          renderDiffPreview();
        });
        elements['diff-ignore-policy'].addEventListener('change', function (event) {
          diffIgnorePolicy = ['none', 'trim', 'all', 'all-and-empty', 'formatting'].includes(event.target.value)
            ? event.target.value
            : 'none';
          persistUiState();
          vscode.postMessage({ type: 'setDiffOptions', ignorePolicy: diffIgnorePolicy });
        });
        elements['diff-highlight-policy'].addEventListener('change', function (event) {
          diffHighlightPolicy = event.target.value;
          persistUiState();
          renderDiffPreview();
        });
        elements['diff-collapse-unchanged'].addEventListener('click', function () {
          collapseUnchanged = !collapseUnchanged;
          persistUiState();
          renderDiffPreview();
        });
        elements['diff-settings'].addEventListener('click', function (event) {
          event.stopPropagation();
          togglePopup('diff-settings-menu', 'diff-settings');
        });
        elements['diff-help'].addEventListener('click', function (event) {
          event.stopPropagation();
          togglePopup('diff-help-popup', 'diff-help');
        });
        elements['diff-settings-menu'].addEventListener('click', function (event) { event.stopPropagation(); });
        elements['diff-help-popup'].addEventListener('click', function (event) { event.stopPropagation(); });
        bindBooleanDiffSetting('diff-show-whitespace', function () { return showWhitespace; }, function (value) { showWhitespace = value; });
        bindBooleanDiffSetting('diff-show-line-numbers', function () { return showLineNumbers; }, function (value) { showLineNumbers = value; });
        bindBooleanDiffSetting('diff-show-indent-guides', function () { return showIndentGuides; }, function (value) { showIndentGuides = value; });
        bindBooleanDiffSetting('diff-soft-wrap', function () { return softWrap; }, function (value) { softWrap = value; });
        bindBooleanDiffSetting('diff-breadcrumbs', function () { return showBreadcrumbs; }, function (value) { showBreadcrumbs = value; });
        elements['diff-show-blame'].addEventListener('click', function () {
          showBlame = !showBlame;
          persistUiState();
          renderDiffSettings();
          vscode.postMessage({ type: 'setDiffBlame', enabled: showBlame });
        });
        elements['confirm-cancel'].addEventListener('click', closeConfirmation);
        elements['confirm-accept'].addEventListener('click', function () {
          if (pendingConfirmationAction && selectedPath) {
            vscode.postMessage({ type: pendingConfirmationAction, path: selectedPath });
          }
          closeConfirmation();
        });
        elements.splitter.addEventListener('pointerdown', startResize);
        elements.splitter.addEventListener('dblclick', resetPaneWidth);
        elements.splitter.addEventListener('keydown', resizeWithKeyboard);
        elements['commit-splitter'].addEventListener('pointerdown', startChangesResize);
        elements['commit-splitter'].addEventListener('keydown', resizeChangesWithKeyboard);
        document.addEventListener('click', closeAllMenus);
        document.addEventListener('keydown', function (event) {
          if (event.key === 'Escape') {
            closeAllMenus();
            closeConfirmation();
          }

          if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'p') {
            event.preventDefault();
            setViewMode(viewMode === 'directory' ? 'flat' : 'directory');
            return;
          }

          if (diffPreviewVisible && event.altKey && event.key === 'ArrowUp') {
            event.preventDefault();
            moveToHunk(-1);
          } else if (diffPreviewVisible && event.altKey && event.key === 'ArrowDown') {
            event.preventDefault();
            moveToHunk(1);
          } else if (diffPreviewVisible && event.altKey && event.key === 'ArrowLeft') {
            event.preventDefault();
            moveToFile(-1);
          } else if (diffPreviewVisible && event.altKey && event.key === 'ArrowRight') {
            event.preventDefault();
            moveToFile(1);
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
          viewMode: viewMode,
          showIgnored: showIgnored,
          diffPreviewVisible: diffPreviewVisible,
          selectedPath: selectedPath,
          diffViewer: diffViewer,
          diffHighlightPolicy: diffHighlightPolicy,
          diffIgnorePolicy: diffIgnorePolicy,
          collapseUnchanged: collapseUnchanged,
          showWhitespace: showWhitespace,
          showLineNumbers: showLineNumbers,
          showIndentGuides: showIndentGuides,
          softWrap: softWrap,
          showBreadcrumbs: showBreadcrumbs,
          showBlame: showBlame,
          changesCollapsed: changesCollapsed,
          changesPaneHeight: changesPaneHeight
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

      function render(options) {
        applyPreviewLayout();
        renderRepositories();
        renderChanges({
          scrollTop: options ? options.changesScrollTop : null
        });
        renderCommitPanel();
        renderDiffPreview();
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
        elements['view-options'].setAttribute('aria-expanded', 'true');
        elements['view-options'].classList.add('active');
      }

      function closeViewMenu() {
        if (!elements['view-menu'] || elements['view-menu'].hidden) {
          return;
        }

        elements['view-menu'].hidden = true;
        elements['view-options'].setAttribute('aria-expanded', 'false');
        elements['view-options'].classList.remove('active');
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

      function toggleDiffPreview() {
        diffPreviewVisible = !diffPreviewVisible;
        persistUiState();
        applyPreviewLayout();
        renderDiffPreview();
        vscode.postMessage({ type: 'setDiffPreviewEnabled', enabled: diffPreviewVisible });

        if (diffPreviewVisible && selectedPath) {
          vscode.postMessage({ type: 'selectChange', path: selectedPath });
        }
      }

      function applyPreviewLayout() {
        if (!elements.shell) {
          return;
        }

        elements.shell.classList.toggle('preview-visible', diffPreviewVisible);
        elements['diff-preview-toggle'].classList.toggle('active', diffPreviewVisible);
        elements['diff-preview-toggle'].setAttribute('aria-pressed', diffPreviewVisible ? 'true' : 'false');
        elements['diff-preview-toggle'].title = diffPreviewVisible ? 'Hide diff preview' : 'Show diff preview';

        if (changesPaneHeight > 0) {
          elements.shell.style.setProperty('--changes-pane-height', changesPaneHeight + 'px');
        }
      }

      function selectPath(filePath) {
        if (!(state.changes || []).some(function (change) { return change.path === filePath; })) {
          return;
        }

        const changed = selectedPath !== filePath;
        selectedPath = filePath;
        persistUiState();

        if (changed) {
          activeHunkIndex = 0;
          state = Object.assign({}, state, {
            selectedPath: selectedPath,
            diffLoading: diffPreviewVisible,
            diffPreview: diffPreviewVisible ? undefined : state.diffPreview
          });
        }

        renderChangesKeepingScroll();
        renderDiffPreview();

        vscode.postMessage({ type: 'selectChange', path: selectedPath });
      }

      function openSelectedDiff() {
        if (selectedPath) {
          vscode.postMessage({ type: 'openDiff', path: selectedPath });
        }
      }

      function moveToFile(direction) {
        const changes = state.changes || [];

        if (changes.length === 0) {
          return;
        }

        const currentIndex = Math.max(0, changes.findIndex(function (change) {
          return change.path === selectedPath;
        }));
        const nextIndex = (currentIndex + direction + changes.length) % changes.length;
        selectPath(changes[nextIndex].path);
      }

      function toggleChangesRoot() {
        changesCollapsed = !changesCollapsed;
        persistUiState();
        renderChanges();
      }

      function closeAllMenus() {
        closeViewMenu();
        closePopup('diff-settings-menu', 'diff-settings');
        closePopup('diff-help-popup', 'diff-help');
      }

      function openConfirmation(action, title, message) {
        if (!selectedPath) {
          return;
        }

        pendingConfirmationAction = action;
        elements['confirm-title'].textContent = title;
        elements['confirm-message'].textContent = message;
        elements['confirm-dialog'].hidden = false;
        elements['confirm-accept'].focus();
      }

      function closeConfirmation() {
        pendingConfirmationAction = '';
        elements['confirm-dialog'].hidden = true;
      }

      function togglePopup(menuId, triggerId) {
        const menu = elements[menuId];
        const willOpen = menu.hidden;
        closeAllMenus();
        menu.hidden = !willOpen;
        elements[triggerId].classList.toggle('active', willOpen);
        elements[triggerId].setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      }

      function closePopup(menuId, triggerId) {
        const menu = elements[menuId];

        if (!menu) {
          return;
        }

        menu.hidden = true;
        elements[triggerId].classList.remove('active');
        elements[triggerId].setAttribute('aria-expanded', 'false');
      }

      function bindBooleanDiffSetting(elementId, getter, setter) {
        elements[elementId].addEventListener('click', function () {
          setter(!getter());
          persistUiState();
          renderDiffSettings();
          renderDiffPreview();
        });
      }

      function startChangesResize(event) {
        if (!diffPreviewVisible) {
          return;
        }

        event.preventDefault();
        changesResizeStart = { pointerId: event.pointerId };
        elements['commit-splitter'].classList.add('dragging');
        elements['commit-splitter'].setPointerCapture(event.pointerId);
        elements['commit-splitter'].addEventListener('pointermove', moveChangesResize);
        elements['commit-splitter'].addEventListener('pointerup', stopChangesResize);
        elements['commit-splitter'].addEventListener('pointercancel', stopChangesResize);
      }

      function moveChangesResize(event) {
        if (!changesResizeStart) {
          return;
        }

        const rect = elements.shell.getBoundingClientRect();
        changesPaneHeight = clamp(event.clientY - rect.top, 140, Math.max(140, rect.height - 162));
        elements.shell.style.setProperty('--changes-pane-height', changesPaneHeight + 'px');
      }

      function stopChangesResize() {
        if (!changesResizeStart) {
          return;
        }

        changesResizeStart = null;
        elements['commit-splitter'].classList.remove('dragging');
        elements['commit-splitter'].removeEventListener('pointermove', moveChangesResize);
        elements['commit-splitter'].removeEventListener('pointerup', stopChangesResize);
        elements['commit-splitter'].removeEventListener('pointercancel', stopChangesResize);
        persistUiState();
      }

      function resizeChangesWithKeyboard(event) {
        const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End'];

        if (!diffPreviewVisible || !keys.includes(event.key)) {
          return;
        }

        event.preventDefault();
        const rect = elements.shell.getBoundingClientRect();
        const minimum = 140;
        const maximum = Math.max(minimum, rect.height - 162);
        const current = changesPaneHeight > 0
          ? changesPaneHeight
          : clamp(rect.height * 0.56, minimum, maximum);

        if (event.key === 'ArrowUp') {
          changesPaneHeight = current - 20;
        } else if (event.key === 'ArrowDown') {
          changesPaneHeight = current + 20;
        } else if (event.key === 'Home') {
          changesPaneHeight = minimum;
        } else {
          changesPaneHeight = maximum;
        }

        changesPaneHeight = clamp(changesPaneHeight, minimum, maximum);
        elements.shell.style.setProperty('--changes-pane-height', changesPaneHeight + 'px');
        persistUiState();
      }

      function positionViewMenu() {
        const toolbarRect = elements['changes-toolbar'].getBoundingClientRect();
        const buttonRect = elements['view-options'].getBoundingClientRect();
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

      function renderChanges(options) {
        renderChangesWithScroll(options);
      }

      function renderChangesKeepingScroll() {
        renderChangesWithScroll({
          scrollTop: captureChangesListScrollTop()
        });
      }

      function scheduleLocalRender() {
        if (localRenderFrame) {
          return;
        }

        const requestFrame = window.requestAnimationFrame || function (callback) {
          return window.setTimeout(callback, 0);
        };

        localRenderFrame = requestFrame(function () {
          localRenderFrame = 0;
          renderChangesKeepingScroll();
          renderCommitPanel();
          renderDiffPreview();
        });
      }

      function renderChangesWithScroll(options) {
        const selectedRoot = state.selectedRoot || '';
        const changes = state.changes || [];
        const ignoredFiles = showIgnored ? state.ignoredFiles || [] : [];
        const scrollTop = options && Number.isFinite(options.scrollTop)
          ? options.scrollTop
          : null;
        elements['changes-count'].textContent = String(state.totalCount || 0);
        elements['changes-summary'].textContent = state.busy
          ? 'updating...'
          : changeSummary();
        elements['changes-list'].replaceChildren();
        elements['changes-list'].hidden = changesCollapsed;
        elements['changes-root-toggle'].classList.toggle('expanded', !changesCollapsed);
        elements['changes-root-toggle'].classList.toggle('collapsed', changesCollapsed);
        elements['changes-root-toggle'].title = changesCollapsed ? 'Expand changes' : 'Collapse changes';
        elements['changes-root-toggle'].setAttribute('aria-label', elements['changes-root-toggle'].title);
        const allIncluded = changes.length > 0 && changes.every(function (change) {
          return change.staged && !change.partiallyStaged;
        });
        const anyIncluded = changes.some(function (change) { return change.staged; });
        elements['changes-root-checkbox'].checked = allIncluded;
        elements['changes-root-checkbox'].indeterminate = !allIncluded && anyIncluded;
        elements['changes-root-checkbox'].disabled = Boolean(state.busy) || changes.length === 0;
        lastRenderedChangesRoot = selectedRoot;

        if (!state.selectedRoot) {
          elements['changes-list'].appendChild(empty('No Git repository', 'Open a folder that contains a Git repository.'));
          selectedPath = '';
          restoreChangesListScrollTop(scrollTop, selectedRoot);
          return;
        }

        if (changesCollapsed) {
          restoreChangesListScrollTop(scrollTop, selectedRoot);
          return;
        }

        if (changes.length === 0 && ignoredFiles.length === 0) {
          elements['changes-list'].appendChild(empty('No local changes', 'Edit files in this repository. Checked files will be staged automatically.'));
          selectedPath = '';
          restoreChangesListScrollTop(scrollTop, selectedRoot);
          return;
        }

        if (changes.length > 0 && (!selectedPath || !changes.some(function (change) { return change.path === selectedPath; }))) {
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

        if (ignoredFiles.length > 0) {
          const ignoredTitle = document.createElement('div');
          ignoredTitle.className = 'ignored-group';
          ignoredTitle.textContent = 'Ignored Files ' + ignoredFiles.length;
          fragment.appendChild(ignoredTitle);
          ignoredFiles.forEach(function (change) {
            fragment.appendChild(ignoredFileRow(change));
          });
        }

        elements['changes-list'].appendChild(fragment);
        restoreChangesListScrollTop(scrollTop, selectedRoot);
      }

      function captureChangesListScrollTop() {
        if (!elements['changes-list']) {
          return 0;
        }

        return elements['changes-list'].scrollTop;
      }

      function restoreChangesListScrollTop(scrollTop, selectedRoot) {
        if (!Number.isFinite(scrollTop) || lastRenderedChangesRoot !== selectedRoot) {
          return;
        }

        const restore = function () {
          if (lastRenderedChangesRoot !== selectedRoot || !elements['changes-list']) {
            return;
          }

          const list = elements['changes-list'];
          const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
          list.scrollTop = Math.min(scrollTop, maxScrollTop);
        };

        restore();
        window.requestAnimationFrame(restore);
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
            stagedCount: change.staged && !change.partiallyStaged ? 1 : 0,
            includedCount: change.staged ? 1 : 0
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
          stagedCount: 0,
          includedCount: 0
        };
      }

      function finalizeFolder(node) {
        node.fileCount = 0;
        node.stagedCount = 0;
        node.includedCount = 0;

        node.children.forEach(function (child) {
          if (child.type === 'folder') {
            finalizeFolder(child);
          }

          node.fileCount += child.fileCount;
          node.stagedCount += child.stagedCount;
          node.includedCount += child.includedCount;
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
        const partiallyChecked = !allChecked && node.includedCount > 0;

        row.className = 'tree-row folder-row';
        row.style.paddingLeft = treePadding(depth);
        row.title = node.path + '\\n' + node.includedCount + '/' + node.fileCount + ' checked';

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
          const paths = collectFilePaths(node);
          const checked = resolveFolderCheckboxChecked(
            paths.length,
            countFullyCheckedPaths(paths)
          );

          event.currentTarget.checked = checked;
          event.currentTarget.indeterminate = false;
          setLocalChecked(paths, checked);
          queueStagingChanges(paths, checked);
        });

        const name = document.createElement('span');
        name.className = 'folder-main';
        name.textContent = node.name;

        const count = document.createElement('span');
        count.className = 'folder-count';
        count.textContent = node.includedCount + '/' + node.fileCount;

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
        checkbox.checked = Boolean(change.staged && !change.partiallyStaged);
        checkbox.indeterminate = Boolean(change.partiallyStaged);
        checkbox.disabled = Boolean(state.busy);
        checkbox.addEventListener('click', function (event) {
          event.stopPropagation();
        });
        checkbox.addEventListener('change', function (event) {
          setLocalChecked([change.path], event.target.checked);
          queueStagingChanges([change.path], event.target.checked);
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
          selectPath(change.path);
        });
        row.addEventListener('dblclick', function () {
          vscode.postMessage({ type: 'openDiff', path: change.path });
        });

        return row;
      }

      function ignoredFileRow(change) {
        const row = document.createElement('div');
        row.className = 'tree-row file-row ignored-row';
        row.style.paddingLeft = treePadding(0);
        row.title = change.path + '\\nIgnored by Git';

        const spacer = document.createElement('span');
        spacer.className = 'disclosure-spacer';
        spacer.setAttribute('aria-hidden', 'true');

        const checkbox = document.createElement('input');
        checkbox.className = 'file-checkbox';
        checkbox.type = 'checkbox';
        checkbox.disabled = true;

        const main = document.createElement('span');
        main.className = 'file-main';
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = baseName(change.path);
        const directory = directoryName(change.path);
        main.appendChild(name);

        if (directory) {
          const directoryNode = document.createElement('span');
          directoryNode.className = 'file-directory';
          directoryNode.textContent = directory;
          main.appendChild(directoryNode);
        }

        const status = document.createElement('span');
        status.className = 'status';
        status.textContent = 'I';
        status.title = 'Ignored by Git';

        row.appendChild(spacer);
        row.appendChild(checkbox);
        row.appendChild(createFileIcon(change.path));
        row.appendChild(main);
        row.appendChild(status);
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

      function countFullyCheckedPaths(paths) {
        const pathSet = new Set(paths);

        return (state.changes || []).filter(function (change) {
          return pathSet.has(change.path) && change.staged && !change.partiallyStaged;
        }).length;
      }

      function queueStagingChanges(paths, checked) {
        const requestId = pendingStagingRequestId || nextStagingRequestId();
        pendingStagingRequestId = requestId;

        uniquePaths(paths).forEach(function (filePath) {
          pendingStagingStates.set(filePath, Boolean(checked));
          optimisticStagingStates.set(filePath, {
            checked: Boolean(checked),
            requestId: requestId
          });
        });

        scheduleStagingDebounce();
      }

      function nextStagingRequestId() {
        stagingRequestSequence += 1;
        return stagingRequestSession + '-' + stagingRequestSequence;
      }

      function scheduleStagingDebounce() {
        if (stagingDebounceTimer) {
          window.clearTimeout(stagingDebounceTimer);
        }

        stagingDebounceTimer = window.setTimeout(function () {
          stagingDebounceTimer = 0;
          flushPendingStagingChanges();
        }, stagingDebounceDelayMs);
      }

      function flushPendingStagingChanges() {
        const requestId = pendingStagingRequestId;
        const changes = Array.from(pendingStagingStates.entries()).map(
          function ([path, checked]) {
            return { path: path, checked: checked };
          }
        );

        if (stagingDebounceTimer) {
          window.clearTimeout(stagingDebounceTimer);
          stagingDebounceTimer = 0;
        }

        pendingStagingStates.clear();
        pendingStagingRequestId = '';

        if (!requestId || changes.length === 0) {
          return;
        }

        vscode.postMessage({
          type: 'applyStagingBatch',
          requestId: requestId,
          changes: changes
        });
      }

      function clearPendingStagingChanges() {
        if (stagingDebounceTimer) {
          window.clearTimeout(stagingDebounceTimer);
          stagingDebounceTimer = 0;
        }

        pendingStagingStates.clear();
        pendingStagingRequestId = '';
      }

      function applyOptimisticStagingOverlay(nextState) {
        if (optimisticStagingStates.size === 0 || nextState.errorText) {
          if (nextState.errorText) {
            optimisticStagingStates.clear();
            clearPendingStagingChanges();
          }

          return nextState;
        }

        const reconciliation = reconcileOptimisticStagingChanges(
          nextState.changes,
          optimisticStagingStates,
          nextState.confirmedStagingRequestIds
        );
        optimisticStagingStates.clear();
        reconciliation.optimisticStagingStates.forEach(function (optimisticState, filePath) {
          optimisticStagingStates.set(filePath, optimisticState);
        });

        if (!reconciliation.hasOverlay) {
          return nextState;
        }

        const changes = reconciliation.changes;
        const stagedCount = changes.filter(function (change) { return change.staged; }).length;

        return Object.assign({}, nextState, {
          changes: changes,
          stagedCount: stagedCount,
          totalCount: changes.length,
          canGenerate: stagedCount > 0,
          statusText: changeSummaryFromCounts(stagedCount, changes.length)
        });
      }

      function uniquePaths(paths) {
        return Array.from(new Set((paths || []).map(function (filePath) {
          return String(filePath || '');
        }).filter(Boolean)));
      }

      function localCheckedChange(change, checked) {
        return Object.assign({}, change, {
          staged: checked,
          hasStaged: checked,
          hasUnstaged: !checked,
          partiallyStaged: false
        });
      }

      function setLocalChecked(paths, checked) {
        const pathSet = new Set(paths);
        const changes = (state.changes || []).map(function (change) {
          if (!pathSet.has(change.path)) {
            return change;
          }

          return localCheckedChange(change, checked);
        });
        const stagedCount = changes.filter(function (change) { return change.staged; }).length;

        state = Object.assign({}, state, {
          changes: changes,
          diffPreview: state.diffPreview && pathSet.has(selectedPath)
            ? Object.assign({}, state.diffPreview, {
              fileIncluded: checked,
              filePartiallyIncluded: false,
              hunks: (state.diffPreview.hunks || []).map(function (hunk) {
                return Object.assign({}, hunk, { included: checked });
              }),
              includedCount: checked ? (state.diffPreview.hunks || []).length : 0
            })
            : state.diffPreview,
          stagedCount: stagedCount,
          totalCount: changes.length,
          canGenerate: stagedCount > 0,
          statusText: changeSummaryFromCounts(stagedCount, changes.length),
          errorText: ''
        });

        scheduleLocalRender();
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
        const selectedChange = (state.changes || []).find(function (change) {
          return change.path === selectedPath;
        });
        const hasFolders = viewMode === 'directory' && hasChanges && collectFolderPaths().length > 0;
        elements.commit.disabled = Boolean(state.busy) || !hasRepo || !hasMessage;
        elements['commit-push'].disabled = Boolean(state.busy) || !hasRepo || !hasMessage;
        elements.generate.disabled = Boolean(state.busy) || !hasRepo || !state.canGenerate;
        elements['commit-language'].disabled = Boolean(state.busy);
        elements['stage-all'].disabled = Boolean(state.busy) || !hasRepo || !hasChanges;
        elements['unstage-all'].disabled = Boolean(state.busy) || !hasRepo || state.stagedCount === 0;
        elements['rollback-selected'].disabled = Boolean(state.busy)
          || !selectedChange
          || selectedChange.untracked
          || selectedChange.kind === 'added';
        elements['shelve-selected'].disabled = Boolean(state.busy) || !selectedChange;
        elements['view-options'].disabled = !hasRepo;
        elements['diff-preview-toggle'].disabled = !hasRepo || !hasChanges;
        elements['open-selected-diff'].disabled = !hasRepo || !selectedPath;
        elements['locate-active-file'].disabled = !hasRepo;
        elements['expand-all'].disabled = !hasFolders;
        elements['collapse-all'].disabled = !hasFolders;
        renderViewModeControls();

        elements['footer-status'].textContent = state.errorText || state.statusText || '';
        elements['footer-status'].classList.toggle('error', Boolean(state.errorText));
      }

      function renderDiffPreview() {
        applyPreviewLayout();
        renderDiffSettings();

        if (!diffPreviewVisible) {
          return;
        }

        const preview = state.diffPreview;
        const content = elements['diff-content'];
        const differences = preview?.differenceCount || 0;
        const included = preview?.includedCount || 0;
        const hasSelection = Boolean(selectedPath);
        elements['diff-stats'].textContent = differences
          + (differences === 1 ? ' difference, ' : ' differences, ')
          + included
          + ' included';
        elements['diff-revision'].textContent = String(state.lastCommit || '').split(' ')[0] || 'HEAD';
        elements['diff-path'].textContent = selectedPath || 'Select a changed file';
        elements['diff-pathbar'].hidden = !showBreadcrumbs;
        elements['diff-file-checkbox'].checked = Boolean(preview?.fileIncluded);
        elements['diff-file-checkbox'].indeterminate = Boolean(preview?.filePartiallyIncluded);
        elements['diff-file-checkbox'].disabled = Boolean(state.busy)
          || !preview?.canToggleFile
          || !hasSelection;
        elements['diff-prev-file'].disabled = (state.changes || []).length < 2;
        elements['diff-next-file'].disabled = (state.changes || []).length < 2;
        elements['diff-edit-source'].disabled = !hasSelection;
        elements['diff-open-native'].disabled = !hasSelection;
        elements['diff-prev-change'].disabled = differences === 0;
        elements['diff-next-change'].disabled = differences === 0;
        elements['diff-viewer'].value = diffViewer;
        elements['diff-ignore-policy'].value = diffIgnorePolicy;
        elements['diff-highlight-policy'].value = diffHighlightPolicy;
        elements['diff-collapse-unchanged'].classList.toggle('active', collapseUnchanged);
        elements['diff-collapse-unchanged'].setAttribute('aria-pressed', collapseUnchanged ? 'true' : 'false');
        elements['diff-body'].className = 'diff-body highlight-' + diffHighlightPolicy + (softWrap ? ' soft-wrap' : '');
        content.replaceChildren();

        if (state.diffLoading) {
          content.appendChild(diffEmpty('Loading differences...'));
          return;
        }

        if (!preview) {
          content.appendChild(diffEmpty(hasSelection
            ? 'Loading differences...'
            : 'Select a changed file to preview it.'));
          return;
        }

        if (!Array.isArray(preview.hunks) || preview.hunks.length === 0) {
          content.appendChild(diffEmpty(preview.message || 'No textual differences.'));
          return;
        }

        activeHunkIndex = clamp(activeHunkIndex, 0, preview.hunks.length - 1);
        preview.hunks.forEach(function (hunk, index) {
          content.appendChild(renderDiffHunk(hunk, index, preview));
        });
      }

      function renderDiffHunk(hunk, index, preview) {
        const section = document.createElement('section');
        section.className = 'diff-hunk' + (index === activeHunkIndex ? ' active' : '');
        section.dataset.hunkIndex = String(index);

        const header = document.createElement('div');
        header.className = 'diff-hunk-header' + (hunk.included ? ' included' : '');
        const checkbox = document.createElement('input');
        checkbox.className = 'file-checkbox';
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(hunk.included);
        checkbox.disabled = Boolean(state.busy)
          || !preview.canToggleHunks
          || hunk.canToggle === false;
        checkbox.title = hunk.included ? 'Exclude this difference from commit' : 'Include this difference in commit';
        checkbox.addEventListener('change', function (event) {
          vscode.postMessage({
            type: 'toggleHunk',
            path: selectedPath,
            hunkId: hunk.id,
            checked: event.target.checked
          });
        });

        const title = document.createElement('span');
        title.textContent = hunk.header || 'Changed fragment';
        const source = document.createElement('span');
        source.className = 'diff-hunk-source';
        source.textContent = hunk.included ? 'Included changes' : 'Not included';
        header.appendChild(checkbox);
        header.appendChild(title);
        header.appendChild(source);
        section.appendChild(header);

        const lines = collapseUnchanged ? collapseContextLines(hunk.lines || []) : hunk.lines || [];

        if (diffViewer === 'side-by-side') {
          pairSideBySideLines(lines).forEach(function (pair) {
            section.appendChild(renderSideBySideRow(pair, preview));
          });
        } else {
          lines.forEach(function (line) {
            section.appendChild(renderUnifiedDiffRow(line, preview));
          });
        }

        return section;
      }

      function renderUnifiedDiffRow(line, preview) {
        if (line.type === 'omitted') {
          return omittedDiffRow(line.count);
        }

        const row = document.createElement('div');
        row.className = 'diff-row ' + line.type + (showLineNumbers ? '' : ' hide-line-numbers');

        if (showLineNumbers) {
          row.appendChild(diffLineNumber(line.oldLine));
          row.appendChild(diffLineNumber(line.newLine));
        }

        const code = document.createElement('span');
        code.className = 'diff-code';
        appendDiffCode(code, line, preview);
        row.appendChild(code);
        return row;
      }

      function renderSideBySideRow(pair, preview) {
        if (pair.omitted) {
          return omittedDiffRow(pair.count);
        }

        const row = document.createElement('div');
        row.className = 'diff-row side-by-side';
        row.appendChild(renderDiffSide(pair.left, preview, 'left'));
        row.appendChild(renderDiffSide(pair.right, preview, 'right'));
        return row;
      }

      function renderDiffSide(line, preview, sideName) {
        const side = document.createElement('div');
        side.className = 'diff-side ' + (line?.type || 'context') + (showLineNumbers ? '' : ' hide-line-numbers');

        if (showLineNumbers) {
          side.appendChild(diffLineNumber(line
            ? sideName === 'left' ? line.oldLine : line.newLine
            : null));
        }

        const code = document.createElement('span');
        code.className = 'diff-code';

        if (line) {
          appendDiffCode(code, line, preview);
        }

        side.appendChild(code);
        return side;
      }

      function appendDiffCode(container, line, preview) {
        if (showBlame && line.newLine && preview.blame?.[line.newLine]) {
          const blame = document.createElement('span');
          blame.className = 'diff-blame';
          blame.textContent = preview.blame[line.newLine];
          blame.title = preview.blame[line.newLine];
          container.appendChild(blame);
        }

        const text = visibleWhitespace(line.text || '');
        if ((line.type === 'add' || line.type === 'delete')
          && ['word', 'word-split', 'char'].includes(diffHighlightPolicy)) {
          appendHighlightedSegments(container, text, line.type);
        } else {
          appendIndentAwareText(container, text);
        }
      }

      function appendHighlightedSegments(container, text, lineType) {
        const pattern = diffHighlightPolicy === 'char'
          ? /([\\s\\S])/g
          : diffHighlightPolicy === 'word-split'
            ? /(\\s+|[A-Za-z0-9_$]+|.)/g
            : /(\\s+|\\S+)/g;
        const segments = String(text).match(pattern) || [];

        segments.forEach(function (segment) {
          if (/^\\s+$/.test(segment)) {
            container.appendChild(document.createTextNode(segment));
            return;
          }

          const mark = document.createElement('span');
          mark.className = 'diff-mark ' + lineType;
          appendSyntaxText(mark, segment);
          container.appendChild(mark);
        });
      }

      function appendIndentAwareText(container, text) {
        const match = /^[ \\t]+/.exec(text);

        if (!match) {
          appendSyntaxText(container, text);
          return;
        }

        const indentation = match[0];
        const rest = text.slice(indentation.length);

        if (showIndentGuides) {
          const chunks = indentation.match(/(?: {1,2}|\\t)/g) || [indentation];
          chunks.forEach(function (chunk) {
            const guide = document.createElement('span');
            guide.className = 'indent-guide';
            guide.textContent = chunk;
            container.appendChild(guide);
          });
        } else {
          container.appendChild(document.createTextNode(indentation));
        }

        appendSyntaxText(container, rest);
      }

      function appendSyntaxText(container, text) {
        const tokenPattern = /(\\/\\/.*$|#.*$|\\/\\*.*?\\*\\/|'(?:\\\\.|[^'])*'|"(?:\\\\.|[^"])*"|\\$[A-Za-z_][A-Za-z0-9_]*|\\b(?:class|function|public|private|protected|static|return|if|else|for|foreach|while|new|const|let|var|async|await|throw|try|catch|true|false|null)\\b|\\b\\d+(?:\\.\\d+)?\\b)/gm;
        let cursor = 0;
        let match;

        while ((match = tokenPattern.exec(text))) {
          if (match.index > cursor) {
            container.appendChild(document.createTextNode(text.slice(cursor, match.index)));
          }

          const token = document.createElement('span');
          token.className = tokenClass(match[0]);
          token.textContent = match[0];
          container.appendChild(token);
          cursor = match.index + match[0].length;
        }

        if (cursor < text.length) {
          container.appendChild(document.createTextNode(text.slice(cursor)));
        }
      }

      function tokenClass(token) {
        if (token.startsWith('//') || token.startsWith('#') || token.startsWith('/*')) {
          return 'tok-comment';
        }
        if (token.startsWith("'") || token.startsWith('"')) {
          return 'tok-string';
        }
        if (token.startsWith('$')) {
          return 'tok-variable';
        }
        if (/^\\d/.test(token)) {
          return 'tok-number';
        }
        return 'tok-keyword';
      }

      function visibleWhitespace(text) {
        if (!showWhitespace) {
          return text;
        }

        return String(text).replace(/ /g, '\\u00b7').replace(/\\t/g, '\\u2192   ');
      }

      function diffLineNumber(value) {
        const number = document.createElement('span');
        number.className = 'diff-line-number';
        number.textContent = value == null ? '' : String(value);
        return number;
      }

      function collapseContextLines(lines) {
        const result = [];
        let index = 0;

        while (index < lines.length) {
          if (lines[index].type !== 'context') {
            result.push(lines[index]);
            index += 1;
            continue;
          }

          let end = index;
          while (end < lines.length && lines[end].type === 'context') {
            end += 1;
          }
          const run = lines.slice(index, end);

          if (run.length > 2) {
            result.push(run[0]);
            result.push({ type: 'omitted', count: run.length - 2 });
            result.push(run[run.length - 1]);
          } else {
            result.push(...run);
          }

          index = end;
        }

        return result;
      }

      function pairSideBySideLines(lines) {
        const pairs = [];
        let index = 0;

        while (index < lines.length) {
          const line = lines[index];

          if (line.type === 'omitted') {
            pairs.push({ omitted: true, count: line.count });
            index += 1;
            continue;
          }

          if (line.type === 'delete') {
            const deleted = [];
            const added = [];
            while (index < lines.length && lines[index].type === 'delete') {
              deleted.push(lines[index]);
              index += 1;
            }
            while (index < lines.length && lines[index].type === 'add') {
              added.push(lines[index]);
              index += 1;
            }
            const length = Math.max(deleted.length, added.length);
            for (let pairIndex = 0; pairIndex < length; pairIndex += 1) {
              pairs.push({ left: deleted[pairIndex], right: added[pairIndex] });
            }
            continue;
          }

          if (line.type === 'add') {
            pairs.push({ left: undefined, right: line });
          } else {
            pairs.push({ left: line, right: line });
          }
          index += 1;
        }

        return pairs;
      }

      function omittedDiffRow(count) {
        const row = document.createElement('div');
        row.className = 'diff-omitted';
        row.textContent = count + (count === 1 ? ' unchanged line' : ' unchanged lines');
        return row;
      }

      function diffEmpty(message) {
        const node = document.createElement('div');
        node.className = 'diff-empty';
        node.textContent = message;
        return node;
      }

      function moveToHunk(direction) {
        const hunks = Array.from(elements['diff-content'].querySelectorAll('.diff-hunk'));

        if (hunks.length === 0) {
          return;
        }

        activeHunkIndex = (activeHunkIndex + direction + hunks.length) % hunks.length;
        hunks.forEach(function (hunk, index) {
          hunk.classList.toggle('active', index === activeHunkIndex);
        });
        hunks[activeHunkIndex].scrollIntoView({ block: 'start', behavior: 'smooth' });
      }

      function renderDiffSettings() {
        setMenuCheck('diff-show-blame', showBlame);
        setMenuCheck('diff-show-whitespace', showWhitespace);
        setMenuCheck('diff-show-line-numbers', showLineNumbers);
        setMenuCheck('diff-show-indent-guides', showIndentGuides);
        setMenuCheck('diff-soft-wrap', softWrap);
        setMenuCheck('diff-breadcrumbs', showBreadcrumbs);
      }

      function setMenuCheck(elementId, checked) {
        const element = elements[elementId];
        element.classList.toggle('selected', checked);
        element.setAttribute('aria-checked', checked ? 'true' : 'false');
        element.querySelector('.menu-check').textContent = checked ? '\\u2713' : '';
      }

      function normalizeCommitLanguage(language) {
        return ['auto', 'en', 'ru'].includes(language) ? language : 'auto';
      }

      function renderViewModeControls() {
        const isDirectory = viewMode === 'directory';

        elements['group-directory'].classList.toggle('selected', isDirectory);
        elements['group-directory'].setAttribute('aria-checked', isDirectory ? 'true' : 'false');
        elements['group-directory'].querySelector('.menu-check').textContent = isDirectory ? '\\u2713' : '';

        elements['group-flat'].classList.toggle('selected', !isDirectory);
        elements['group-flat'].setAttribute('aria-checked', isDirectory ? 'false' : 'true');
        elements['group-flat'].querySelector('.menu-check').textContent = isDirectory ? '' : '\\u2713';

        elements['show-ignored'].classList.toggle('selected', showIgnored);
        elements['show-ignored'].setAttribute('aria-checked', showIgnored ? 'true' : 'false');
        elements['show-ignored'].querySelector('.menu-check').textContent = showIgnored ? '\\u2713' : '';
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

function buildBundledActionIcons(webview, extensionUri) {
  const empty = {
    show: { light: '', dark: '' },
    previewDetails: { light: '', dark: '' }
  };

  if (!extensionUri || !webview || typeof webview.asWebviewUri !== 'function') {
    return empty;
  }

  const iconUri = (fileName) => String(webview.asWebviewUri(resourceUri(
    extensionUri,
    ['resources', 'jetbrains', fileName]
  )));

  return {
    show: {
      light: iconUri('actions-show.svg'),
      dark: iconUri('actions-show-dark.svg')
    },
    previewDetails: {
      light: iconUri('actions-preview-details.svg'),
      dark: iconUri('actions-preview-details-dark.svg')
    }
  };
}

function renderActionIcon(icon, altText) {
  if (!icon?.light || !icon?.dark) {
    return '';
  }

  const alt = escapeHtmlAttribute(altText || '');

  return [
    `<img class="jetbrains-action-icon light" src="${escapeHtmlAttribute(icon.light)}" alt="${alt}">`,
    `<img class="jetbrains-action-icon dark" src="${escapeHtmlAttribute(icon.dark)}" alt="${alt}">`
  ].join('');
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  reconcileOptimisticStagingChanges,
  renderWebview,
  resolveActiveFileIconTheme,
  resolveFolderCheckboxChecked
};
