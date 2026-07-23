'use strict';

const assert = require('assert');
const {
  CODEX_SETTINGS_STORAGE_KEY,
  CommitGeneratorSettingsPanel,
  DEFAULT_CODEX_SETTINGS,
  normalizeCodexSettings,
  readStoredCodexSettings,
  renderSettingsWebview
} = require('../src/settingsPanel');

async function run() {
  testStandardProviderHidesCodexSettings();
  testCodexProviderShowsCodexSettings();
  testCodexSettingsAreValidated();
  testLegacyCodexSettingsRemainAvailableAsMigrationDefaults();
  await testPanelPersistsProviderAndCodexOptionsSeparately();
  console.log('settingsPanel.test.js: OK');
}

function testStandardProviderHidesCodexSettings() {
  const html = renderSettingsWebview(
    { cspSource: 'vscode-webview:' },
    {
      provider: 'vscodeLanguageModel',
      codex: DEFAULT_CODEX_SETTINGS
    }
  );

  assert.match(
    html,
    /<section id="codex-settings" class="codex-settings" hidden>/,
    'Codex fields must not be visible for the standard provider'
  );
  assert.match(
    html,
    /codexSettings\.hidden = provider\.value !== 'codexCli';/,
    'changing the provider must update Codex field visibility immediately'
  );
}

function testCodexProviderShowsCodexSettings() {
  const html = renderSettingsWebview(
    { cspSource: 'vscode-webview:' },
    {
      provider: 'codexCli',
      codex: DEFAULT_CODEX_SETTINGS
    }
  );

  assert.doesNotMatch(
    html,
    /<section id="codex-settings" class="codex-settings" hidden>/,
    'Codex fields must be visible after Codex CLI is selected'
  );
  assert.match(html, /<option value="codexCli" selected>Codex CLI<\/option>/);
  assert.match(html, /never reads\s+or stores API keys/);
}

function testCodexSettingsAreValidated() {
  assert.deepEqual(
    normalizeCodexSettings({
      executablePath: '  /usr/local/bin/codex  ',
      model: 'unknown',
      reasoningEffort: 'unbounded',
      timeoutMs: 999999
    }),
    {
      executablePath: '/usr/local/bin/codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'low',
      timeoutMs: 300000
    }
  );
}

function testLegacyCodexSettingsRemainAvailableAsMigrationDefaults() {
  const legacyValues = new Map([
    ['codexCli.executablePath', '/opt/codex'],
    ['codexCli.model', 'gpt-5.6-terra'],
    ['codexCli.reasoningEffort', 'medium'],
    ['codexCli.timeoutMs', 90000]
  ]);
  const vscode = {
    workspace: {
      getConfiguration() {
        return {
          get(key, fallback) {
            return legacyValues.has(key) ? legacyValues.get(key) : fallback;
          }
        };
      }
    }
  };
  const globalState = {
    get() {
      return undefined;
    }
  };

  assert.deepEqual(
    readStoredCodexSettings(vscode, globalState, undefined),
    {
      executablePath: '/opt/codex',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'medium',
      timeoutMs: 90000
    },
    'version 0.4.1 settings must seed the conditional panel'
  );
}

async function testPanelPersistsProviderAndCodexOptionsSeparately() {
  const configurationWrites = [];
  const stateWrites = [];
  const panel = {
    reveal() {},
    dispose() {},
    onDidDispose() {},
    webview: {
      cspSource: 'vscode-webview:',
      html: '',
      onDidReceiveMessage() {},
      postMessage: async () => true
    }
  };
  const vscode = {
    ConfigurationTarget: { Global: 1 },
    Uri: {
      file(fsPath) {
        return { fsPath };
      }
    },
    ViewColumn: { One: 1 },
    window: {
      createWebviewPanel() {
        return panel;
      }
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration() {
        return {
          get(_key, fallback) {
            return fallback;
          },
          async update(key, value, target) {
            configurationWrites.push({ key, value, target });
          }
        };
      }
    }
  };
  const stored = new Map();
  const context = {
    globalState: {
      get(key) {
        return stored.get(key);
      },
      async update(key, value) {
        stored.set(key, value);
        stateWrites.push({ key, value });
      }
    },
    subscriptions: []
  };
  const settingsPanel = new CommitGeneratorSettingsPanel(vscode, context);
  settingsPanel.show('/repo');

  await settingsPanel.handleMessage({
    type: 'updateSetting',
    key: 'provider',
    value: 'codexCli'
  });
  await settingsPanel.handleMessage({
    type: 'updateSetting',
    key: 'model',
    value: 'gpt-5.6-terra'
  });
  await settingsPanel.handleMessage({
    type: 'updateSetting',
    key: 'apiKey',
    value: 'must-not-be-stored'
  });

  assert.deepEqual(
    configurationWrites,
    [{ key: 'commitMessageGenerator', value: 'codexCli', target: 1 }],
    'provider remains a normal VS Code setting'
  );
  assert.deepEqual(
    stateWrites,
    [{
      key: CODEX_SETTINGS_STORAGE_KEY,
      value: {
        ...DEFAULT_CODEX_SETTINGS,
        model: 'gpt-5.6-terra'
      }
    }],
    'only allowlisted Codex options may be stored'
  );
}

run().catch(
  (error) => {
    process.exitCode = 1;
    console.error(error);
  }
);
