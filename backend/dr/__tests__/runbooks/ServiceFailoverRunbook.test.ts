import * as http from 'http';
import { AddressInfo } from 'net';
import { createServiceFailoverRunbook } from '../../runbooks/ServiceFailoverRunbook';
import { RunbookEngine } from '../../RunbookEngine';
import { ServiceConfig, RunbookContext } from '../../types';

// ---------------------------------------------------------------------------
// Minimal HTTP test server
// ---------------------------------------------------------------------------

function createTestServer(statusCode: number): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(statusCode);
      res.end(statusCode === 200 ? '{"status":"ok"}' : 'error');
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        server,
        port,
        close: () => new Promise((r) => server.close(r as () => void)),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(stateOverrides: Record<string, unknown> = {}): RunbookContext {
  return {
    executionId: 'test-exec',
    environment: 'staging',
    triggeredBy: 'test',
    params: {},
    state: stateOverrides,
    startedAt: Date.now(),
    log: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createServiceFailoverRunbook', () => {
  let engine: RunbookEngine;

  beforeEach(() => {
    engine = new RunbookEngine({ defaultRetryDelayMs: 0 });
  });

  it('creates a runbook definition', () => {
    const config: ServiceConfig = {
      id: 'api',
      name: 'API Service',
      primaryEndpoint: 'http://localhost:3000',
      fallbackEndpoint: 'http://localhost:3001',
    };
    const runbook = createServiceFailoverRunbook(config);
    expect(runbook.id).toBe('service-failover');
    expect(runbook.rtoSeconds).toBe(300);
    expect(runbook.steps.length).toBeGreaterThan(0);
  });

  it('has expected step IDs', () => {
    const config: ServiceConfig = {
      id: 'api',
      name: 'API',
      primaryEndpoint: 'http://localhost:3000',
      fallbackEndpoint: 'http://localhost:3001',
    };
    const runbook = createServiceFailoverRunbook(config);
    const ids = runbook.steps.map((s) => s.id);
    expect(ids).toContain('check-primary');
    expect(ids).toContain('verify-fallback');
    expect(ids).toContain('initiate-failover');
    expect(ids).toContain('drain-primary');
    expect(ids).toContain('smoke-test');
  });

  // ── check-primary ─────────────────────────────────────────────────────────

  describe('check-primary step', () => {
    it('records primaryHealthy=true when server responds 200', async () => {
      const { port, close } = await createTestServer(200);
      const config: ServiceConfig = {
        id: 'api',
        name: 'API',
        primaryEndpoint: `http://127.0.0.1:${port}`,
        fallbackEndpoint: `http://127.0.0.1:${port}`,
        healthUrl: `http://127.0.0.1:${port}/health`,
      };
      const runbook = createServiceFailoverRunbook(config);
      const checkPrimary = runbook.steps.find((s) => s.id === 'check-primary')!;
      const ctx = makeCtx();
      const result = await checkPrimary.execute(ctx);
      expect(result.success).toBe(true); // step always succeeds
      expect(ctx.state['primaryHealthy']).toBe(true);
      await close();
    });

    it('records primaryHealthy=false when server is down', async () => {
      const config: ServiceConfig = {
        id: 'api',
        name: 'API',
        primaryEndpoint: 'http://127.0.0.1:59999', // unused port
        fallbackEndpoint: 'http://127.0.0.1:59998',
        healthUrl: 'http://127.0.0.1:59999/health',
      };
      const runbook = createServiceFailoverRunbook(config);
      const checkPrimary = runbook.steps.find((s) => s.id === 'check-primary')!;
      const ctx = makeCtx();
      await checkPrimary.execute(ctx);
      expect(ctx.state['primaryHealthy']).toBe(false);
    });

    it('builds healthUrl from primaryEndpoint when none configured', async () => {
      const { port, close } = await createTestServer(200);
      const config: ServiceConfig = {
        id: 'api',
        name: 'API',
        primaryEndpoint: `http://127.0.0.1:${port}`,
        fallbackEndpoint: `http://127.0.0.1:${port}`,
        // no healthUrl
      };
      const runbook = createServiceFailoverRunbook(config);
      const checkPrimary = runbook.steps.find((s) => s.id === 'check-primary')!;
      const ctx = makeCtx();
      await checkPrimary.execute(ctx);
      // The check probes /health on the primary endpoint
      expect(ctx.state['primaryHealthy']).toBeDefined();
      await close();
    });
  });

  // ── verify-fallback ───────────────────────────────────────────────────────

  describe('verify-fallback step', () => {
    it('marks fallback unavailable when no fallback endpoint', async () => {
      const config: ServiceConfig = {
        id: 'api',
        name: 'API',
        primaryEndpoint: 'http://127.0.0.1:3000',
        // no fallbackEndpoint
      };
      const runbook = createServiceFailoverRunbook(config);
      const verifyFallback = runbook.steps.find((s) => s.id === 'verify-fallback')!;
      const result = await verifyFallback.execute(makeCtx());
      expect(result.success).toBe(false);
    });

    it('marks fallback available when server returns 200', async () => {
      const { port, close } = await createTestServer(200);
      const config: ServiceConfig = {
        id: 'api',
        name: 'API',
        primaryEndpoint: `http://127.0.0.1:${port}`,
        fallbackEndpoint: `http://127.0.0.1:${port}`,
      };
      const runbook = createServiceFailoverRunbook(config);
      const verifyFallback = runbook.steps.find((s) => s.id === 'verify-fallback')!;
      const ctx = makeCtx();
      const result = await verifyFallback.execute(ctx);
      expect(result.success).toBe(true);
      expect(ctx.state['fallbackAvailable']).toBe(true);
      await close();
    });
  });

  // ── initiate-failover ─────────────────────────────────────────────────────

  describe('initiate-failover step', () => {
    it('skips failover when primary is healthy', async () => {
      const config: ServiceConfig = {
        id: 'api',
        name: 'API',
        primaryEndpoint: 'http://localhost:3000',
        fallbackEndpoint: 'http://localhost:3001',
      };
      const runbook = createServiceFailoverRunbook(config);
      const initiateStep = runbook.steps.find((s) => s.id === 'initiate-failover')!;
      const ctx = makeCtx({ primaryHealthy: true });
      const result = await initiateStep.execute(ctx);
      expect(result.success).toBe(true);
      expect(result.output?.failoverInitiated).toBe(false);
    });

    it('initiates failover when primary is unhealthy', async () => {
      const config: ServiceConfig = {
        id: 'api',
        name: 'API',
        primaryEndpoint: 'http://localhost:3000',
        fallbackEndpoint: 'http://localhost:3001',
      };
      const runbook = createServiceFailoverRunbook(config);
      const initiateStep = runbook.steps.find((s) => s.id === 'initiate-failover')!;
      const ctx = makeCtx({ primaryHealthy: false });
      const result = await initiateStep.execute(ctx);
      expect(result.success).toBe(true);
      expect(ctx.state['failoverInitiated']).toBe(true);
      expect(ctx.state['activeEndpoint']).toBe('http://localhost:3001');
    });

    it('rollback restores primary endpoint', async () => {
      const config: ServiceConfig = {
        id: 'api',
        name: 'API',
        primaryEndpoint: 'http://localhost:3000',
        fallbackEndpoint: 'http://localhost:3001',
      };
      const runbook = createServiceFailoverRunbook(config);
      const initiateStep = runbook.steps.find((s) => s.id === 'initiate-failover')!;
      const ctx = makeCtx({ failoverInitiated: true });
      await initiateStep.rollback!(ctx);
      expect(ctx.state['activeEndpoint']).toBe('http://localhost:3000');
    });

    it('depends on verify-fallback', () => {
      const config: ServiceConfig = {
        id: 'api',
        name: 'API',
        primaryEndpoint: 'http://localhost:3000',
      };
      const runbook = createServiceFailoverRunbook(config);
      const initiateStep = runbook.steps.find((s) => s.id === 'initiate-failover')!;
      expect(initiateStep.dependsOn).toContain('verify-fallback');
    });
  });

  // ── drain-primary ─────────────────────────────────────────────────────────

  describe('drain-primary step', () => {
    it('skips drain when failover not initiated', async () => {
      const config: ServiceConfig = {
        id: 'api', name: 'API', primaryEndpoint: 'http://localhost:3000',
      };
      const runbook = createServiceFailoverRunbook(config);
      const drainStep = runbook.steps.find((s) => s.id === 'drain-primary')!;
      const ctx = makeCtx({ failoverInitiated: false });
      const result = await drainStep.execute(ctx);
      expect(result.success).toBe(true);
      expect(result.detail).toMatch(/skipped/i);
    }, 10_000);

    it('is optional', () => {
      const config: ServiceConfig = {
        id: 'api', name: 'API', primaryEndpoint: 'http://localhost:3000',
      };
      const runbook = createServiceFailoverRunbook(config);
      const drainStep = runbook.steps.find((s) => s.id === 'drain-primary')!;
      expect(drainStep.optional).toBe(true);
    });
  });

  // ── smoke-test ────────────────────────────────────────────────────────────

  describe('smoke-test step', () => {
    it('passes when active endpoint responds 200', async () => {
      const { port, close } = await createTestServer(200);
      const config: ServiceConfig = {
        id: 'api',
        name: 'API',
        primaryEndpoint: `http://127.0.0.1:${port}`,
        fallbackEndpoint: `http://127.0.0.1:${port}`,
      };
      const runbook = createServiceFailoverRunbook(config);
      const smokeStep = runbook.steps.find((s) => s.id === 'smoke-test')!;
      const ctx = makeCtx({ activeEndpoint: `http://127.0.0.1:${port}` });
      const result = await smokeStep.execute(ctx);
      expect(result.success).toBe(true);
      await close();
    });

    it('fails smoke test when endpoint is down', async () => {
      const config: ServiceConfig = {
        id: 'api',
        name: 'API',
        primaryEndpoint: 'http://127.0.0.1:59990',
      };
      const runbook = createServiceFailoverRunbook(config);
      const smokeStep = runbook.steps.find((s) => s.id === 'smoke-test')!;
      const ctx = makeCtx({ activeEndpoint: 'http://127.0.0.1:59990' });
      // maxRetries=2, so this will take a moment
      const result = await smokeStep.execute(ctx);
      expect(result.success).toBe(false);
    }, 15_000);
  });

  // ── onFailure ─────────────────────────────────────────────────────────────

  it('has onFailure handler', () => {
    const config: ServiceConfig = {
      id: 'api', name: 'API', primaryEndpoint: 'http://localhost:3000',
    };
    const runbook = createServiceFailoverRunbook(config);
    expect(typeof runbook.onFailure).toBe('function');
  });
});
