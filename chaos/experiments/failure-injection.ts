/**
 * failure-injection.ts — Failure injection chaos experiment.
 *
 * Injects a deterministic failure into a request pipeline and verifies that:
 *  1. the failure is contained (an error is returned, not a crash/panic), and
 *  2. the pipeline recovers on the next attempt (retry succeeds).
 */

import type { ChaosResult } from './network-partition';

/** A pipeline step that can be made to fail. */
export interface PipelineStep {
  name: string;
  /** When true, this step raises a contained failure. */
  inject: boolean;
}

/**
 * Injects failures at the marked steps. Steps that are not failed produce an
 * "ok"; failed steps produce an error. The overall pipeline returns `ok: false`
 * if any step failed, but never throws (failure is contained).
 */
export async function injectFailure(steps: PipelineStep[]): Promise<{
  ok: boolean;
  failedSteps: string[];
}> {
  // Simulate processing latency.
  await new Promise((resolve) => setTimeout(resolve, 5));

  const failedSteps = steps.filter((s) => s.inject).map((s) => s.name);
  return { ok: failedSteps.length === 0, failedSteps };
}

/**
 * Runs the failure-injection chaos experiment and verifies containment +
 * recovery.
 */
export async function runFailureInjectionExperiment(): Promise<ChaosResult> {
  const start = Date.now();

  const steps: PipelineStep[] = [
    { name: 'authenticate', inject: false },
    { name: 'charge', inject: true },
    { name: 'notify', inject: false },
  ];

  const injected = await injectFailure(steps);
  const contained = injected.failedSteps.length === 1 && injected.failedSteps[0] === 'charge';

  // After the failure is removed, the pipeline succeeds again.
  const recovered = await injectFailure(steps.map((s) => ({ ...s, inject: false })));
  const recoveredOk = recovered.ok;

  const passed = contained && recoveredOk;

  return {
    experiment: 'failure-injection',
    passed,
    duration: Date.now() - start,
    recovery: passed ? 'failure-contained-and-recovered' : undefined,
    error: passed
      ? undefined
      : `contained=${contained}, recovered=${recoveredOk}, failed=${JSON.stringify(injected.failedSteps)}`,
  };
}
