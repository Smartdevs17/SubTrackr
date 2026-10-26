import {
  DataRetentionService,
  DEFAULT_RETENTION_POLICIES,
  RetentionPolicyError,
  validateRetentionPolicy,
  type DataRetentionPolicy,
  type RetentionDataStore,
  type RetentionRecord,
} from '../dataRetentionService';
import { RetentionEnforcementJob } from '../retentionEnforcementJob';
import { RetentionController } from '../retentionController';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 1);

function policy(overrides: Partial<DataRetentionPolicy> = {}): DataRetentionPolicy {
  return {
    id: 'logs-policy',
    source: 'logs',
    retentionDays: 30,
    action: 'delete',
    enabled: true,
    ...overrides,
  };
}

/** In-memory store that honours the RetentionDataStore contract. */
function createStore(
  sourceName: string,
  records: RetentionRecord[],
  opts: { anonymize?: boolean; archive?: boolean } = {}
) {
  const data = new Map(records.map((r) => [r.id, r]));
  const anonymized = new Set<string>();
  const archived = new Set<string>();
  const store: RetentionDataStore = {
    sourceName,
    findExpired: jest.fn(async (cutoff: number, limit: number) =>
      [...data.values()].filter((r) => r.timestamp <= cutoff).slice(0, limit)
    ),
    deleteRecords: jest.fn(async (ids: string[]) => {
      let n = 0;
      for (const id of ids) if (data.delete(id)) n++;
      return n;
    }),
  };
  if (opts.anonymize) {
    store.anonymizeRecords = jest.fn(async (ids: string[]) => {
      ids.forEach((id) => anonymized.add(id));
      return ids.length;
    });
  }
  if (opts.archive) {
    store.archiveRecords = jest.fn(async (ids: string[]) => {
      ids.forEach((id) => archived.add(id));
      return ids.length;
    });
  }
  return { store, data, anonymized, archived };
}

const daysAgo = (days: number) => NOW - days * DAY_MS;

describe('validateRetentionPolicy', () => {
  it('accepts a valid policy', () => {
    expect(validateRetentionPolicy(policy())).toEqual([]);
  });

  it('accepts every default policy', () => {
    for (const p of DEFAULT_RETENTION_POLICIES) {
      expect(validateRetentionPolicy(p)).toEqual([]);
    }
  });

  it.each([
    [{ id: '' }, 'id is required'],
    [{ source: '' }, 'source is required'],
    [{ retentionDays: 0 }, 'retentionDays'],
    [{ retentionDays: 1.5 }, 'retentionDays'],
    [{ retentionDays: 4000 }, 'retentionDays'],
    [{ action: 'shred' as never }, 'action'],
    [{ enabled: 'yes' as never }, 'enabled'],
    [{ batchSize: 0 }, 'batchSize'],
  ])('rejects %p', (override, message) => {
    const errors = validateRetentionPolicy(policy(override));
    expect(errors.join(' ')).toContain(message);
  });
});

describe('DataRetentionService — policies', () => {
  it('loads initial policies and returns copies', () => {
    const service = new DataRetentionService(DEFAULT_RETENTION_POLICIES);
    expect(service.listPolicies()).toHaveLength(DEFAULT_RETENTION_POLICIES.length);

    const p = service.getPolicy('audit-logs')!;
    p.retentionDays = 1;
    expect(service.getPolicy('audit-logs')!.retentionDays).toBe(7 * 365);
  });

  it('updates an existing policy by id', () => {
    const service = new DataRetentionService([policy()]);
    service.upsertPolicy(policy({ retentionDays: 60 }));
    expect(service.getPolicy('logs-policy')!.retentionDays).toBe(60);
  });

  it('throws on invalid policy', () => {
    const service = new DataRetentionService();
    expect(() => service.upsertPolicy(policy({ retentionDays: -1 }))).toThrow(
      RetentionPolicyError
    );
  });

  it('rejects two policies governing the same source', () => {
    const service = new DataRetentionService([policy()]);
    expect(() => service.upsertPolicy(policy({ id: 'other' }))).toThrow(/already governed/);
  });

  it('removes policies', () => {
    const service = new DataRetentionService([policy()]);
    expect(service.removePolicy('logs-policy')).toBe(true);
    expect(service.removePolicy('logs-policy')).toBe(false);
    expect(service.getPolicy('logs-policy')).toBeNull();
  });

  it('rejects duplicate store registration', () => {
    const service = new DataRetentionService();
    service.registerStore(createStore('logs', []).store);
    expect(service.listStores()).toEqual(['logs']);
    expect(() => service.registerStore(createStore('logs', []).store)).toThrow(
      /already registered/
    );
  });
});

