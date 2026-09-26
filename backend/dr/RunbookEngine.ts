import {
  RunbookContext,
  RunbookDefinition,
  RunbookResult,
  RunbookStepDefinition,
  RunbookStepResult,
  RunbookStepStatus,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateExecutionId(): string {
  return `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Resolves after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wraps a promise with a timeout that rejects after `ms` ms. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Step "${label}" timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// ---------------------------------------------------------------------------
// RunbookEngine
// ---------------------------------------------------------------------------

export interface RunbookEngineOptions {
  /** Default step timeout in ms (default: 30_000) */
  defaultStepTimeoutMs?: number;
  /** Default retry delay in ms (default: 500) */
  defaultRetryDelayMs?: number;
  /** If true, log step progress via the provided context log function */
  verbose?: boolean;
}

/**
 * Executes runbook definitions step-by-step with:
 *  - Per-step timeout enforcement
 *  - Configurable retry with backoff
 *  - Rollback of completed steps on failure
 *  - Dependency ordering enforcement
 *  - RTO compliance check
 */
export class RunbookEngine {
  private readonly defaultStepTimeoutMs: number;
  private readonly defaultRetryDelayMs: number;
  private readonly verbose: boolean;

  constructor(options: RunbookEngineOptions = {}) {
    this.defaultStepTimeoutMs = options.defaultStepTimeoutMs ?? 30_000;
    this.defaultRetryDelayMs = options.defaultRetryDelayMs ?? 500;
    this.verbose = options.verbose ?? false;
  }

  /**
   * Execute a runbook definition.
   *
   * @param definition - The runbook to run
   * @param contextOverrides - Overrides merged into the context
   */
  async execute(
    definition: RunbookDefinition,
    contextOverrides: Partial<Omit<RunbookContext, 'executionId' | 'log' | 'state' | 'startedAt'>> = {}
  ): Promise<RunbookResult> {
    const executionId = generateExecutionId();
    const startedAt = Date.now();
    const logs: Array<{ level: string; message: string; meta?: object }> = [];

    const ctx: RunbookContext = {
      executionId,
      environment: contextOverrides.environment ?? 'production',
      triggeredBy: contextOverrides.triggeredBy ?? 'automated',
      params: contextOverrides.params ?? {},
      state: {},
      startedAt,
      buildId: contextOverrides.buildId,
      log: (level, message, meta) => {
        logs.push({ level, message, meta });
        if (this.verbose) {
          // eslint-disable-next-line no-console
          console.log(`[RunbookEngine][${level.toUpperCase()}][${definition.id}] ${message}`, meta ?? '');
        }
      },
    };

    ctx.log('info', `Starting runbook: ${definition.name}`, { executionId, runbookId: definition.id });

    const stepResults: RunbookStepResult[] = [];
    const succeededSteps: RunbookStepDefinition[] = [];
    let runbookSuccess = true;
    let runbookError: string | undefined;

    for (const step of definition.steps) {
      // Check dependencies
      if (step.dependsOn && step.dependsOn.length > 0) {
        const unmet = step.dependsOn.filter((depId) => {
          const dep = stepResults.find((r) => r.stepId === depId);
          return !dep || dep.status !== 'succeeded';
        });
        if (unmet.length > 0) {
          const result = this._buildStepResult(step.id, step.name, 'skipped', 0, {
            detail: `Skipped: unmet dependencies [${unmet.join(', ')}]`,
            attempts: 0,
          });
          stepResults.push(result);
          ctx.log('warn', `Skipping step "${step.name}" due to unmet dependencies`, { unmet });
          if (!step.optional) {
            runbookSuccess = false;
            runbookError = `Required step "${step.name}" skipped due to unmet dependencies`;
          }
          continue;
        }
      }

      const stepResult = await this._executeStep(step, ctx);
      stepResults.push(stepResult);

      if (stepResult.status === 'succeeded') {
        succeededSteps.push(step);
        ctx.log('info', `Step "${step.name}" succeeded`, { durationMs: stepResult.durationMs });
      } else if (stepResult.status === 'failed' && !step.optional) {
        runbookSuccess = false;
        runbookError = stepResult.error ?? `Step "${step.name}" failed`;
        ctx.log('error', `Step "${step.name}" failed – rolling back`, { error: stepResult.error });

        // Mark all remaining steps that depend (directly or indirectly) on this step as skipped
        const failedStepId = step.id;
        for (const remaining of definition.steps.slice(definition.steps.indexOf(step) + 1)) {
          const hasUnmetDep = remaining.dependsOn?.includes(failedStepId) ||
            stepResults.some(
              (r) => r.status === 'skipped' && remaining.dependsOn?.includes(r.stepId)
            );
          if (hasUnmetDep) {
            stepResults.push(this._buildStepResult(remaining.id, remaining.name, 'skipped', 0, {
              detail: `Skipped: dependency "${failedStepId}" failed`,
              attempts: 0,
            }));
          }
        }

        // Rollback completed steps in reverse order
        await this._rollbackSteps(succeededSteps.reverse(), ctx, stepResults);
        break;
      } else if (stepResult.status === 'failed' && step.optional) {
        ctx.log('warn', `Optional step "${step.name}" failed – continuing`, { error: stepResult.error });
      }
    }

    if (!runbookSuccess && definition.onFailure) {
      try {
        await definition.onFailure(ctx, stepResults);
      } catch (err: any) {
        ctx.log('error', 'onFailure hook threw an error', { error: err.message });
      }
    }

    const completedAt = Date.now();
    const totalDurationMs = completedAt - startedAt;
    const rtoMs = definition.rtoSeconds * 1000;
    const rtoCompliant = totalDurationMs <= rtoMs;

    ctx.log('info', `Runbook ${runbookSuccess ? 'succeeded' : 'failed'} in ${totalDurationMs}ms`, {
      rtoCompliant,
      rtoMs,
    });

    return {
      runbookId: definition.id,
      name: definition.name,
      success: runbookSuccess,
      steps: stepResults,
      totalDurationMs,
      startedAt,
      completedAt,
      error: runbookError,
      rtoCompliant,
      rtoSeconds: definition.rtoSeconds,
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private async _executeStep(
    step: RunbookStepDefinition,
    ctx: RunbookContext
  ): Promise<RunbookStepResult> {
    const maxRetries = step.maxRetries ?? 0;
    const retryDelayMs = step.retryDelayMs ?? this.defaultRetryDelayMs;
    const timeoutMs = step.timeoutMs ?? this.defaultStepTimeoutMs;

    let lastError: string | undefined;
    let lastDetail: string | undefined;
    let lastOutput: Record<string, unknown> | undefined;
    const stepStart = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        ctx.log('info', `Retrying step "${step.name}" (attempt ${attempt + 1}/${maxRetries + 1})`);
        await delay(retryDelayMs * Math.pow(2, attempt - 1)); // exponential backoff
      }

      try {
        const stepResult = await withTimeout(
          step.execute(ctx),
          timeoutMs,
          step.name
        );

        if (stepResult.success) {
          return this._buildStepResult(step.id, step.name, 'succeeded', Date.now() - stepStart, {
            detail: stepResult.detail,
            output: stepResult.output,
            attempts: attempt + 1,
          });
        }

        lastError = `Step returned success=false`;
        lastDetail = stepResult.detail;
        lastOutput = stepResult.output;
      } catch (err: any) {
        lastError = err?.message ?? String(err);
        ctx.log('warn', `Step "${step.name}" attempt ${attempt + 1} failed: ${lastError}`);
      }
    }

    return this._buildStepResult(step.id, step.name, 'failed', Date.now() - stepStart, {
      error: lastError,
      detail: lastDetail,
      output: lastOutput,
      attempts: maxRetries + 1,
    });
  }

  private async _rollbackSteps(
    steps: RunbookStepDefinition[],
    ctx: RunbookContext,
    results: RunbookStepResult[]
  ): Promise<void> {
    for (const step of steps) {
      if (!step.rollback) continue;
      ctx.log('info', `Rolling back step "${step.name}"`);
      try {
        await withTimeout(step.rollback(ctx), this.defaultStepTimeoutMs, `rollback:${step.name}`);
        const result = results.find((r) => r.stepId === step.id);
        if (result) result.status = 'rolled-back';
        ctx.log('info', `Step "${step.name}" rolled back successfully`);
      } catch (err: any) {
        ctx.log('error', `Rollback of "${step.name}" failed: ${err.message}`);
      }
    }
  }

  private _buildStepResult(
    stepId: string,
    name: string,
    status: RunbookStepStatus,
    durationMs: number,
    opts: {
      detail?: string;
      error?: string;
      output?: Record<string, unknown>;
      attempts: number;
    }
  ): RunbookStepResult {
    return {
      stepId,
      name,
      status,
      durationMs,
      detail: opts.detail,
      error: opts.error,
      output: opts.output,
      attempts: opts.attempts,
    };
  }
}

export const runbookEngine = new RunbookEngine();
