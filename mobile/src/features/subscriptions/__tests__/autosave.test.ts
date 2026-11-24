import {
  AutosaveErrorCode,
  AutosaveError,
  DEFAULT_AUTOSAVE_CONFIG,
  createAutosaveController,
  noopAutosaveMetrics,
  noopAutosaveLogger,
  systemAutosaveTimers,
  type AutosaveBatch,
  type AutosaveMetrics,
  type AutosaveLogger,
  type AutosaveTimers,
} from '../autosave';

interface Timer { handle: number; at: number; fn: () => void; cancelled: boolean }
interface Log {
  queued: Array<{ id: string; coalesced: boolean }>;
  scheduled: Array<{ reason: string; delayMs: number }>;
  flushed: Array<{ reason: string; batches: number; edits: number }>;
  cancelled: Array<{ id: string | undefined; edits: number }>;
  rejected: Array<{ code: string; id?: string }>;
  listenerFailed: unknown[];
}

function harness(clock: { now: number }) {
  let next = 0;
  const scheduled: Timer[] = [];
  const timers: AutosaveTimers = {
    setTimeout: (fn, ms) => {
      const timer: Timer = { handle: ++next, at: clock.now + ms, fn, cancelled: false };
      scheduled.push(timer);
      return timer.handle;
    },
    clearTimeout: (handle) => {
      const timer = scheduled.find((item) => item.handle === handle);
      if (timer) timer.cancelled = true;
    },
  };
  const advanceTo = (target: number): void => {
    clock.now = target;
    for (;;) {
      const due = scheduled.filter((item) => !item.cancelled && item.at <= clock.now).sort((a, b) => a.at - b.at)[0];
      if (!due) return;
      due.cancelled = true;
      due.fn();
    }
  };
  return { timers, scheduled, advanceTo };
}

function spy(): { metrics: AutosaveMetrics; log: Log } {
  const log: Log = { queued: [], scheduled: [], flushed: [], cancelled: [], rejected: [], listenerFailed: [] };
  const metrics: AutosaveMetrics = {
    queued: (id, coalesced) => log.queued.push({ id, coalesced }),
    scheduled: (reason, delayMs) => log.scheduled.push({ reason, delayMs }),
    flushed: (reason, batches, edits) => log.flushed.push({ reason, batches, edits }),
    cancelled: (id, edits) => log.cancelled.push({ id, edits }),
    rejected: (code, id) => log.rejected.push({ code, id }),
    listenerFailed: (error) => log.listenerFailed.push(error),
  };
  return { metrics, log };
}

function codeOf(fn: () => unknown): string {
  try { fn(); } catch (error) { return (error as AutosaveError).code; }
  throw new Error('expected fn to throw');
}

describe('autosave vocabulary (#2266)', () => {
  it('exposes frozen, stable error codes', () => {
    expect(Object.isFrozen(AutosaveErrorCode)).toBe(true);
    expect(AutosaveErrorCode.INVALID_CONFIG).toBe('INVALID_CONFIG');
    expect(AutosaveErrorCode.INVALID_INPUT).toBe('INVALID_INPUT');
    expect(AutosaveErrorCode.INVALID_VERSION).toBe('INVALID_VERSION');
    expect(AutosaveErrorCode.DISPOSED).toBe('DISPOSED');
  });

  it('exposes a frozen default config', () => {
    expect(Object.isFrozen(DEFAULT_AUTOSAVE_CONFIG)).toBe(true);
    expect(DEFAULT_AUTOSAVE_CONFIG.delayMs).toBe(400);
    expect(DEFAULT_AUTOSAVE_CONFIG.maxWaitMs).toBe(2500);
    expect(DEFAULT_AUTOSAVE_CONFIG.maxBatchSize).toBe(20);
  });

  it('ships frozen no-op observability hooks', () => {
    expect(Object.isFrozen(noopAutosaveMetrics)).toBe(true);
    expect(Object.isFrozen(noopAutosaveLogger)).toBe(true);
    expect(Object.isFrozen(systemAutosaveTimers)).toBe(true);
  });

  it('builds typed errors with frozen details', () => {
    const error = new AutosaveError(AutosaveErrorCode.INVALID_INPUT, 'bad id', { id: 'sub_1' });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AutosaveError);
    expect(error.name).toBe('AutosaveError');
    expect(error.code).toBe(AutosaveErrorCode.INVALID_INPUT);
    expect(error.message).toBe('bad id');
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(error.details.id).toBe('sub_1');
  });
});

