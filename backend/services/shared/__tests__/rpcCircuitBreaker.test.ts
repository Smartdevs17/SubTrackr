import {
  RpcCircuitBreakerService,
  RpcTimeoutError,
  RpcCircuitOpenError,
  RpcAllProvidersFailedError,
  type RpcProviderConfig,
  type RpcCallFn,
} from '../rpcCircuitBreaker';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const makeProvider = (id: string, priority = 0, timeoutMs?: number): RpcProviderConfig => ({
  id,
  label: `Provider ${id}`,
  url: `https://${id}.example.com`,
  priority,
  timeoutMs,
});

/** Returns a call function that resolves successfully with `value`. */
const okFn = <T>(value: T): RpcCallFn<T> => async (_url, _signal) => value;

/** Returns a call function that always rejects with `message`. */
const failFn = (message = 'network error'): RpcCallFn<never> =>
  async (_url, _signal) => {
    throw new Error(message);
  };

/** Returns a call function that never resolves (simulates hang). */
const hangFn = (): RpcCallFn<never> =>
  (_url, signal) =>
    new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(new Error('aborted')));
    });

/** Advances time and triggers the abort. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('RpcCircuitBreakerService', () => {
  // ── 1. Configurable timeout per RPC endpoint ─────────────────────────────

  describe('timeout', () => {
    it('resolves before timeout', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1', 0, 500)], {
        defaultTimeoutMs: 500,
      });
      await expect(svc.call(okFn('pong'))).resolves.toBe('pong');
    });

    it('throws RpcTimeoutError when provider hangs beyond per-provider timeout', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1', 0, 50)], {
        failureThreshold: 10,
      });
      const err = await svc.call(hangFn()).catch((e) => e) as RpcAllProvidersFailedError;
      expect(err).toBeInstanceOf(RpcAllProvidersFailedError);
      expect(err.errors[0].error).toBeInstanceOf(RpcTimeoutError);
    }, 1000);

    it('throws RpcTimeoutError when provider hangs beyond defaultTimeoutMs', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        defaultTimeoutMs: 50,
        failureThreshold: 10,
      });
      const err = await svc.call(hangFn()).catch((e) => e) as RpcAllProvidersFailedError;
      expect(err.errors[0].error).toBeInstanceOf(RpcTimeoutError);
    }, 1000);

    it('includes providerId and timeoutMs in RpcTimeoutError', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('slow', 0, 50)], {
        failureThreshold: 10,
      });
      const allErr = await svc.call(hangFn()).catch((e) => e) as RpcAllProvidersFailedError;
      const err = allErr.errors[0].error as RpcTimeoutError;
      expect(err.providerId).toBe('slow');
      expect(err.timeoutMs).toBe(50);
    }, 1000);

    it('uses per-provider timeoutMs over defaultTimeoutMs', async () => {
      // per-provider = 50 ms; default = 5000 ms — should timeout at 50 ms
      const svc = new RpcCircuitBreakerService([makeProvider('p1', 0, 50)], {
        defaultTimeoutMs: 5_000,
        failureThreshold: 10,
      });
      const start = Date.now();
      await svc.call(hangFn()).catch(() => null);
      expect(Date.now() - start).toBeLessThan(500);
    }, 1000);
  });

  // ── 2. Circuit breaker state machine ────────────────────────────────────

  describe('circuit state machine', () => {
    it('starts in closed state', () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')]);
      expect(svc.getCircuitStatus('p1').state).toBe('closed');
    });

    it('transitions closed → open after failureThreshold consecutive failures', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 3,
        defaultTimeoutMs: 200,
      });
      for (let i = 0; i < 3; i++) {
        await svc.call(failFn()).catch(() => null);
      }
      expect(svc.getCircuitStatus('p1').state).toBe('open');
    });

    it('does not open before failureThreshold is reached', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 5,
        defaultTimeoutMs: 200,
      });
      for (let i = 0; i < 4; i++) {
        await svc.call(failFn()).catch(() => null);
      }
      expect(svc.getCircuitStatus('p1').state).toBe('closed');
    });

    it('throws RpcCircuitOpenError when circuit is open', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 1,
        recoveryTimeoutMs: 60_000,
        defaultTimeoutMs: 200,
      });
      await svc.call(failFn()).catch(() => null); // trips the circuit
      await expect(svc.call(okFn('x'))).rejects.toBeInstanceOf(RpcAllProvidersFailedError);
    });

    it('transitions open → half-open after recoveryTimeoutMs', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 1,
        recoveryTimeoutMs: 50,
        successThreshold: 1,   // 1 success in half-open → closed
        defaultTimeoutMs: 200,
      });
      await svc.call(failFn()).catch(() => null);
      expect(svc.getCircuitStatus('p1').state).toBe('open');

      await sleep(60);
      // First call transitions open → half-open, then succeeds → closed
      await svc.call(okFn('probe')).catch(() => null);
      expect(svc.getCircuitStatus('p1').state).toBe('closed');
    }, 1000);

    it('transitions half-open → closed after successThreshold consecutive successes', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 1,
        recoveryTimeoutMs: 50,
        successThreshold: 2,
        defaultTimeoutMs: 200,
      });
      await svc.call(failFn()).catch(() => null);
      await sleep(60);

      await svc.call(okFn(1)).catch(() => null); // 1st success in half-open
      expect(svc.getCircuitStatus('p1').state).toBe('half-open');

      await svc.call(okFn(2)).catch(() => null); // 2nd success → closed
      expect(svc.getCircuitStatus('p1').state).toBe('closed');
    }, 1000);

    it('transitions half-open → open on failure', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 1,
        recoveryTimeoutMs: 50,
        successThreshold: 3,
        defaultTimeoutMs: 200,
      });
      await svc.call(failFn()).catch(() => null);
      await sleep(60);

      await svc.call(failFn()).catch(() => null); // fail in half-open → re-opens
      expect(svc.getCircuitStatus('p1').state).toBe('open');
    }, 1000);

    it('resets consecutive failure count on a success', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 5,
        defaultTimeoutMs: 200,
      });
      for (let i = 0; i < 4; i++) await svc.call(failFn()).catch(() => null);
      await svc.call(okFn('ok')); // success resets streak
      const status = svc.getCircuitStatus('p1');
      expect(status.consecutiveFailures).toBe(0);
      expect(status.state).toBe('closed');
    });
  });

  // ── 3. RPC provider fallback ─────────────────────────────────────────────

  describe('provider fallback', () => {
    it('falls back to secondary provider when primary fails', async () => {
      const svc = new RpcCircuitBreakerService(
        [makeProvider('primary', 0), makeProvider('secondary', 1)],
        { failureThreshold: 10, defaultTimeoutMs: 200 },
      );

      let callCount = 0;
      const fn: RpcCallFn<string> = async (url, _signal) => {
        callCount += 1;
        if (url.includes('primary')) throw new Error('primary down');
        return 'secondary-response';
      };

      const result = await svc.call(fn);
      expect(result).toBe('secondary-response');
      expect(callCount).toBe(2);
    });

    it('respects provider priority order', async () => {
      const order: string[] = [];
      const svc = new RpcCircuitBreakerService(
        [
          makeProvider('c', 2),
          makeProvider('a', 0),
          makeProvider('b', 1),
        ],
        { failureThreshold: 10, defaultTimeoutMs: 200 },
      );

      const fn: RpcCallFn<string> = async (url, _signal) => {
        const id = url.replace('https://', '').replace('.example.com', '');
        order.push(id);
        if (id !== 'c') throw new Error('not last');
        return 'done';
      };

      await svc.call(fn);
      expect(order).toEqual(['a', 'b', 'c']);
    });

    it('skips open-circuit providers and tries next', async () => {
      const svc = new RpcCircuitBreakerService(
        [makeProvider('p1', 0), makeProvider('p2', 1)],
        { failureThreshold: 1, recoveryTimeoutMs: 60_000, defaultTimeoutMs: 200 },
      );

      // Trip p1's circuit by using a url-discriminating fn that only fails p1
      await svc.call(async (url, _signal) => {
        if (url.includes('p1')) throw new Error('p1 down');
        return 'ok';
      }).catch(() => null);

      expect(svc.getCircuitStatus('p1').state).toBe('open');
      expect(svc.getCircuitStatus('p2').state).toBe('closed');

      // Now p1 is open — p2 should be used directly
      const result = await svc.call(okFn('from-p2'));
      expect(result).toBe('from-p2');
    });

    it('throws RpcAllProvidersFailedError when all providers fail', async () => {
      const svc = new RpcCircuitBreakerService(
        [makeProvider('p1'), makeProvider('p2')],
        { defaultTimeoutMs: 200 },
      );
      await expect(svc.call(failFn('boom'))).rejects.toBeInstanceOf(RpcAllProvidersFailedError);
    });

    it('RpcAllProvidersFailedError contains per-provider errors', async () => {
      const svc = new RpcCircuitBreakerService(
        [makeProvider('p1'), makeProvider('p2')],
        { defaultTimeoutMs: 200 },
      );
      const err = await svc.call(failFn('provider down')).catch((e) => e) as RpcAllProvidersFailedError;
      expect(err.errors).toHaveLength(2);
      expect(err.errors[0].providerId).toBe('p1');
      expect(err.errors[1].providerId).toBe('p2');
    });
  });

  // ── 4. Circuit state monitoring dashboard ───────────────────────────────

  describe('monitoring dashboard', () => {
    it('getDashboard returns correct counts for all states', async () => {
      const svc = new RpcCircuitBreakerService(
        [makeProvider('p1', 0), makeProvider('p2', 1), makeProvider('p3', 2)],
        { failureThreshold: 1, recoveryTimeoutMs: 60_000, defaultTimeoutMs: 200 },
      );

      // Only trip p1 by failing on p1's URL and succeeding on p2
      await svc.call(async (url, _signal) => {
        if (url.includes('p1')) throw new Error('p1 down');
        return 'ok';
      });

      const dash = svc.getDashboard();
      expect(dash.totalProviders).toBe(3);
      expect(dash.openCount).toBe(1);
      expect(dash.closedCount).toBe(2);
    });

    it('getDashboard tracks total calls and success rate', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 10,
        defaultTimeoutMs: 200,
      });

      await svc.call(okFn('a'));
      await svc.call(okFn('b'));
      await svc.call(failFn()).catch(() => null);

      const dash = svc.getDashboard();
      expect(dash.totalCallsAllTime).toBe(3);
      expect(dash.overallSuccessRate).toBeCloseTo(2 / 3);
    });

    it('getCircuitStatus includes avgLatencyMs', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        defaultTimeoutMs: 500,
      });
      await svc.call(okFn('x'));
      const status = svc.getCircuitStatus('p1');
      expect(status.avgLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('getCircuitStatus includes lastSuccessAt and lastFailureAt', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 10,
        defaultTimeoutMs: 200,
      });
      await svc.call(okFn('x'));
      expect(svc.getCircuitStatus('p1').lastSuccessAt).not.toBeNull();
      expect(svc.getCircuitStatus('p1').lastFailureAt).toBeNull();

      await svc.call(failFn()).catch(() => null);
      expect(svc.getCircuitStatus('p1').lastFailureAt).not.toBeNull();
    });

    it('getDashboard recentEvents includes state_change events', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 1,
        defaultTimeoutMs: 200,
      });
      await svc.call(failFn()).catch(() => null);
      const { recentEvents } = svc.getDashboard();
      const stateChange = recentEvents.find((e) => e.type === 'state_change');
      expect(stateChange).toBeDefined();
      expect(stateChange?.newState).toBe('open');
    });

    it('audit log is capped at maxAuditEvents', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 999,
        defaultTimeoutMs: 200,
        maxAuditEvents: 10,
      });
      for (let i = 0; i < 20; i++) await svc.call(okFn(i));
      expect(svc.getAuditLog().length).toBeLessThanOrEqual(10);
    });

    it('throws for unknown providerId in getCircuitStatus', () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')]);
      expect(() => svc.getCircuitStatus('unknown')).toThrow();
    });
  });

  // ── 5. Graceful degradation when circuit is open ─────────────────────────

  describe('graceful degradation', () => {
    it('all-open state throws RpcAllProvidersFailedError, not an unhandled crash', async () => {
      const svc = new RpcCircuitBreakerService(
        [makeProvider('p1'), makeProvider('p2')],
        { failureThreshold: 1, recoveryTimeoutMs: 60_000, defaultTimeoutMs: 200 },
      );
      // Trip both
      await svc.call(failFn()).catch(() => null);
      await expect(svc.call(okFn('x'))).rejects.toBeInstanceOf(RpcAllProvidersFailedError);
    });

    it('error from open circuit carries openUntil timestamp', async () => {
      const svc = new RpcCircuitBreakerService(
        [makeProvider('p1')],
        { failureThreshold: 1, recoveryTimeoutMs: 60_000, defaultTimeoutMs: 200 },
      );
      await svc.call(failFn()).catch(() => null);

      const allErr = await svc.call(okFn('x')).catch((e) => e) as RpcAllProvidersFailedError;
      const inner = allErr.errors[0].error as RpcCircuitOpenError;
      expect(inner).toBeInstanceOf(RpcCircuitOpenError);
      expect(inner.openUntil).toBeGreaterThan(Date.now());
    });

    it('audit log records all_open event', async () => {
      const svc = new RpcCircuitBreakerService(
        [makeProvider('p1')],
        { failureThreshold: 1, recoveryTimeoutMs: 60_000, defaultTimeoutMs: 200 },
      );
      await svc.call(failFn()).catch(() => null);
      await svc.call(okFn('x')).catch(() => null);

      const log = svc.getAuditLog();
      expect(log.some((e) => e.type === 'all_open')).toBe(true);
    });
  });

  // ── 6. Manual circuit reset ──────────────────────────────────────────────

  describe('manual reset', () => {
    it('resetCircuit sets state back to closed', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 1,
        recoveryTimeoutMs: 60_000,
        defaultTimeoutMs: 200,
      });
      await svc.call(failFn()).catch(() => null);
      expect(svc.getCircuitStatus('p1').state).toBe('open');

      svc.resetCircuit('p1');
      expect(svc.getCircuitStatus('p1').state).toBe('closed');
    });

    it('resetCircuit clears consecutive failure count', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 1,
        defaultTimeoutMs: 200,
      });
      await svc.call(failFn()).catch(() => null);
      svc.resetCircuit('p1');
      expect(svc.getCircuitStatus('p1').consecutiveFailures).toBe(0);
    });

    it('resetCircuit writes manual_reset audit event', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 1,
        defaultTimeoutMs: 200,
      });
      await svc.call(failFn()).catch(() => null);
      svc.resetCircuit('p1');
      const log = svc.getAuditLog();
      const resetEvent = log.find((e) => e.type === 'manual_reset');
      expect(resetEvent).toBeDefined();
      expect(resetEvent?.previousState).toBe('open');
      expect(resetEvent?.newState).toBe('closed');
    });

    it('resetAllCircuits resets every provider', async () => {
      const svc = new RpcCircuitBreakerService(
        [makeProvider('p1', 0), makeProvider('p2', 1)],
        { failureThreshold: 1, recoveryTimeoutMs: 60_000, defaultTimeoutMs: 200 },
      );
      await svc.call(failFn()).catch(() => null); // trips p1
      expect(svc.getCircuitStatus('p1').state).toBe('open');

      svc.resetAllCircuits();
      expect(svc.getCircuitStatus('p1').state).toBe('closed');
      expect(svc.getCircuitStatus('p2').state).toBe('closed');
    });

    it('after manual reset, successful calls close the circuit permanently', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 1,
        defaultTimeoutMs: 200,
      });
      await svc.call(failFn()).catch(() => null);
      svc.resetCircuit('p1');
      await svc.call(okFn('ok'));
      expect(svc.getCircuitStatus('p1').state).toBe('closed');
    });
  });

  // ── 7. Provider management ───────────────────────────────────────────────

  describe('provider management', () => {
    it('addProvider registers a new provider at runtime', async () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
        failureThreshold: 10,
        defaultTimeoutMs: 200,
      });
      svc.addProvider(makeProvider('p2', 1));

      let usedUrl = '';
      const fn: RpcCallFn<string> = async (url, _signal) => {
        usedUrl = url;
        if (url.includes('p1')) throw new Error('p1 down');
        return 'p2-ok';
      };

      await svc.call(fn);
      expect(usedUrl).toContain('p2');
    });

    it('removeProvider removes provider from rotation', async () => {
      const svc = new RpcCircuitBreakerService(
        [makeProvider('p1', 0), makeProvider('p2', 1)],
        { failureThreshold: 10, defaultTimeoutMs: 200 },
      );
      svc.removeProvider('p2');

      const statuses = svc.getCircuitStatuses();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].providerId).toBe('p1');
    });

    it('addProvider is idempotent for duplicate ids', () => {
      const svc = new RpcCircuitBreakerService([makeProvider('p1')]);
      svc.addProvider(makeProvider('p1')); // duplicate — should not throw or double-register
      expect(svc.getCircuitStatuses()).toHaveLength(1);
    });
  });
});