describe('DataRetentionService — enforcement', () => {
  it('deletes only records past the retention period', async () => {
    const service = new DataRetentionService([policy()]);
    const { store, data } = createStore('logs', [
      { id: 'old', timestamp: daysAgo(31) },
      { id: 'edge', timestamp: daysAgo(30) },
      { id: 'new', timestamp: daysAgo(29) },
    ]);
    service.registerStore(store);

    const report = await service.enforce({ now: NOW });

    expect(store.findExpired).toHaveBeenCalledWith(daysAgo(30), 1000);
    expect([...data.keys()]).toEqual(['new']);
    expect(report.totalProcessed).toBe(2);
    expect(report.failedPolicies).toEqual([]);
    expect(report.results[0]).toMatchObject({
      policyId: 'logs-policy',
      expiredFound: 2,
      processed: 2,
      skippedLegalHold: 0,
    });
  });

  it('anonymizes and archives according to policy action', async () => {
    const service = new DataRetentionService([
      policy({ id: 'billing', source: 'billing', action: 'anonymize' }),
      policy({ id: 'audit', source: 'audit', action: 'archive' }),
    ]);
    const billing = createStore('billing', [{ id: 'b1', timestamp: daysAgo(40) }], {
      anonymize: true,
    });
    const audit = createStore('audit', [{ id: 'a1', timestamp: daysAgo(40) }], { archive: true });
    service.registerStore(billing.store);
    service.registerStore(audit.store);

    const report = await service.enforce({ now: NOW });

    expect(billing.anonymized.has('b1')).toBe(true);
    expect(audit.archived.has('a1')).toBe(true);
    expect(billing.store.deleteRecords).not.toHaveBeenCalled();
    expect(audit.store.deleteRecords).not.toHaveBeenCalled();
    expect(report.totalProcessed).toBe(2);
  });

  it('does not modify data in dry-run mode', async () => {
    const service = new DataRetentionService([policy()]);
    const { store, data } = createStore('logs', [{ id: 'old', timestamp: daysAgo(90) }]);
    service.registerStore(store);

    const report = await service.enforce({ now: NOW, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.results[0].processed).toBe(1);
    expect(store.deleteRecords).not.toHaveBeenCalled();
    expect(data.has('old')).toBe(true);
  });

  it('skips disabled policies and honours policyIds filter', async () => {
    const service = new DataRetentionService([
      policy({ id: 'p1', source: 's1' }),
      policy({ id: 'p2', source: 's2', enabled: false }),
      policy({ id: 'p3', source: 's3' }),
    ]);
    ['s1', 's2', 's3'].forEach((s) => service.registerStore(createStore(s, []).store));

    const all = await service.enforce({ now: NOW });
    expect(all.results.map((r) => r.policyId)).toEqual(['p1', 'p3']);

    const filtered = await service.enforce({ now: NOW, policyIds: ['p3'] });
    expect(filtered.results.map((r) => r.policyId)).toEqual(['p3']);
  });

  it('respects the policy batch size', async () => {
    const service = new DataRetentionService([policy({ batchSize: 2 })]);
    const { store, data } = createStore(
      'logs',
      Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, timestamp: daysAgo(100) }))
    );
    service.registerStore(store);

    const report = await service.enforce({ now: NOW });
    expect(report.totalProcessed).toBe(2);
    expect(data.size).toBe(3);
  });

  it('never acts on unexpired records returned by a misbehaving store', async () => {
    const service = new DataRetentionService([policy()]);
    const deleteRecords = jest.fn(async (ids: string[]) => ids.length);
    service.registerStore({
      sourceName: 'logs',
      findExpired: async () => [
        { id: 'old', timestamp: daysAgo(31) },
        { id: 'fresh', timestamp: daysAgo(1) },
      ],
      deleteRecords,
    });

    await service.enforce({ now: NOW });
    expect(deleteRecords).toHaveBeenCalledWith(['old']);
  });

  it('does not call the store when nothing is expired', async () => {
    const service = new DataRetentionService([policy()]);
    const { store } = createStore('logs', [{ id: 'new', timestamp: daysAgo(1) }]);
    service.registerStore(store);

    const report = await service.enforce({ now: NOW });
    expect(store.deleteRecords).not.toHaveBeenCalled();
    expect(report.totalProcessed).toBe(0);
  });

  it('records history of reports, newest first', async () => {
    const service = new DataRetentionService([policy()]);
    service.registerStore(createStore('logs', []).store);

    expect(service.getLastReport()).toBeNull();
    const first = await service.enforce({ now: NOW });
    const second = await service.enforce({ now: NOW });
    expect(service.getLastReport()!.runId).toBe(second.runId);
    expect(service.listReports().map((r) => r.runId)).toEqual([second.runId, first.runId]);
    expect(service.listReports(1)).toHaveLength(1);
  });
});