describe('queue and last-write-wins coalescing', () => {
  it('returns a frozen pending snapshot', () => {
    const clock = { now: 1000 };
    const { timers } = harness(clock);
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, undefined, undefined, () => clock.now, timers);
    const pending = controller.queue('sub_1', { name: 'Netflix' }, 3);
    expect(Object.isFrozen(pending)).toBe(true);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('sub_1');
    expect(pending[0].patch).toEqual({ name: 'Netflix' });
    expect(pending[0].version).toBe(3);
    expect(pending[0].queuedAt).toBe(1000);
    expect(Object.isFrozen(pending[0])).toBe(true);
    expect(controller.size()).toBe(1);
  });

  it('merges patches for the same id', () => {
    const clock = { now: 0 };
    const { timers } = harness(clock);
    const { metrics, log } = spy();
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, metrics, undefined, () => clock.now, timers);
    controller.queue('sub_1', { name: 'Netflix', amount: 10 }, 1);
    clock.now = 50;
    const pending = controller.queue('sub_1', { amount: 12 }, 2);
    expect(controller.size()).toBe(1);
    expect(pending[0].patch).toEqual({ name: 'Netflix', amount: 12 });
    expect(pending[0].version).toBe(2);
    expect(pending[0].queuedAt).toBe(50);
    expect(log.queued).toEqual([
      { id: 'sub_1', coalesced: false },
      { id: 'sub_1', coalesced: true },
    ]);
  });

  it('keeps separate ids separate and does not mutate patches', () => {
    const clock = { now: 0 };
    const { timers } = harness(clock);
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, undefined, undefined, () => clock.now, timers);
    controller.queue('a', { amount: 1 });
    controller.queue('b', { amount: 2 });
    expect(controller.size()).toBe(2);
    expect(controller.pending().map((edit) => edit.id)).toEqual(['a', 'b']);
    const patch = { name: 'Spotify' };
    const pending = controller.queue('c', patch);
    expect(pending[0].patch).not.toBe(patch);
    expect(Object.isFrozen(pending[0].patch)).toBe(true);
    expect(patch).toEqual({ name: 'Spotify' });
  });
});

