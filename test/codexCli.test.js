'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const {
  createCodexCliInvocation,
  generateCommitMessageWithCodexCli
} = require('../src/codexCli');

function createFakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killedByExtension = false;
  child.kill = () => {
    child.killedByExtension = true;
    return true;
  };

  return child;
}

function createRequest(overrides = {}) {
  return {
    executable: 'codex',
    root: 'C:\\workspace\\repo',
    model: 'gpt-5.6-luna',
    reasoningEffort: 'low',
    timeoutMs: 120000,
    prompt: 'Generate a commit message.\n\nDiff:\n+const token = "not-a-real-secret";',
    ...overrides
  };
}

async function testInvocationKeepsPromptOutOfArguments() {
  const request = createRequest();
  const invocation = createCodexCliInvocation(request);

  assert.equal(invocation.executable, 'codex');
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.cwd, request.root);
  assert.ok(invocation.args.includes('--ephemeral'));
  assert.ok(invocation.args.includes('read-only'));
  assert.ok(invocation.args.includes('gpt-5.6-luna'));
  assert.ok(invocation.args.includes('model_reasoning_effort="low"'));
  assert.equal(invocation.args.at(-1), '-');
  assert.ok(!invocation.args.join(' ').includes('not-a-real-secret'));
}

async function testGeneratedMessageComesFromStdout() {
  const child = createFakeChild();
  let writtenPrompt = '';
  child.stdin.setEncoding('utf8');
  child.stdin.on('data', (chunk) => {
    writtenPrompt += chunk;
  });

  const pending = generateCommitMessageWithCodexCli(createRequest(), {
    spawnProcess() {
      return child;
    }
  });

  child.stdout.end('feat: add Codex commit generation\n');
  child.stderr.end();
  child.emit('close', 0, null);

  assert.equal(await pending, 'feat: add Codex commit generation');
  assert.equal(writtenPrompt, createRequest().prompt);
}

async function testMissingExecutableHasActionableError() {
  const child = createFakeChild();
  const pending = generateCommitMessageWithCodexCli(createRequest(), {
    spawnProcess() {
      return child;
    }
  });
  const error = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });

  child.emit('error', error);

  await assert.rejects(
    pending,
    /Codex CLI executable was not found/
  );
}

async function testAuthenticationFailureDoesNotExposeRawStderr() {
  const child = createFakeChild();
  const pending = generateCommitMessageWithCodexCli(createRequest(), {
    spawnProcess() {
      return child;
    }
  });

  child.stderr.end('401 Unauthorized: raw-secret-marker');
  child.stdout.end();
  child.emit('close', 1, null);

  await assert.rejects(pending, (error) => {
    assert.match(error.message, /not authenticated/);
    assert.ok(!error.message.includes('raw-secret-marker'));
    return true;
  });
}

async function testTimeoutStopsTheChildProcess() {
  const child = createFakeChild();
  let timeoutCallback;
  const pending = generateCommitMessageWithCodexCli(createRequest({ timeoutMs: 5000 }), {
    spawnProcess() {
      return child;
    },
    setTimer(callback) {
      timeoutCallback = callback;
      return 1;
    },
    clearTimer() {}
  });

  timeoutCallback();

  await assert.rejects(pending, /timed out after 5000 ms/);
  assert.equal(child.killedByExtension, true);
}

async function run() {
  await testInvocationKeepsPromptOutOfArguments();
  await testGeneratedMessageComesFromStdout();
  await testMissingExecutableHasActionableError();
  await testAuthenticationFailureDoesNotExposeRawStderr();
  await testTimeoutStopsTheChildProcess();
  console.log('codexCli.test.js: OK');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