describe('DataRetentionService — failure paths', () => {
  it('reports a missing store without aborting other policies', async () => {
    const service = new DataRetentionService([
      policy({ id: 'missing', source: 'nowhere' }),
      policy({ id: 'ok', source: 'logs' }),
    ]);
    const { store, data } = createStore('logs', [{ id: 'old', timestamp: daysAgo(90) }]);
    service.registerStore(store);

    const report = await service.enforce({ now: NOW });

    expect(report.failedPolicies).toEqual(['missing']);
    expect(report.results[0].error).toMatch(/No data store registered/);
    expect(data.size).toBe(0);
  });

  it('captures store errors per policy', async () => {
    const service = new DataRetentionService([policy()]);
    service.registerStore({
      sourceName: 'logs',
      findExpired: async () => [{ id: 'old', timestamp: daysAgo(90) }],
      deleteRecords: async () => {
        throw new Error('db down');
      },
    });

    const report = await service.enforce({ now: NOW });
    expect(report.failedPolicies).toEqual(['logs-policy']);
    expect(report.results[0].error).toBe('db down');
    expect(report.results[0].processed).toBe(0);
  });

  it('captures non-Error throws', async () => {
    const service = new DataRetentionService([policy()]);
    service.registerStore({
      sourceName: 'logs',
      findExpired: async () => {
        throw 'boom';
      },
      deleteRecords: async () => 0,
    });

    const report = await service.enforce({ now: NOW });
    expect(report.results[0].error).toBe('boom');
  });

  it.each(['anonymize', 'archive'] as const)(
    'fails when store does not support %s',
    async (action) => {
      const service = new DataRetentionService([policy({ action })]);
      service.registerStore(createStore('logs', [{ id: 'old', timestamp: daysAgo(90) }]).store);

      const report = await service.enforce({ now: NOW });
      expect(report.results[0].error).toMatch(`does not support ${action}`);
    }
  );

  it('rejects concurrent enforcement runs', async () => {
    const service = new DataRetentionService([policy()]);
    let release!: () => void;
    service.registerStore({
      sourceName: 'logs',
      findExpired: () => new Promise((resolve) => (release = () => resolve([]))),
      deleteRecords: async () => 0,
    });

    const first = service.enforce({ now: NOW });
    expect(service.isRunning()).toBe(true);
    await expect(service.enforce({ now: NOW })).rejects.toThrow(/already running/);
    release();
    await first;
    expect(service.isRunning()).toBe(false);
  });
});

