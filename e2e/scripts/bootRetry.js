#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Bounded, traced retry for the Detox device boot/launch phase (CI helper).
 *
 * `detox test` boots the simulator/emulator and launches the app before any spec
 * runs. This wrapper re-runs the whole test command, with exponential backoff,
 * only when its output carries a boot/launch failure signature. Every attempt is
 * appended as one JSON line to the trace file, so CI runs can be audited later.
 *
 * Failures without a boot signature are NOT retried here; per-test retries stay in
 * e2e/setup.ts (jest.retryTimes).
 *
 * Usage (one line in a workflow step):
 *   node e2e/scripts/bootRetry.js --label <name> --platform <ios|android> \
 *     --device <name> -- <command> [args...]
 *
 * Options (CLI flag wins over env var):
 *   --attempts    E2E_BOOT_ATTEMPTS     max attempts, 1-5, default 3
 *   --backoff-ms  E2E_BOOT_BACKOFF_MS   first backoff, doubled after each retry, default 15000
 *   --trace       E2E_BOOT_TRACE        trace file, default artifacts/boot-trace.jsonl
 *
 * The command is spawned directly (no shell), so arguments reach it exactly as
 * the calling shell produced them.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Output patterns that mark a failure as device boot/launch, not a test failure. */
const BOOT_FAILURE_SIGNATURES = [
  /failed to boot/i,
  /unable to boot/i,
  /unable to find a device/i,
  /no (?:booted )?(?:devices?|emulators?|simulators?) (?:found|running|available)/i,
  /device '?[^\s']+'? not found/i,
  /adb: device .*(?:offline|not found)/i,
  /emulator.*(?:failed to start|exited|timed out)/i,
  /timed out waiting for (?:the )?(?:device|emulator|simulator|app)/i,
  /failed to launch (?:the )?(?:app|application)/i,
  /INSTALL_FAILED_/,
];

/** Keep only the tail of each attempt's output for signature matching. */
const OUTPUT_TAIL_CHARS = 64 * 1024;
const MAX_ATTEMPTS_LIMIT = 5;

function parseArgv(argv) {
  const sep = argv.indexOf('--');
  const flagTokens = sep === -1 ? argv : argv.slice(0, sep);
  const command = sep === -1 ? [] : argv.slice(sep + 1);

  const flags = {};
  for (let i = 0; i < flagTokens.length; i += 2) {
    const key = flagTokens[i];
    if (!key || !key.startsWith('--') || i + 1 >= flagTokens.length) {
      throw new Error(`Malformed option near "${key}"`);
    }
    flags[key.slice(2)] = flagTokens[i + 1];
  }
  return { flags, command };
}

function resolveOptions(argv) {
  const { flags, command } = parseArgv(argv);
  if (command.length === 0) {
    throw new Error('Missing command: put it after "--"');
  }

  const attempts = Number(flags.attempts ?? process.env.E2E_BOOT_ATTEMPTS ?? 3);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS_LIMIT) {
    throw new Error(`attempts must be an integer 1-${MAX_ATTEMPTS_LIMIT}`);
  }

  const backoffMs = Number(flags['backoff-ms'] ?? process.env.E2E_BOOT_BACKOFF_MS ?? 15000);
  if (!Number.isFinite(backoffMs) || backoffMs < 0) {
    throw new Error('backoff-ms must be a non-negative number');
  }

  return {
    label: flags.label ?? 'e2e',
    platform: flags.platform ?? 'unknown',
    device: flags.device ?? 'unknown',
    attempts,
    backoffMs,
    trace: flags.trace ?? process.env.E2E_BOOT_TRACE ?? path.join('artifacts', 'boot-trace.jsonl'),
    command,
  };
}

function runCommand(command, onOutput) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: process.env,
    });

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      onOutput(chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      onOutput(chunk.toString());
    });
    child.on('error', (err) => resolve({ code: 1, signal: null, spawnError: err.message }));
    child.on('close', (code, signal) => resolve({ code: code ?? 1, signal, spawnError: null }));
  });
}

function appendTrace(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isBootFailure(output) {
  return BOOT_FAILURE_SIGNATURES.some((pattern) => pattern.test(output));
}

async function main() {
  const opts = resolveOptions(process.argv.slice(2));

  for (let attempt = 1; attempt <= opts.attempts; attempt += 1) {
    let tail = '';
    const startedAt = new Date();
    const result = await runCommand(opts.command, (text) => {
      tail = (tail + text).slice(-OUTPUT_TAIL_CHARS);
    });
    const endedAt = new Date();

    let outcome;
    let backoffMs = 0;
    if (result.code === 0) {
      outcome = 'passed';
    } else if (result.spawnError) {
      outcome = 'spawn-error';
    } else if (!isBootFailure(tail)) {
      outcome = 'failed';
    } else if (attempt < opts.attempts) {
      outcome = 'boot-failed-retrying';
      backoffMs = opts.backoffMs * 2 ** (attempt - 1);
    } else {
      outcome = 'boot-failed-exhausted';
    }

    appendTrace(opts.trace, {
      label: opts.label,
      platform: opts.platform,
      device: opts.device,
      attempt,
      maxAttempts: opts.attempts,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt - startedAt,
      exitCode: result.code,
      signal: result.signal,
      spawnError: result.spawnError,
      outcome,
      backoffMs,
    });

    if (outcome === 'passed') {
      return 0;
    }
    if (outcome !== 'boot-failed-retrying') {
      console.error(`[bootRetry] ${opts.label}: ${outcome} on attempt ${attempt}/${opts.attempts}`);
      return result.code || 1;
    }

    console.warn(
      `[bootRetry] ${opts.label}: device boot/launch failed on attempt ${attempt}/${opts.attempts}; retrying in ${backoffMs} ms`
    );
    await sleep(backoffMs);
  }

  // Unreachable: the loop always returns on its final attempt.
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`[bootRetry] ${err.message}`);
    process.exitCode = 1;
  });
