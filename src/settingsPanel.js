'use strict';

const crypto = require('crypto');

const CODEX_SETTINGS_STORAGE_KEY = 'codexCliSettings';
const DEFAULT_CODEX_SETTINGS = Object.freeze({
  executablePath: 'codex',
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  timeoutMs: 120000
});
const PROVIDERS = new Set(['vscodeLanguageModel', 'codexCli']);
const MODELS = new Set([
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gpt-5.4-mini'
]);
const REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

class CommitGeneratorSettingsPanel {
  constructor(vscode, context) {
    this.vscode = vscode;
    this.context = context;
    this.panel = undefined;
    this.resource = undefined;
  }

  show(root) {
    this.resource = resolveSettingsResource(this.vscode, root);

    if (this.panel) {
      this.panel.reveal(this.vscode.ViewColumn.One);
      this.render();
      return;
    }

    this.panel = this.vscode.window.createWebviewPanel(
      'phpstormGitPanel.generatorSettings',
      'PhpStorm Commit Panel Settings',
      this.vscode.ViewColumn.One,
      { enableScripts: true }
    );
    this.context.subscriptions.push(this.panel);
    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.resource = undefined;
      },
      undefined,
      this.context.subscriptions
    );
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        void this.handleMessage(message);
      },
      undefined,
      this.context.subscriptions
    );
    this.render();
  }

  render() {
    if (!this.panel) {
      return;
    }

    this.panel.webview.html = renderSettingsWebview(
      this.panel.webview,
      readGeneratorSettings(
        this.vscode,
        this.context.globalState,
        this.resource
      )
    );
  }

  async handleMessage(message) {
    if (!this.panel || message?.type !== 'updateSetting') {
      return;
    }

    try {
      if (message.key === 'provider') {
        const provider = normalizeProvider(message.value);
        await this.vscode.workspace
          .getConfiguration('phpstormGitPanel', this.resource)
          .update(
            'commitMessageGenerator',
            provider,
            this.vscode.ConfigurationTarget.Global
          );
        return;
      }

      const current = readStoredCodexSettings(
        this.vscode,
        this.context.globalState,
        this.resource
      );
      const next = updateCodexSetting(current, message.key, message.value);

      if (next === current) {
        return;
      }

      await this.context.globalState.update(CODEX_SETTINGS_STORAGE_KEY, next);
    } catch (error) {
      await this.panel.webview.postMessage({
        type: 'settingsError',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

function readGeneratorSettings(vscode, globalState, resource) {
  const configuration = vscode.workspace.getConfiguration(
    'phpstormGitPanel',
    resource
  );

  return {
    provider: normalizeProvider(
      configuration.get('commitMessageGenerator', 'vscodeLanguageModel')
    ),
    codex: readStoredCodexSettings(vscode, globalState, resource)
  };
}

function readStoredCodexSettings(vscode, globalState, resource) {
  const stored = globalState.get(CODEX_SETTINGS_STORAGE_KEY);

  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return normalizeCodexSettings(stored);
  }

  const legacy = vscode.workspace.getConfiguration(
    'phpstormGitPanel',
    resource
  );

  return normalizeCodexSettings({
    executablePath: legacy.get(
      'codexCli.executablePath',
      DEFAULT_CODEX_SETTINGS.executablePath
    ),
    model: legacy.get('codexCli.model', DEFAULT_CODEX_SETTINGS.model),
    reasoningEffort: legacy.get(
      'codexCli.reasoningEffort',
      DEFAULT_CODEX_SETTINGS.reasoningEffort
    ),
    timeoutMs: legacy.get(
      'codexCli.timeoutMs',
      DEFAULT_CODEX_SETTINGS.timeoutMs
    )
  });
}

function normalizeProvider(value) {
  return PROVIDERS.has(value) ? value : 'vscodeLanguageModel';
}

function normalizeCodexSettings(value = {}) {
  const executablePath = normalizeText(
    value.executablePath,
    DEFAULT_CODEX_SETTINGS.executablePath,
    1000
  );
  const timeout = Number(value.timeoutMs);

  return {
    executablePath,
    model: MODELS.has(value.model)
      ? value.model
      : DEFAULT_CODEX_SETTINGS.model,
    reasoningEffort: REASONING_EFFORTS.has(value.reasoningEffort)
      ? value.reasoningEffort
      : DEFAULT_CODEX_SETTINGS.reasoningEffort,
    timeoutMs: Number.isFinite(timeout)
      ? Math.min(300000, Math.max(5000, Math.round(timeout)))
      : DEFAULT_CODEX_SETTINGS.timeoutMs
  };
}

function updateCodexSetting(current, key, value) {
  if (!Object.hasOwn(DEFAULT_CODEX_SETTINGS, key)) {
    return current;
  }

  return normalizeCodexSettings({
    ...current,
    [key]: value
  });
}

function renderSettingsWebview(webview, settings) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const codexHidden = settings.provider === 'codexCli' ? '' : ' hidden';
  const providerOptions = [
    option(
      'vscodeLanguageModel',
      'VS Code Language Model (Standard)',
      settings.provider
    ),
    option('codexCli', 'Codex CLI', settings.provider)
  ].join('');
  const modelOptions = [
    ['gpt-5.6-luna', 'GPT-5.6 Luna (Recommended, economical)'],
    ['gpt-5.6-terra', 'GPT-5.6 Terra'],
    ['gpt-5.6-sol', 'GPT-5.6 Sol'],
    ['gpt-5.4-mini', 'GPT-5.4 Mini']
  ].map(([value, label]) => option(value, label, settings.codex.model)).join('');
  const effortOptions = [
    ['low', 'Low (recommended)'],
    ['medium', 'Medium'],
    ['high', 'High'],
    ['xhigh', 'Extra high'],
    ['max', 'Maximum']
  ].map(
    ([value, label]) => option(value, label, settings.codex.reasoningEffort)
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
  >
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Commit message generation</title>
  <style>
    body {
      box-sizing: border-box;
      max-width: 760px;
      margin: 0 auto;
      padding: 28px 32px 48px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    h1 {
      margin: 0 0 24px;
      font-size: 22px;
      font-weight: 600;
    }
    h2 {
      margin: 0 0 16px;
      font-size: 16px;
      font-weight: 600;
    }
    .setting {
      margin: 0 0 20px;
    }
    label {
      display: block;
      margin-bottom: 6px;
      font-weight: 600;
    }
    select,
    input {
      box-sizing: border-box;
      width: min(100%, 560px);
      min-height: 30px;
      padding: 4px 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      outline: none;
    }
    select:focus,
    input:focus {
      border-color: var(--vscode-focusBorder);
    }
    .description {
      max-width: 620px;
      margin: 6px 0 0;
      color: var(--vscode-descriptionForeground);
      line-height: 1.45;
    }
    .codex-settings {
      margin-top: 28px;
      padding-top: 24px;
      border-top: 1px solid var(--vscode-settings-headerBorder);
    }
    .security-note {
      padding: 10px 12px;
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textBlockQuote-border);
    }
    .status {
      min-height: 20px;
      margin-top: 18px;
      color: var(--vscode-errorForeground);
    }
    [hidden] {
      display: none !important;
    }
  </style>
</head>
<body>
  <h1>Commit message generation</h1>
  <div class="setting">
    <label for="provider">Generation provider</label>
    <select id="provider">${providerOptions}</select>
    <p class="description">
      Standard uses the VS Code Language Model API. Codex CLI runs the locally
      installed command with its existing authentication.
    </p>
  </div>

  <section id="codex-settings" class="codex-settings"${codexHidden}>
    <h2>Codex CLI</h2>
    <div class="setting">
      <label for="executablePath">Executable</label>
      <input
        id="executablePath"
        type="text"
        value="${escapeHtml(settings.codex.executablePath)}"
        autocomplete="off"
        spellcheck="false"
      >
      <p class="description">Command name or absolute path to Codex CLI.</p>
    </div>
    <div class="setting">
      <label for="model">Model</label>
      <select id="model">${modelOptions}</select>
    </div>
    <div class="setting">
      <label for="reasoningEffort">Reasoning effort</label>
      <select id="reasoningEffort">${effortOptions}</select>
      <p class="description">Low is recommended for short commit messages.</p>
    </div>
    <div class="setting">
      <label for="timeoutMs">Timeout, ms</label>
      <input
        id="timeoutMs"
        type="number"
        min="5000"
        max="300000"
        step="1000"
        value="${settings.codex.timeoutMs}"
      >
    </div>
    <p class="description security-note">
      The extension uses the existing Codex CLI authentication and never reads
      or stores API keys.
    </p>
  </section>
  <div id="status" class="status" role="status" aria-live="polite"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const provider = document.getElementById('provider');
    const codexSettings = document.getElementById('codex-settings');
    const status = document.getElementById('status');

    function updateVisibility() {
      codexSettings.hidden = provider.value !== 'codexCli';
    }

    function updateSetting(key, value) {
      status.textContent = '';
      vscode.postMessage({ type: 'updateSetting', key, value });
    }

    provider.addEventListener('change', function () {
      updateVisibility();
      updateSetting('provider', provider.value);
    });

    for (const key of ['executablePath', 'model', 'reasoningEffort', 'timeoutMs']) {
      const element = document.getElementById(key);
      element.addEventListener('change', function () {
        updateSetting(key, element.value);
      });
    }

    window.addEventListener('message', function (event) {
      if (event.data?.type === 'settingsError') {
        status.textContent = event.data.message;
      }
    });

    updateVisibility();
  </script>
</body>
</html>`;
}

function option(value, label, selectedValue) {
  const selected = value === selectedValue ? ' selected' : '';
  return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeText(value, fallback, maxLength) {
  const text = String(value ?? '').trim();
  return text && !text.includes('\0') ? text.slice(0, maxLength) : fallback;
}

function resolveSettingsResource(vscode, root) {
  if (root) {
    return vscode.Uri.file(root);
  }

  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

module.exports = {
  CODEX_SETTINGS_STORAGE_KEY,
  CommitGeneratorSettingsPanel,
  DEFAULT_CODEX_SETTINGS,
  normalizeCodexSettings,
  normalizeProvider,
  readGeneratorSettings,
  readStoredCodexSettings,
  renderSettingsWebview,
  updateCodexSetting
};
