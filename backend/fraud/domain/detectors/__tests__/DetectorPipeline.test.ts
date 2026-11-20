import { DetectorPipeline, FraudDetector, ruleToDetector } from '../index';
import { RuleEngine } from '../../RuleEngine';
import { RuleRegistry } from '../../RuleRegistry';
import { FraudContext, FraudTransaction } from '../../rules/FraudRule';

const tx: FraudTransaction = {
  id: 't1',
  subscriberId: 's1',
  merchantId: 'm1',
  amount: 100,
  currency: 'USD',
  createdAt: new Date().toISOString(),
  chargebacks: 0,
  expectedUsage: 1,
  observedUsage: 1,
};
const ctx: FraudContext = { subscriberHistory: [], merchantThreshold: 1000 };

function det(id: string, score: number, weight = 1, extra: Partial<FraudDetector> = {}): FraudDetector {
  return {
    id,
    category: 'velocity',
    weight,
    enabled: true,
    detect: () => ({ score, reasons: score ? [`${id} fired`] : [], triggered: score > 0 }),
    ...extra,
  };
}

describe('DetectorPipeline', () => {
  it('approves when no detectors are enabled', async () => {
    const p = new DetectorPipeline().register(det('a', 90, 1, { enabled: false }));
    const r = await p.evaluate(tx, ctx);
    expect(r.action).toBe('approve');
    expect(r.scores).toHaveLength(0);
  });

  it('aggregates weighted scores and picks the top reason', async () => {
    const p = new DetectorPipeline().register(det('a', 60, 1)).register(det('b', 40, 3));
    const r = await p.evaluate(tx, ctx);
    // (60*1 + 40*3) / 4 * 1.5 = 67.5 -> 68
    expect(r.totalScore).toBe(68);
    expect(r.action).toBe('flag');
    expect(r.reason).toBe('b fired');
  });

  it('blocks at or above the block threshold', async () => {
    const p = new DetectorPipeline({ blockThreshold: 80 }).register(det('a', 60));
    expect((await p.evaluate(tx, ctx)).action).toBe('block'); // 60*1.5 = 90
  });

  it('supports async detectors', async () => {
    const p = new DetectorPipeline().register(
      det('slow', 0, 1, { detect: async () => ({ score: 40, reasons: ['x'], triggered: true }) }),
    );
    expect((await p.evaluate(tx, ctx)).scores[0].rawScore).toBe(40);
  });

  it('isolates a throwing detector and still scores the rest', async () => {
    const p = new DetectorPipeline()
      .register(det('bad', 0, 1, { detect: () => { throw new Error('boom'); } }))
      .register(det('good', 40));
    const r = await p.evaluate(tx, ctx);
    expect(r.failures).toEqual([{ detectorId: 'bad', outcome: 'error', message: 'boom' }]);
    expect(r.scores.map((s) => s.detectorId)).toEqual(['good']);
    expect(r.totalScore).toBe(60);
  });

  it('times out a hung detector', async () => {
    const p = new DetectorPipeline({ defaultTimeoutMs: 20 }).register(
      det('hang', 0, 1, { detect: () => new Promise(() => undefined) }),
    );
    const r = await p.evaluate(tx, ctx);
    expect(r.failures[0].outcome).toBe('timeout');
  });

  it('rejects out-of-range or malformed results', async () => {
    const p = new DetectorPipeline()
      .register(det('big', 0, 1, { detect: () => ({ score: 500, reasons: [], triggered: true }) }))
      .register(det('nan', 0, 1, { detect: () => ({ score: NaN, reasons: [], triggered: true }) }))
      .register(det('junk', 0, 1, { detect: () => null as any }));
    const r = await p.evaluate(tx, ctx);
    expect(r.failures.map((f) => f.outcome)).toEqual(['invalid', 'invalid', 'invalid']);
    expect(r.totalScore).toBe(0);
  });

  it('reports every run to the observer and survives observer errors', async () => {
    const events: any[] = [];
    const p = new DetectorPipeline({
      observer: {
        onDetectorRun: (e) => {
          events.push(e);
          throw new Error('observer down');
        },
      },
    })
      .register(det('a', 10))
      .register(det('b', 0, 1, { detect: () => { throw new Error('x'); } }));
    await expect(p.evaluate(tx, ctx)).resolves.toBeDefined();
    expect(events.map((e) => [e.detectorId, e.outcome])).toEqual([
      ['a', 'ok'],
      ['b', 'error'],
    ]);
    expect(events[0].transactionId).toBe('t1');
  });

  it('applies the false-positive penalty', async () => {
    const p = new DetectorPipeline().register(det('a', 60));
    const r = await p.evaluate({ ...tx, falsePositiveCount: 1 }, ctx);
    expect(r.totalScore).toBe(50); // 90 - 40
  });

  it('validates registration', () => {
    const p = new DetectorPipeline().register(det('a', 1));
    expect(() => p.register(det('a', 1))).toThrow(/already registered/);
    expect(() => p.register(det('z', 1, 0))).toThrow(/weight/);
    expect(() => p.register(det('', 1))).toThrow(/id/);
    expect(p.unregister('a')).toBe(true);
    expect(p.unregister('a')).toBe(false);
  });

  it('produces the same score as the legacy RuleEngine for built-in rules', async () => {
    const engine = new RuleEngine(new RuleRegistry());
    const history = [1, 2, 3, 4, 5].map((i) => ({ ...tx, id: `h${i}` }));
    const sample: FraudTransaction = {
      ...tx,
      amount: 9000,
      homeCountry: 'US',
      currentCountry: 'RU',
      chargebacks: 2,
    };
    const sampleCtx: FraudContext = { subscriberHistory: history, merchantThreshold: 1000, vpnDetected: true, accountAgeDays: 1 };

    const legacy = engine.evaluate(sample, sampleCtx);
    const pipeline = new DetectorPipeline();
    engine.getRegistry().getAll().forEach((r) => pipeline.register(ruleToDetector(r)));
    const next = await pipeline.evaluate(sample, sampleCtx);

    expect(next.totalScore).toBe(legacy.totalScore);
    expect(next.action).toBe(legacy.action);
    expect(next.failures).toEqual([]);
  });

  it('adapter reflects enable/disable on the underlying rule', () => {
    const rule: any = { name: 'r', weight: 1, category: 'velocity', enabled: true, evaluate: jest.fn() };
    const d = ruleToDetector(rule);
    d.enabled = false;
    expect(rule.enabled).toBe(false);
  });
});

describe('createLoggingObserver', () => {
  it('logs ok runs at debug and failures at warn', () => {
    const { createLoggingObserver } = require('../index');
    const logger = { debug: jest.fn(), warn: jest.fn() };
    const o = createLoggingObserver(logger);
    o.onDetectorRun({ detectorId: 'a', transactionId: 't', outcome: 'ok', durationMs: 1, score: 5 });
    o.onDetectorRun({ detectorId: 'b', transactionId: 't', outcome: 'timeout', durationMs: 9, error: new Error('x') });
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('[fraud] detector failed', expect.objectContaining({ outcome: 'timeout', error: 'x' }));
  });
});
