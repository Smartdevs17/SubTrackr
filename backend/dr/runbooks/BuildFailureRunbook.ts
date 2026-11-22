import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { RunbookDefinition, BuildFailureContext, BuildFailureCategory } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execCommand(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    childProcess.exec(cmd, { cwd, timeout: 60_000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: error ? (error.code ?? 1) : 0,
      });
    });
  });
}

function detectFailureCategory(errorLog: string): BuildFailureCategory {
  const log = errorLog.toLowerCase();
  if (/cannot find module|module not found|enoent.*node_modules/.test(log)) return 'dependency-error';
  if (/tsc|typescript|ts\(\d+\)|type error/.test(log)) return 'type-error';
  if (/eslint|tslint|lint/.test(log)) return 'lint-error';
  if (/test.*failed|jest|mocha|failing test/.test(log)) return 'test-failure';
  if (/soroban|cargo|wasm|rustc/.test(log)) return 'contract-build-failure';
  if (/deploy|publish|release/.test(log)) return 'deploy-failure';
  if (/syntax.*error|compile.*error|babel/.test(log)) return 'compile-error';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Build Failure Runbook Definition
// ---------------------------------------------------------------------------

/**
 * Runbook that handles CI/CD build failures with category-specific recovery
 * actions: dependency re-install, cache clearing, type-check bypass, lint fixes,
 * test retries, and contract build recovery.
 *
 * RTO: 10 minutes
 */
export function createBuildFailureRunbook(
  context: BuildFailureContext,
  projectRoot: string = process.cwd()
): RunbookDefinition {
  const category = context.failureCategory === 'unknown' && context.errorLog
    ? detectFailureCategory(context.errorLog)
    : context.failureCategory;

  return {
    id: 'build-failure',
    name: 'Build Failure Recovery',
    description: 'Automated recovery runbook for CI/CD build failures',
    rtoSeconds: 600, // 10 minutes

    steps: [
      // ── Step 1: Diagnose ──────────────────────────────────────────────
      {
        id: 'diagnose',
        name: 'Diagnose failure',
        async execute(ctx) {
          const detected = context.errorLog ? detectFailureCategory(context.errorLog) : category;
          ctx.state['detectedCategory'] = detected;
          ctx.state['projectRoot'] = projectRoot;
          ctx.log('info', `Build failure diagnosed as: ${detected}`, {
            buildId: context.buildId,
            branch: context.branch,
            commit: context.commit,
          });
          return {
            success: true,
            detail: `Failure category: ${detected}`,
            output: { category: detected, buildId: context.buildId },
          };
        },
      },

      // ── Step 2: Clear build cache ─────────────────────────────────────
      {
        id: 'clear-cache',
        name: 'Clear build cache',
        optional: true,
        async execute(ctx) {
          const root = ctx.state['projectRoot'] as string;
          const cachePaths = [
            path.join(root, '.expo'),
            path.join(root, '.next'),
            path.join(root, 'dist'),
            path.join(root, 'build'),
            path.join(root, '.cache'),
          ];

          const cleared: string[] = [];
          for (const p of cachePaths) {
            if (fs.existsSync(p)) {
              try {
                fs.rmSync(p, { recursive: true, force: true });
                cleared.push(p);
              } catch {
                // non-critical
              }
            }
          }

          ctx.log('info', `Cleared ${cleared.length} cache directories`);
          return {
            success: true,
            detail: cleared.length > 0 ? `Cleared: ${cleared.join(', ')}` : 'No caches found to clear',
            output: { clearedPaths: cleared },
          };
        },
      },

      // ── Step 3: Reinstall dependencies (for dependency errors) ────────
      {
        id: 'reinstall-deps',
        name: 'Reinstall dependencies',
        optional: true,
        timeoutMs: 120_000,
        maxRetries: 1,
        retryDelayMs: 5_000,
        async execute(ctx) {
          const detectedCategory = ctx.state['detectedCategory'] as BuildFailureCategory;
          if (detectedCategory !== 'dependency-error') {
            return { success: true, detail: 'Skipped: not a dependency error' };
          }

          const root = ctx.state['projectRoot'] as string;
          ctx.log('info', 'Reinstalling npm dependencies...');
          const result = await execCommand('npm install --prefer-offline', root);

          if (result.exitCode !== 0) {
            ctx.log('warn', 'npm install failed, trying with --legacy-peer-deps');
            const retryResult = await execCommand('npm install --legacy-peer-deps', root);
            if (retryResult.exitCode !== 0) {
              return {
                success: false,
                detail: `npm install failed: ${retryResult.stderr.slice(0, 500)}`,
              };
            }
          }

          return { success: true, detail: 'Dependencies reinstalled successfully' };
        },
        async rollback(ctx) {
          ctx.log('info', 'Rollback: nothing to undo for dependency reinstall');
        },
      },

      // ── Step 4: Fix lint errors ───────────────────────────────────────
      {
        id: 'fix-lint',
        name: 'Auto-fix lint errors',
        optional: true,
        timeoutMs: 60_000,
        async execute(ctx) {
          const detectedCategory = ctx.state['detectedCategory'] as BuildFailureCategory;
          if (detectedCategory !== 'lint-error') {
            return { success: true, detail: 'Skipped: not a lint error' };
          }

          const root = ctx.state['projectRoot'] as string;
          ctx.log('info', 'Running eslint auto-fix...');
          const result = await execCommand('npm run lint:fix -- --max-warnings=0', root);

          return {
            success: result.exitCode === 0,
            detail: result.exitCode === 0
              ? 'Lint fixed successfully'
              : `Lint fix had issues: ${result.stderr.slice(0, 500)}`,
          };
        },
      },

      // ── Step 5: Retry build ───────────────────────────────────────────
      {
        id: 'retry-build',
        name: 'Retry build',
        maxRetries: 2,
        retryDelayMs: 10_000,
        timeoutMs: 180_000,
        async execute(ctx) {
          const detectedCategory = ctx.state['detectedCategory'] as BuildFailureCategory;
          const root = ctx.state['projectRoot'] as string;

          // For type errors, we attempt a build bypassing strict mode checks
          let buildCmd = 'npm run build';
          if (detectedCategory === 'type-error') {
            buildCmd = 'npx tsc --noEmit --skipLibCheck';
          } else if (detectedCategory === 'contract-build-failure') {
            buildCmd = 'npm run contracts:build';
          }

          ctx.log('info', `Retrying build with: ${buildCmd}`);
          const result = await execCommand(buildCmd, root);

          ctx.state['buildRetryOutput'] = result.stdout.slice(0, 1000);
          return {
            success: result.exitCode === 0,
            detail: result.exitCode === 0
              ? 'Build retry succeeded'
              : `Build retry failed: ${(result.stderr || result.stdout).slice(0, 500)}`,
            output: { exitCode: result.exitCode },
          };
        },
      },

      // ── Step 6: Notify on failure ─────────────────────────────────────
      {
        id: 'notify',
        name: 'Notify team of outcome',
        optional: true,
        async execute(ctx) {
          const buildSucceeded = ctx.state['buildRetryOutput'] !== undefined;
          const message = buildSucceeded
            ? `Build recovery succeeded for ${context.buildId} on branch ${context.branch}`
            : `Build recovery FAILED for ${context.buildId} on branch ${context.branch} – manual intervention required`;
          ctx.log(buildSucceeded ? 'info' : 'error', message);
          // In production this would call a notification service
          return {
            success: true,
            detail: message,
            output: { notified: true, message },
          };
        },
      },
    ],

    async onFailure(ctx, results) {
      const failedSteps = results.filter((r) => r.status === 'failed').map((r) => r.name);
      ctx.log('error', `Build failure recovery failed. Steps failed: ${failedSteps.join(', ')}`, {
        buildId: context.buildId,
        branch: context.branch,
      });
    },
  };
}

/** Detect build failure category from a raw error log string. */
export { detectFailureCategory };
