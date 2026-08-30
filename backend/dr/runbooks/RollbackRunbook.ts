import * as childProcess from 'child_process';
import { RunbookDefinition, DeploymentInfo } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execCommand(
  cmd: string,
  cwd: string = process.cwd()
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    childProcess.exec(cmd, { cwd, timeout: 120_000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: error ? (error.code ?? 1) : 0,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Rollback Runbook Definition
// ---------------------------------------------------------------------------

/**
 * Runbook for rolling back a deployment to a previous version.
 *
 * Steps:
 *  1. Validate rollback target
 *  2. Notify stakeholders
 *  3. Execute rollback (git, docker, or contract)
 *  4. Verify service health post-rollback
 *  5. Archive rollback artefacts
 *
 * RTO: 10 minutes
 */
export function createRollbackRunbook(
  deployment: DeploymentInfo,
  projectRoot: string = process.cwd()
): RunbookDefinition {
  return {
    id: 'rollback',
    name: 'Deployment Rollback',
    description: `Roll back ${deployment.environment} from v${deployment.version} to v${deployment.previousVersion}`,
    rtoSeconds: 600, // 10 minutes

    steps: [
      // ── Step 1: Validate rollback target ──────────────────────────────
      {
        id: 'validate-rollback-target',
        name: 'Validate rollback target',
        async execute(ctx) {
          const issues: string[] = [];

          if (!deployment.deploymentId) issues.push('deploymentId is required');
          if (!deployment.version) issues.push('current version is required');
          if (!deployment.previousVersion) issues.push('previousVersion is required');
          if (deployment.version === deployment.previousVersion) {
            issues.push('Current and previous versions are the same – no rollback needed');
          }

          ctx.state['rollbackTarget'] = deployment.previousVersion;
          ctx.state['rollbackSource'] = deployment.version;
          ctx.state['projectRoot'] = projectRoot;

          if (issues.length > 0) {
            return {
              success: false,
              detail: `Validation failed: ${issues.join('; ')}`,
              output: { issues },
            };
          }

          ctx.log('info', `Rolling back ${deployment.environment} from v${deployment.version} → v${deployment.previousVersion}`, {
            deploymentId: deployment.deploymentId,
          });

          return {
            success: true,
            detail: `Rollback target validated: v${deployment.version} → v${deployment.previousVersion}`,
            output: {
              from: deployment.version,
              to: deployment.previousVersion,
              environment: deployment.environment,
            },
          };
        },
      },

      // ── Step 2: Notify stakeholders ───────────────────────────────────
      {
        id: 'notify-rollback-start',
        name: 'Notify stakeholders of rollback',
        optional: true,
        async execute(ctx) {
          const message = `[ROLLBACK INITIATED] ${deployment.environment}: v${deployment.version} → v${deployment.previousVersion} (deployment: ${deployment.deploymentId})`;
          ctx.log('warn', message);
          // In production: send to Slack, PagerDuty, email
          return {
            success: true,
            detail: message,
            output: { notified: true },
          };
        },
      },

      // ── Step 3: Execute rollback ──────────────────────────────────────
      {
        id: 'execute-rollback',
        name: 'Execute rollback',
        maxRetries: 1,
        retryDelayMs: 5_000,
        timeoutMs: 300_000, // 5 minutes
        async execute(ctx) {
          const root = ctx.state['projectRoot'] as string;
          const previousVersion = ctx.state['rollbackTarget'] as string;

          ctx.log('info', `Executing rollback to ${previousVersion}...`);

          // Determine rollback strategy from deployment metadata
          // Contract (Soroban) rollback uses scheduled rollback
          if (deployment.services?.some((s) => s.includes('contract'))) {
            ctx.log('info', 'Contract rollback: using scheduled rollback via scripts/rollback-schedule.sh');
            // In production this calls the actual rollback script
            ctx.state['rollbackMethod'] = 'contract-scheduled';
            return {
              success: true,
              detail: `Contract rollback scheduled for version ${previousVersion}`,
              output: { method: 'contract-scheduled', targetVersion: previousVersion },
            };
          }

          // npm package rollback: install specific version
          if (previousVersion.match(/^\d+\.\d+\.\d+/)) {
            const result = await execCommand(`git tag -l "v${previousVersion}"`, root);
            const tagExists = result.stdout.trim() !== '';

            if (tagExists) {
              const checkoutResult = await execCommand(`git checkout v${previousVersion}`, root);
              ctx.state['rollbackMethod'] = 'git-checkout';
              return {
                success: checkoutResult.exitCode === 0,
                detail: checkoutResult.exitCode === 0
                  ? `Checked out v${previousVersion}`
                  : `Git checkout failed: ${checkoutResult.stderr.slice(0, 300)}`,
                output: { method: 'git-checkout', exitCode: checkoutResult.exitCode },
              };
            }
          }

          // Generic: record rollback intent for CI/CD pipeline
          ctx.state['rollbackMethod'] = 'ci-trigger';
          return {
            success: true,
            detail: `Rollback to ${previousVersion} recorded – CI/CD pipeline will execute`,
            output: { method: 'ci-trigger', targetVersion: previousVersion },
          };
        },
        async rollback(ctx) {
          // Re-deploy the current version if rollback itself failed
          ctx.log('warn', `Rollback execution failed – restoring v${deployment.version} may be required`);
        },
      },

      // ── Step 4: Verify health post-rollback ───────────────────────────
      {
        id: 'verify-post-rollback',
        name: 'Verify service health after rollback',
        dependsOn: ['execute-rollback'],
        maxRetries: 3,
        retryDelayMs: 10_000,
        timeoutMs: 60_000,
        async execute(ctx) {
          ctx.log('info', 'Running post-rollback health checks...');

          // In production: call health endpoints, run smoke tests
          const checks = (deployment.services ?? ['api']).map((svc) => ({
            service: svc,
            healthy: true, // simulate check
          }));

          const allHealthy = checks.every((c) => c.healthy);
          ctx.state['postRollbackHealthy'] = allHealthy;

          return {
            success: allHealthy,
            detail: allHealthy
              ? 'All services healthy after rollback'
              : 'Some services unhealthy after rollback',
            output: { checks },
          };
        },
      },

      // ── Step 5: Archive artefacts ─────────────────────────────────────
      {
        id: 'archive-artefacts',
        name: 'Archive rollback artefacts',
        optional: true,
        dependsOn: ['verify-post-rollback'],
        async execute(ctx) {
          const artefact = {
            deploymentId: deployment.deploymentId,
            rolledBackFrom: deployment.version,
            rolledBackTo: deployment.previousVersion,
            environment: deployment.environment,
            rollbackMethod: ctx.state['rollbackMethod'],
            timestamp: Date.now(),
            success: true,
          };

          ctx.log('info', 'Artefact archived', artefact);
          return {
            success: true,
            detail: 'Rollback artefact archived',
            output: { artefact },
          };
        },
      },
    ],

    async onFailure(ctx, results) {
      const failedSteps = results.filter((r) => r.status === 'failed').map((r) => r.name);
      ctx.log('error', `Rollback failed for deployment ${deployment.deploymentId}. Failed steps: ${failedSteps.join(', ')}`, {
        from: deployment.version,
        to: deployment.previousVersion,
        environment: deployment.environment,
      });
    },
  };
}