describe('DataRetentionService — legal holds', () => {
  let service: DataRetentionService;
  let data: Map<string, RetentionRecord>;

  beforeEach(() => {
    service = new DataRetentionService([policy()]);
    const created = createStore('logs', [
      { id: 'r1', userId: 'u1', timestamp: daysAgo(90) },
      { id: 'r2', userId: 'u2', timestamp: daysAgo(90) },
      { id: 'r3', timestamp: daysAgo(90) },
    ]);
    data = created.data;
    service.registerStore(created.store);
  });

  it('skips records held at user scope', async () => {
    service.placeLegalHold({ scope: 'user', targetId: 'u1', reason: 'litigation' });
    const report = await service.enforce({ now: NOW });
    expect([...data.keys()]).toEqual(['r1']);
    expect(report.totalSkippedLegalHold).toBe(1);
  });

  it('skips records held at record scope', async () => {
    service.placeLegalHold({ scope: 'record', targetId: 'r3', reason: 'investigation' });
    await service.enforce({ now: NOW });
    expect([...data.keys()]).toEqual(['r3']);
  });

  it('ignores holds scoped to a different source', async () => {
    service.placeLegalHold({ scope: 'user', targetId: 'u1', reason: 'x', source: 'billing' });
    await service.enforce({ now: NOW });
    expect(data.size).toBe(0);
  });

  it('enforces again once a hold is released', async () => {
    const hold = service.placeLegalHold({ scope: 'user', targetId: 'u1', reason: 'x' });
    expect(service.listLegalHolds()).toHaveLength(1);

    expect(service.releaseLegalHold(hold.id)!.releasedAt).toBeDefined();
    expect(service.releaseLegalHold(hold.id)).toBeNull();
    expect(service.releaseLegalHold('unknown')).toBeNull();
    expect(service.listLegalHolds()).toHaveLength(0);
    expect(service.listLegalHolds(false)).toHaveLength(1);

    await service.enforce({ now: NOW });
    expect(data.size).toBe(0);
  });

  it.each([
    [{ scope: 'user' as const, targetId: '', reason: 'x' }, /targetId/],
    [{ scope: 'user' as const, targetId: 'u1', reason: '' }, /reason/],
    [{ scope: 'org' as never, targetId: 'u1', reason: 'x' }, /scope/],
  ])('rejects invalid hold %p', (input, message) => {
    expect(() => service.placeLegalHold(input)).toThrow(message);
  });
});

describe('RetentionEnforcementJob', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('runs enforcement and forwards the report', async () => {
    const service = new DataRetentionService([policy()]);
    service.registerStore(createStore('logs', []).store);
    const onReport = jest.fn();
    const job = new RetentionEnforcementJob(service, { onReport });

    const report = await job.run();
    expect(report).not.toBeNull();
    expect(onReport).toHaveBeenCalledWith(report);
  });

  it('logs failed policies', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const service = new DataRetentionService([policy()]);
    const job = new RetentionEnforcementJob(service);

    await job.run();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('logs-policy'));
  });

  it('returns null and logs when enforcement throws', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const service = new DataRetentionService();
    jest.spyOn(service, 'enforce').mockRejectedValue(new Error('fatal'));
    const job = new RetentionEnforcementJob(service);

    expect(await job.run()).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      '[RetentionEnforcementJob] Enforcement failed:',
      expect.any(Error)
    );
  });

  it('skips a run while enforcement is already in progress', async () => {
    const service = new DataRetentionService();
    jest.spyOn(service, 'isRunning').mockReturnValue(true);
    const enforce = jest.spyOn(service, 'enforce');
    const job = new RetentionEnforcementJob(service);

    expect(await job.run()).toBeNull();
    expect(enforce).not.toHaveBeenCalled();
  });

  it('schedules runs on an interval and stops cleanly', () => {
    jest.useFakeTimers();
    const service = new DataRetentionService();
    const enforce = jest.spyOn(service, 'enforce');
    const job = new RetentionEnforcementJob(service, { intervalMs: 1000 });

    job.start();
    job.start();
    expect(job.isScheduled()).toBe(true);
    expect(enforce).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    expect(enforce).toHaveBeenCalledTimes(2);

    job.stop();
    job.stop();
    expect(job.isScheduled()).toBe(false);
    jest.advanceTimersByTime(5000);
    expect(enforce).toHaveBeenCalledTimes(2);
  });
});

