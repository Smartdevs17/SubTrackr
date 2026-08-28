import { RunbookEngine } from '../RunbookEngine';
import { RunbookDefinition, RunbookContext } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSimpleRunbook(overrides: Partial<RunbookDefinition> = {}): RunbookDefinition {
  return {
    id: 'test-runbook',
    name: 'Test Runbook',
    description: 'A simple runbook for testing',
    rtoSeconds: 60,
    steps: [
      {
        id: 'step-1',
        name: 'Step 1',
        execute: jest.fn().mockResolvedValue({ success: true, detail: 'Step 1 done' }),
      },
      {
        id: 'step-2',
        name: 'Step 2',
        execute: jest.fn().mockResolvedValue({ success: true, detail: 'Step 2 done' }),
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunbookEngine', () => {
  let engine: RunbookEngine;

  beforeEach(() => {
    engine = new RunbookEngine({ defaultRetryDelayMs: 0 }); // No delay in tests
  });

  // ── Basic execution ───────────────────────────────────────────────────────

  describe('execute', () => {
    it('executes a simple runbook successfully', async () => {
      const runbook = makeSimpleRunbook();
      const result = await engine.execute(runbook);
      expect(result.success).toBe(true);
      expect(result.runbookId).toBe('test-runbook');
      expect(result.name).toBe('Test Runbook');
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].status).toBe('succeeded');
      expect(result.steps[1].status).toBe('succeeded');
    });

    it('generates an executionId', async () => {
      const runbook = makeSimpleRunbook();
      // Capture ctx via step
      let capturedCtx: RunbookContext | undefined;
      runbook.steps[0].execute = jest.fn().mockImplementation(async (ctx) => {
        capturedCtx = ctx;
        return { success: true };
      });
      await engine.execute(runbook);
      expect(capturedCtx?.executionId).toMatch(/^exec_/);
    });

    it('sets environment and triggeredBy from overrides', async () => {
      const runbook = makeSimpleRunbook();
      let capturedCtx: RunbookContext | undefined;
      runbook.steps[0].execute = jest.fn().mockImplementation(async (ctx) => {
        capturedCtx = ctx;
        return { success: true };
      });
      await engine.execute(runbook, { environment: 'staging', triggeredBy: 'ci-bot' });
      expect(capturedCtx?.environment).toBe('staging');
      expect(capturedCtx?.triggeredBy).toBe('ci-bot');
    });

    it('records step durations', async () => {
      const runbook = makeSimpleRunbook();
      const result = await engine.execute(runbook);
      for (const step of result.steps) {
        expect(step.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('records total duration', async () => {
      const runbook = makeSimpleRunbook();
      const result = await engine.execute(runbook);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.startedAt).toBeGreaterThan(0);
      expect(result.completedAt).toBeGreaterThanOrEqual(result.startedAt);
    });

    it('checks RTO compliance', async () => {
      const runbook = makeSimpleRunbook({ rtoSeconds: 10 });
      const result = await engine.execute(runbook);
      expect(result.rtoCompliant).toBe(true);
      expect(result.rtoSeconds).toBe(10);
    });

    it('marks RTO as non-compliant when exceeded', async () => {
      // Use a very small RTO with a deliberate delay to ensure breach
      const runbook = makeSimpleRunbook({
        rtoSeconds: 60,
        steps: [
          {
            id: 'slow',
            name: 'Slow step',
            execute: jest.fn().mockImplementation(async () => {
              await new Promise((r) => setTimeout(r, 10));
              return { success: true };
            }),
          },
        ],
      });
      // Override totalDurationMs comparison by patching rtoSeconds after creation
      runbook.rtoSeconds = 0; // 0 ms RTO = always exceeded
      const result = await engine.execute(runbook);
      expect(result.rtoCompliant).toBe(false);
    });
  });

  // ── Step failure ──────────────────────────────────────────────────────────

  describe('step failure', () => {
    it('fails the runbook when a required step fails', async () => {
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 'step-1',
            name: 'Failing step',
            execute: jest.fn().mockResolvedValue({ success: false, detail: 'Something went wrong' }),
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.success).toBe(false);
      expect(result.steps[0].status).toBe('failed');
      expect(result.error).toBeTruthy();
    });

    it('continues after optional step failure', async () => {
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 'step-1',
            name: 'Optional failing step',
            optional: true,
            execute: jest.fn().mockResolvedValue({ success: false, detail: 'optional failed' }),
          },
          {
            id: 'step-2',
            name: 'Required step',
            execute: jest.fn().mockResolvedValue({ success: true }),
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.success).toBe(true);
      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[1].status).toBe('succeeded');
    });

    it('stops execution on required step failure', async () => {
      const step2 = jest.fn().mockResolvedValue({ success: true });
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 'step-1',
            name: 'Required failing step',
            execute: jest.fn().mockResolvedValue({ success: false }),
          },
          {
            id: 'step-2',
            name: 'Should not run',
            execute: step2,
          },
        ],
      });
      await engine.execute(runbook);
      expect(step2).not.toHaveBeenCalled();
    });

    it('calls onFailure when runbook fails', async () => {
      const onFailure = jest.fn().mockResolvedValue(undefined);
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 'step-1',
            name: 'Failing step',
            execute: jest.fn().mockResolvedValue({ success: false }),
          },
        ],
        onFailure,
      });
      await engine.execute(runbook);
      expect(onFailure).toHaveBeenCalledTimes(1);
    });

    it('does not call onFailure when runbook succeeds', async () => {
      const onFailure = jest.fn();
      const runbook = makeSimpleRunbook({ onFailure });
      await engine.execute(runbook);
      expect(onFailure).not.toHaveBeenCalled();
    });
  });

  // ── Retry ─────────────────────────────────────────────────────────────────

  describe('retry', () => {
    it('retries a failing step up to maxRetries', async () => {
      let calls = 0;
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 'retry-step',
            name: 'Retry step',
            maxRetries: 2,
            retryDelayMs: 0,
            execute: jest.fn().mockImplementation(async () => {
              calls++;
              if (calls < 3) return { success: false };
              return { success: true };
            }),
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.success).toBe(true);
      expect(calls).toBe(3);
      expect(result.steps[0].attempts).toBe(3);
    });

    it('fails after exhausting retries', async () => {
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 'always-fail',
            name: 'Always failing',
            maxRetries: 1,
            retryDelayMs: 0,
            execute: jest.fn().mockResolvedValue({ success: false, detail: 'nope' }),
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.success).toBe(false);
      expect(result.steps[0].attempts).toBe(2); // 1 initial + 1 retry
    });

    it('retries on thrown errors', async () => {
      let calls = 0;
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 'throw-step',
            name: 'Throwing step',
            maxRetries: 2,
            retryDelayMs: 0,
            execute: jest.fn().mockImplementation(async () => {
              calls++;
              if (calls < 3) throw new Error('transient error');
              return { success: true };
            }),
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.success).toBe(true);
      expect(calls).toBe(3);
    });
  });

  // ── Timeout ───────────────────────────────────────────────────────────────

  describe('timeout', () => {
    it('fails a step that times out', async () => {
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 'slow-step',
            name: 'Slow step',
            timeoutMs: 50,
            execute: jest.fn().mockImplementation(
              () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 500))
            ),
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.success).toBe(false);
      expect(result.steps[0].error).toMatch(/timed out/i);
    });
  });

  // ── Rollback ──────────────────────────────────────────────────────────────

  describe('rollback', () => {
    it('calls rollback on completed steps when a required step fails', async () => {
      const rollback1 = jest.fn().mockResolvedValue(undefined);
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 'step-1',
            name: 'Step with rollback',
            execute: jest.fn().mockResolvedValue({ success: true }),
            rollback: rollback1,
          },
          {
            id: 'step-2',
            name: 'Failing step',
            execute: jest.fn().mockResolvedValue({ success: false }),
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.success).toBe(false);
      expect(rollback1).toHaveBeenCalledTimes(1);
      expect(result.steps[0].status).toBe('rolled-back');
    });

    it('rolls back in reverse order', async () => {
      const order: string[] = [];
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 's1',
            name: 'S1',
            execute: jest.fn().mockResolvedValue({ success: true }),
            rollback: jest.fn().mockImplementation(async () => { order.push('s1'); }),
          },
          {
            id: 's2',
            name: 'S2',
            execute: jest.fn().mockResolvedValue({ success: true }),
            rollback: jest.fn().mockImplementation(async () => { order.push('s2'); }),
          },
          {
            id: 's3',
            name: 'S3 fails',
            execute: jest.fn().mockResolvedValue({ success: false }),
          },
        ],
      });
      await engine.execute(runbook);
      // Should rollback s2, then s1 (reverse order)
      expect(order).toEqual(['s2', 's1']);
    });

    it('continues rollback even if a rollback throws', async () => {
      const rollback2 = jest.fn().mockResolvedValue(undefined);
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 's1',
            name: 'S1',
            execute: jest.fn().mockResolvedValue({ success: true }),
            rollback: jest.fn().mockRejectedValue(new Error('rollback exploded')),
          },
          {
            id: 's2',
            name: 'S2',
            execute: jest.fn().mockResolvedValue({ success: true }),
            rollback: rollback2,
          },
          {
            id: 's3',
            name: 'S3 fails',
            execute: jest.fn().mockResolvedValue({ success: false }),
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.success).toBe(false);
      // rollback2 should still have been called despite s1 rollback throwing
      expect(rollback2).toHaveBeenCalled();
    });
  });

  // ── Dependency ordering ───────────────────────────────────────────────────

  describe('dependency ordering', () => {
    it('skips a step when its dependency failed', async () => {
      const step2Execute = jest.fn().mockResolvedValue({ success: true });
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 'dep-step',
            name: 'Dep step fails',
            execute: jest.fn().mockResolvedValue({ success: false }),
          },
          {
            id: 'depends-step',
            name: 'Depends on dep-step',
            dependsOn: ['dep-step'],
            execute: step2Execute,
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.success).toBe(false);
      expect(result.steps[1].status).toBe('skipped');
      expect(step2Execute).not.toHaveBeenCalled();
    });

    it('runs a step when all its dependencies succeeded', async () => {
      const step2Execute = jest.fn().mockResolvedValue({ success: true });
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 's1',
            name: 'S1',
            execute: jest.fn().mockResolvedValue({ success: true }),
          },
          {
            id: 's2',
            name: 'S2',
            dependsOn: ['s1'],
            execute: step2Execute,
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.success).toBe(true);
      expect(step2Execute).toHaveBeenCalled();
    });

    it('treats optional step with failed dep as skipped without failing runbook', async () => {
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 's1',
            name: 'S1 fails',
            execute: jest.fn().mockResolvedValue({ success: false }),
          },
          {
            id: 's2',
            name: 'S2 optional with dep',
            optional: true,
            dependsOn: ['s1'],
            execute: jest.fn().mockResolvedValue({ success: true }),
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.steps[1].status).toBe('skipped');
    });
  });

  // ── Context shared state ──────────────────────────────────────────────────

  describe('context shared state', () => {
    it('allows steps to share state through ctx.state', async () => {
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 's1',
            name: 'Writer',
            execute: jest.fn().mockImplementation(async (ctx: RunbookContext) => {
              ctx.state['myKey'] = 'hello';
              return { success: true };
            }),
          },
          {
            id: 's2',
            name: 'Reader',
            execute: jest.fn().mockImplementation(async (ctx: RunbookContext) => {
              return {
                success: true,
                output: { read: ctx.state['myKey'] },
              };
            }),
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.steps[1].output).toHaveProperty('read', 'hello');
    });
  });

  // ── Step output ───────────────────────────────────────────────────────────

  describe('step output', () => {
    it('captures step output in result', async () => {
      const runbook = makeSimpleRunbook({
        steps: [
          {
            id: 's1',
            name: 'Step with output',
            execute: jest.fn().mockResolvedValue({
              success: true,
              output: { foo: 'bar', count: 42 },
            }),
          },
        ],
      });
      const result = await engine.execute(runbook);
      expect(result.steps[0].output).toEqual({ foo: 'bar', count: 42 });
    });
  });

  // ── Verbose mode ──────────────────────────────────────────────────────────

  describe('verbose mode', () => {
    it('does not throw in verbose mode', async () => {
      const verbose = new RunbookEngine({ verbose: true, defaultRetryDelayMs: 0 });
      const runbook = makeSimpleRunbook();
      await expect(verbose.execute(runbook)).resolves.toBeDefined();
    });
  });
});