describe('debounce and max-wait flushing', () => {
  it('flushes one quiescence batch after the quiet period', () => {
    const clock = { now: 0 };
    const { timers, advanceTo } = harness(clock);
    const { metrics, log } = spy();
    const batches: AutosaveBatch[] = [];
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, metrics, undefined, () => clock.now, timers);
    controller.subscribe((batch) => batches.push(batch));
    controller.queue('sub_1', { name: 'Netflix' });
    advanceTo(99);
    expect(controller.size()).toBe(1);
    advanceTo(100);
    expect(controller.size()).toBe(0);
    expect(batches).toHaveLength(1);
    expect(batches[0].edits[0].id).toBe('sub_1');
    expect(batches[0].reason).toBe('quiescence');
    expect(batches[0].sequence).toBe(1);
    expect(Object.isFrozen(batches[0])).toBe(true);
    expect(Object.isFrozen(batches[0].edits)).toBe(true);
    expect(log.flushed).toEqual([{ reason: 'quiescence', batches: 1, edits: 1 }]);
  });

  it('resets the debounce timer on every same-id edit', () => {
    const clock = { now: 0 };
    const { timers, advanceTo } = harness(clock);
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 1000 }, undefined, undefined, () => clock.now, timers);
    controller.queue('sub_1', { amount: 1 });
    advanceTo(80);
    controller.queue('sub_1', { amount: 2 });
    advanceTo(150);
    expect(controller.size()).toBe(1);
    advanceTo(180);
    expect(controller.size()).toBe(0);
  });

  it('forces a maxWait flush under continuous typing', () => {
    const clock = { now: 0 };
    const { timers, advanceTo } = harness(clock);
    const { metrics, log } = spy();
    const reasons: string[] = [];
    const controller = createAutosaveController({ delayMs: 150, maxWaitMs: 400 }, metrics, undefined, () => clock.now, timers);
    controller.subscribe((batch) => reasons.push(batch.reason));
    controller.queue('sub_1', { amount: 1 });
    for (let step = 1; step <= 3; step += 1) {
      clock.now = step * 100;
      controller.queue('sub_1', { amount: step + 1 });
    }
    advanceTo(400);
    expect(controller.size()).toBe(0);
    expect(reasons).toEqual(['maxWait']);
    expect(log.flushed).toEqual([{ reason: 'maxWait', batches: 1, edits: 1 }]);
  });

  it('splits pending edits into bounded sequenced batches', () => {
    const clock = { now: 0 };
    const { timers } = harness(clock);
    const batches: AutosaveBatch[] = [];
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500, maxBatchSize: 2 }, undefined, undefined, () => clock.now, timers);
    controller.subscribe((batch) => batches.push(batch));
    ['a', 'b', 'c', 'd', 'e'].forEach((id) => controller.queue(id, { amount: 1 }));
    const flushed = controller.flush();
    expect(flushed).toHaveLength(3);
    expect(flushed.map((batch) => batch.edits.map((edit) => edit.id))).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(flushed.map((batch) => batch.sequence)).toEqual([1, 2, 3]);
    expect(Object.isFrozen(flushed)).toBe(true);
    expect(batches).toHaveLength(3);
  });

  it('supports manual and empty flushes', () => {
    const clock = { now: 10 };
    const { timers } = harness(clock);
    const { metrics, log } = spy();
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, metrics, undefined, () => clock.now, timers);
    expect(controller.flush()).toEqual([]);
    expect(Object.isFrozen(controller.flush())).toBe(true);
    controller.queue('sub_1', { amount: 1 });
    const flushed = controller.flush();
    expect(flushed[0].reason).toBe('manual');
    expect(flushed[0].flushedAt).toBe(10);
    expect(log.flushed).toEqual([
      { reason: 'manual', batches: 0, edits: 0 },
      { reason: 'manual', batches: 0, edits: 0 },
      { reason: 'manual', batches: 1, edits: 1 },
    ]);
  });

  it('records scheduling of both timers', () => {
    const clock = { now: 0 };
    const { timers } = harness(clock);
    const { metrics, log } = spy();
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, metrics, undefined, () => clock.now, timers);
    controller.queue('sub_1', { amount: 1 });
    expect(log.scheduled[0]).toEqual({ reason: 'maxWait', delayMs: 500 });
    expect(log.scheduled[1]).toEqual({ reason: 'debounce', delayMs: 100 });
  });
});