describe('RetentionController', () => {
  let service: DataRetentionService;
  let controller: RetentionController;

  beforeEach(() => {
    service = new DataRetentionService([policy()]);
    service.registerStore(createStore('logs', [{ id: 'old', timestamp: daysAgo(90) }]).store);
    controller = new RetentionController(service);
  });

  it('lists policies', () => {
    const res = controller.handleListPolicies();
    expect(res.status).toBe(200);
    expect(res.data).toHaveLength(1);
  });

  it('upserts a valid policy', () => {
    const res = controller.handleUpsertPolicy('notif', {
      source: 'notifications',
      retentionDays: 10,
      action: 'delete',
      enabled: true,
    });
    expect(res).toMatchObject({ success: true, status: 200 });
    expect(service.getPolicy('notif')).not.toBeNull();
  });

  it('returns 400 for invalid policy or missing id', () => {
    expect(
      controller.handleUpsertPolicy('bad', {
        source: 'x',
        retentionDays: 0,
        action: 'delete',
        enabled: true,
      }).status
    ).toBe(400);
    expect(
      controller.handleUpsertPolicy('', {
        source: 'x',
        retentionDays: 1,
        action: 'delete',
        enabled: true,
      }).status
    ).toBe(400);
  });

  it('removes policies and 404s on unknown', () => {
    expect(controller.handleRemovePolicy('logs-policy').status).toBe(200);
    expect(controller.handleRemovePolicy('logs-policy').status).toBe(404);
  });

  it('runs enforcement (dry run) and lists reports', async () => {
    const res = await controller.handleEnforce({ dryRun: true });
    expect(res.status).toBe(200);
    expect((res.data as { dryRun: boolean }).dryRun).toBe(true);

    const reports = controller.handleListReports();
    expect(reports.data).toHaveLength(1);
    expect(controller.handleListReports(0).status).toBe(400);
  });

  it('runs enforcement with defaults', async () => {
    const res = await controller.handleEnforce();
    expect((res.data as { dryRun: boolean; totalProcessed: number }).dryRun).toBe(false);
    expect((res.data as { totalProcessed: number }).totalProcessed).toBe(1);
  });

  it('validates enforce body', async () => {
    const res = await controller.handleEnforce({ policyIds: 'x' as never });
    expect(res.status).toBe(400);
  });

  it('returns 409 while enforcement is running', async () => {
    jest.spyOn(service, 'isRunning').mockReturnValue(true);
    expect((await controller.handleEnforce()).status).toBe(409);
  });

  it('maps a race on the running guard to 409 and unexpected errors to 500', async () => {
    jest
      .spyOn(service, 'enforce')
      .mockRejectedValueOnce(new RetentionPolicyError('Retention enforcement is already running'))
      .mockRejectedValueOnce(new Error('unexpected'));
    expect((await controller.handleEnforce()).status).toBe(409);
    expect(await controller.handleEnforce()).toMatchObject({ status: 500, error: 'Internal error' });
  });

  it('places, lists and releases legal holds', () => {
    const placed = controller.handlePlaceLegalHold({
      scope: 'user',
      targetId: 'u1',
      reason: 'litigation',
    });
    expect(placed.status).toBe(201);
    const id = (placed.data as { id: string }).id;

    expect(controller.handleListLegalHolds().data).toHaveLength(1);
    expect(controller.handleReleaseLegalHold(id).status).toBe(200);
    expect(controller.handleReleaseLegalHold(id).status).toBe(404);
  });

  it('returns 400 for an invalid legal hold', () => {
    const res = controller.handlePlaceLegalHold({ scope: 'user', targetId: '', reason: 'x' });
    expect(res.status).toBe(400);
  });
});
