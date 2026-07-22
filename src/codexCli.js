'use strict';

const { spawn } = require('child_process');

const MAX_STDOUT_LENGTH = 64 * 1024;
const MAX_STDERR_LENGTH = 32 * 1024;

function createCodexCliInvocation({ executable, root, model, reasoningEffort }) {
  const executableValue = requireText(executable, 'Codex CLI executable');
  const rootValue = requireText(root, 'repository root');
  const modelValue = requireText(model, 'Codex model');
  const reasoningEffortValue = requireText(reasoningEffort, 'Codex reasoning effort');

  return {
    executable: executableValue,
    args: [
      'exec',
      '--ephemeral',
      '--color',
      'never',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--model',
      modelValue,
      '--config',
      `model_reasoning_effort="${reasoningEffortValue}"`,
      '-C',
      rootValue,
      '-'
    ],
    options: {
      cwd: rootValue,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  };
}

function generateCommitMessageWithCodexCli(request, runtime = {}) {
  const invocation = createCodexCliInvocation(request);
  const prompt = requireText(request.prompt, 'commit message prompt');
  const timeoutMs = normalizeTimeout(request.timeoutMs);
  const spawnProcess = runtime.spawnProcess || spawn;
  const setTimer = runtime.setTimer || setTimeout;
  const clearTimer = runtime.clearTimer || clearTimeout;

  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawnProcess(
        invocation.executable,
        invocation.args,
        invocation.options
      );
    } catch (error) {
      reject(formatSpawnError(error));
      return;
    }

    let settled = false;
    let stdout = '';
    let stderr = '';
    const timer = setTimer(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(new Error(`Codex CLI timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    const finish = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimer(timer);
      callback();
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = appendCapped(stdout, chunk, MAX_STDOUT_LENGTH);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendCapped(stderr, chunk, MAX_STDERR_LENGTH);
    });
    child.on('error', (error) => {
      finish(() => reject(formatSpawnError(error)));
    });
    child.on('close', (exitCode) => {
      finish(() => {
        if (exitCode === 0) {
          const result = stdout.trim();

          if (!result) {
            reject(new Error('Codex CLI returned an empty commit message.'));
            return;
          }

          resolve(result);
          return;
        }

        reject(new Error(summarizeCodexCliFailure(stderr, exitCode)));
      });
    });
    child.stdin.on('error', (error) => {
      if (error?.code !== 'EPIPE') {
        finish(() => reject(new Error('Failed to send the staged diff to Codex CLI.')));
      }
    });
    child.stdin.end(prompt, 'utf8');
  });
}

function summarizeCodexCliFailure(stderr, exitCode) {
  const details = String(stderr || '').toLowerCase();

  if (/unauthorized|not authenticated|authentication|log ?in|401/.test(details)) {
    return 'Codex CLI is not authenticated. Run `codex login` in a terminal and try again.';
  }

  if (/model[^\n]*(not found|unsupported|unavailable|unknown)|unknown model/.test(details)) {
    return 'The selected Codex model is not available for the current Codex CLI account.';
  }

  if (/rate.?limit|too many requests|\b429\b/.test(details)) {
    return 'Codex CLI rate limit was reached. Try again later or select another generator.';
  }

  return `Codex CLI exited with code ${Number.isInteger(exitCode) ? exitCode : 'unknown'}. Run \`codex exec\` in a terminal to inspect the local CLI configuration.`;
}

function formatSpawnError(error) {
  if (error?.code === 'ENOENT') {
    return new Error('Codex CLI executable was not found. Install Codex CLI or update PhpStorm Commit Panel: Codex CLI Executable Path.');
  }

  return new Error('Codex CLI could not be started. Check the configured executable path.');
}

function appendCapped(current, chunk, maximumLength) {
  if (current.length >= maximumLength) {
    return current;
  }

  return (current + String(chunk)).slice(0, maximumLength);
}

function normalizeTimeout(value) {
  const timeout = Number(value);

  if (!Number.isFinite(timeout)) {
    return 120000;
  }

  return Math.max(5000, Math.min(Math.round(timeout), 300000));
}

function requireText(value, label) {
  const text = String(value ?? '').trim();

  if (!text || text.includes('\0')) {
    throw new Error(`${label} is required.`);
  }

  return text;
}

module.exports = {
  createCodexCliInvocation,
  generateCommitMessageWithCodexCli,
  normalizeTimeout,
  summarizeCodexCliFailure
};