describe('cancel, dispose and rejection paths', () => {
  it('cancels a single id and keeps the others', () => {
    const clock = { now: 0 };
    const { timers } = harness(clock);
    const { metrics, log } = spy();
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, metrics, undefined, () => clock.now, timers);
    controller.queue('a', { amount: 1 });
    controller.queue('b', { amount: 2 });
    expect(controller.cancel('a')).toBe(1);
    expect(controller.size()).toBe(1);
    expect(controller.pending()[0].id).toBe('b');
    expect(log.cancelled).toEqual([{ id: 'a', edits: 1 }]);
    expect(controller.cancel('missing')).toBe(0);
  });

  it('cancels all edits and clears timers', () => {
    const clock = { now: 0 };
    const { timers, advanceTo } = harness(clock);
    const { metrics, log } = spy();
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, metrics, undefined, () => clock.now, timers);
    controller.queue('a', { amount: 1 });
    controller.queue('b', { amount: 2 });
    expect(controller.cancel()).toBe(2);
    expect(controller.size()).toBe(0);
    advanceTo(10000);
    expect(log.flushed).toEqual([]);
    expect(log.cancelled).toEqual([{ id: undefined, edits: 2 }]);
  });

  it('unsubscribes listeners and isolates failures', () => {
    const clock = { now: 0 };
    const { timers } = harness(clock);
    const { metrics, log } = spy();
    const messages: string[] = [];
    const logger: AutosaveLogger = {
      debug: () => undefined,
      warn: () => undefined,
      error: (message) => messages.push(message),
    };
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, metrics, logger, () => clock.now, timers);
    const received: string[] = [];
    const stopThrower = controller.subscribe(() => { throw new Error('listener boom'); });
    const stopReceiver = controller.subscribe((batch) => received.push(batch.edits[0].id));
    controller.queue('a', { amount: 1 });
    controller.flush();
    expect(received).toEqual(['a']);
    expect(log.listenerFailed).toHaveLength(1);
    expect(messages[0]).toBe('autosave listener failed');
    stopThrower();
    stopReceiver();
    controller.queue('b', { amount: 2 });
    controller.flush();
    expect(received).toEqual(['a']);
    expect(log.listenerFailed).toHaveLength(1);
  });

  it('rejects invalid ids, patches and versions', () => {
    const clock = { now: 0 };
    const { timers } = harness(clock);
    const { metrics, log } = spy();
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, metrics, undefined, () => clock.now, timers);
    expect(codeOf(() => controller.queue('', {}))).toBe(AutosaveErrorCode.INVALID_INPUT);
    expect(codeOf(() => controller.queue('a', null as never))).toBe(AutosaveErrorCode.INVALID_INPUT);
    expect(codeOf(() => controller.queue('a', [], 0))).toBe(AutosaveErrorCode.INVALID_INPUT);
    expect(codeOf(() => controller.queue('a', {}, -1))).toBe(AutosaveErrorCode.INVALID_VERSION);
    expect(codeOf(() => controller.queue('a', {}, 1.5))).toBe(AutosaveErrorCode.INVALID_VERSION);
    expect(log.rejected).toHaveLength(5);
    expect(log.rejected[0].code).toBe(AutosaveErrorCode.INVALID_INPUT);
    expect(log.rejected[3].code).toBe(AutosaveErrorCode.INVALID_VERSION);
    expect(controller.size()).toBe(0);
  });

  it('validates configuration and a non-finite clock', () => {
    const clock = { now: 0 };
    const { timers } = harness(clock);
    expect(codeOf(() => createAutosaveController({ delayMs: -1 }))).toBe(AutosaveErrorCode.INVALID_CONFIG);
    expect(codeOf(() => createAutosaveController({ maxWaitMs: 0 }))).toBe(AutosaveErrorCode.INVALID_CONFIG);
    expect(codeOf(() => createAutosaveController({ maxBatchSize: 1.5 }))).toBe(AutosaveErrorCode.INVALID_CONFIG);
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, undefined, undefined, () => Number.NaN, timers);
    expect(codeOf(() => controller.queue('a', {}))).toBe(AutosaveErrorCode.INVALID_CONFIG);
  });

  it('disposes cleanly and refuses further queues', () => {
    const clock = { now: 0 };
    const { timers, advanceTo } = harness(clock);
    const { metrics, log } = spy();
    const received: string[] = [];
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, metrics, undefined, () => clock.now, timers);
    controller.subscribe((batch) => received.push(batch.edits[0].id));
    controller.queue('a', { amount: 1 });
    controller.dispose();
    controller.dispose();
    expect(controller.size()).toBe(0);
    expect(codeOf(() => controller.queue('b', {}))).toBe(AutosaveErrorCode.DISPOSED);
    advanceTo(10000);
    expect(received).toEqual([]);
    expect(log.cancelled).toEqual([{ id: undefined, edits: 1 }]);
  });

  it('rejects a non-function listener', () => {
    const clock = { now: 0 };
    const { timers } = harness(clock);
    const { metrics, log } = spy();
    const controller = createAutosaveController({ delayMs: 100, maxWaitMs: 500 }, metrics, undefined, () => clock.now, timers);
    expect(codeOf(() => controller.subscribe(null as never))).toBe(AutosaveErrorCode.INVALID_INPUT);
    expect(log.rejected).toHaveLength(1);
  });
});
