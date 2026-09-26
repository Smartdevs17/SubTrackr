import * as http from 'http';
import * as https from 'https';
import { RunbookDefinition, ServiceConfig } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks that a URL returns HTTP 2xx within `timeoutMs`.
 */
function httpHealthCheck(url: string, timeoutMs = 5_000): Promise<{ healthy: boolean; statusCode?: number; message: string }> {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      const healthy = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300;
      resolve({ healthy, statusCode: res.statusCode, message: `HTTP ${res.statusCode}` });
      res.resume();
    });
    req.on('error', (err) => resolve({ healthy: false, message: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ healthy: false, message: 'Request timed out' });
    });
  });
}

// ---------------------------------------------------------------------------
// Service Failover Runbook
// ---------------------------------------------------------------------------

/**
 * Runbook for failing over a service from primary to fallback.
 *
 * Steps:
 *  1. Health-check the primary service
 *  2. Verify fallback availability
 *  3. Initiate failover (update routing)
 *  4. Drain in-flight requests from primary
 *  5. Confirm failover with smoke test
 *
 * RTO: 5 minutes
 */
export function createServiceFailoverRunbook(service: ServiceConfig): RunbookDefinition {
  return {
    id: 'service-failover',
    name: 'Service Failover',
    description: `Failover ${service.name} from primary to fallback endpoint`,
    rtoSeconds: 300, // 5 minutes

    steps: [
      // ── Step 1: Check primary health ──────────────────────────────────
      {
        id: 'check-primary',
        name: 'Check primary service health',
        async execute(ctx) {
          const healthUrl = service.healthUrl ?? `${service.primaryEndpoint}/health`;
          ctx.log('info', `Checking primary health: ${healthUrl}`);

          const result = await httpHealthCheck(healthUrl);
          ctx.state['primaryHealthy'] = result.healthy;

          ctx.log(result.healthy ? 'info' : 'warn', `Primary health: ${result.message}`);
          return {
            success: true, // Always succeeds – just records state
            detail: `Primary health: ${result.message}`,
            output: { healthy: result.healthy, statusCode: result.statusCode },
          };
        },
      },

      // ── Step 2: Verify fallback availability ──────────────────────────
      {
        id: 'verify-fallback',
        name: 'Verify fallback endpoint availability',
        async execute(ctx) {
          if (!service.fallbackEndpoint) {
            ctx.state['fallbackAvailable'] = false;
            return {
              success: false,
              detail: `No fallback endpoint configured for ${service.name}`,
            };
          }

          const fallbackHealth = `${service.fallbackEndpoint}/health`;
          ctx.log('info', `Checking fallback health: ${fallbackHealth}`);

          const result = await httpHealthCheck(fallbackHealth);
          ctx.state['fallbackAvailable'] = result.healthy;

          return {
            success: result.healthy,
            detail: `Fallback health: ${result.message}`,
            output: { available: result.healthy, statusCode: result.statusCode },
          };
        },
      },

      // ── Step 3: Initiate failover ─────────────────────────────────────
      {
        id: 'initiate-failover',
        name: 'Initiate failover to fallback',
        dependsOn: ['verify-fallback'],
        async execute(ctx) {
          const primaryHealthy = ctx.state['primaryHealthy'] as boolean;
          if (primaryHealthy) {
            return {
              success: true,
              detail: 'Primary is healthy – failover not required',
              output: { failoverInitiated: false, reason: 'primary-healthy' },
            };
          }

          ctx.log('warn', `Initiating failover from ${service.primaryEndpoint} to ${service.fallbackEndpoint}`);

          // In production this would:
          //   - Update DNS / load balancer routing
          //   - Push config to service mesh (Istio, Envoy)
          //   - Update feature flags routing
          ctx.state['activeEndpoint'] = service.fallbackEndpoint;
          ctx.state['failoverInitiated'] = true;

          return {
            success: true,
            detail: `Failover initiated to ${service.fallbackEndpoint}`,
            output: {
              failoverInitiated: true,
              from: service.primaryEndpoint,
              to: service.fallbackEndpoint,
            },
          };
        },
        async rollback(ctx) {
          if (ctx.state['failoverInitiated']) {
            ctx.log('info', `Rolling back failover – restoring primary: ${service.primaryEndpoint}`);
            ctx.state['activeEndpoint'] = service.primaryEndpoint;
            ctx.state['failoverInitiated'] = false;
          }
        },
      },

      // ── Step 4: Drain in-flight requests ──────────────────────────────
      {
        id: 'drain-primary',
        name: 'Drain in-flight requests from primary',
        optional: true,
        dependsOn: ['initiate-failover'],
        timeoutMs: 60_000,
        async execute(ctx) {
          if (!ctx.state['failoverInitiated']) {
            return { success: true, detail: 'Skipped: failover not initiated' };
          }

          ctx.log('info', 'Waiting for in-flight requests to drain (grace period 5s)...');
          await new Promise((resolve) => setTimeout(resolve, 5_000));

          return {
            success: true,
            detail: 'Request drain complete',
            output: { drainDurationMs: 5_000 },
          };
        },
      },

      // ── Step 5: Smoke test failover ───────────────────────────────────
      {
        id: 'smoke-test',
        name: 'Smoke test failover endpoint',
        dependsOn: ['drain-primary'],
        maxRetries: 2,
        retryDelayMs: 3_000,
        async execute(ctx) {
          const targetEndpoint = (ctx.state['activeEndpoint'] as string) ?? service.primaryEndpoint;
          ctx.log('info', `Smoke testing active endpoint: ${targetEndpoint}`);

          const result = await httpHealthCheck(`${targetEndpoint}/health`);

          return {
            success: result.healthy,
            detail: `Smoke test: ${result.message}`,
            output: { endpoint: targetEndpoint, healthy: result.healthy },
          };
        },
      },
    ],

    async onFailure(ctx, results) {
      const failedSteps = results.filter((r) => r.status === 'failed').map((r) => r.name);
      ctx.log('error', `Service failover failed for ${service.name}. Steps failed: ${failedSteps.join(', ')}`);
    },
  };
}
