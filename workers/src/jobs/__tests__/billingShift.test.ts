import {
  batchKey,
  buildBatches,
  createBillingShiftJob,
} from '../billingShift';

describe('billingShift worker job', () => {
  describe('batchKey', () => {
    it('is deterministic per day', () => {
      expect(batchKey('2026-11-30T00:00:00.000Z')).toBe('billing-shift:2026-11-30');
      expect(batchKey('2026-11-30T23:59:00.000Z')).toBe(batchKey('2026-11-30T00:00:00.000Z'));
    });
  });

  describe('buildBatches', () => {
    it('groups shifted items by consolidated date and sorts ids', () => {
      const plan = {
        shifts: [
          { id: 'b', originalDate: '2026-11-25T00:00:00Z', shiftedDate: '2026-11-30T00:00:00Z', shiftDays: 5, weekday: 1 },
          { id: 'a', originalDate: '2026-11-26T00:00:00Z', shiftedDate: '2026-11-30T00:00:00Z', shiftDays: 4, weekday: 1 },
        ],
        rejected: [],
        total: 2,
        shifted: 2,
      } as any;
      const batches = buildBatches(plan);
      expect(batches.length).toBe(1);
      expect(batches[0].key).toBe('billing-shift:2026-11-30');
      expect(batches[0].items.map((i) => i.id)).toEqual(['a', 'b']);
      expect(batches[0].status).toBe('ready');
      expect(Object.isFrozen(batches)).toBe(true);
    });

    it('produces separate batches for different dates', () => {
      const plan = {
        shifts: [
          { id: 'x', originalDate: '2026-11-25T00:00:00Z', shiftedDate: '2026-11-30T00:00:00Z', shiftDays: 5, weekday: 1 },
          { id: 'y', originalDate: '2026-12-02T00:00:00Z', shiftedDate: '2026-12-07T00:00:00Z', shiftDays: 5, weekday: 1 },
        ],
        rejected: [],
        total: 2,
        shifted: 2,
      } as any;
      const batches = buildBatches(plan);
      expect(batches.length).toBe(2);
      expect(batches[0].key).toBe('billing-shift:2026-11-30');
      expect(batches[1].key).toBe('billing-shift:2026-12-07');
    });
  });

  describe('createBillingShiftJob', () => {
    it('runs a full plan into batches and counts rejections', () => {
      const job = createBillingShiftJob({ targetWeekday: 1 });
      const result = job.run([
        { id: 'sub1', dueDate: '2026-11-25T00:00:00Z' },
        { id: 'sub2', dueDate: '2026-11-24T00:00:00Z' },
        { id: '', dueDate: '2026-11-24T00:00:00Z' },
      ]);
      expect(result.plan.total).toBe(3);
      expect(result.plan.shifted).toBe(2);
      expect(result.rejected).toBe(1);
      expect(result.batches.length).toBeGreaterThan(0);
      expect(result.batches[0].items.length).toBe(2);
      expect(Object.isFrozen(result)).toBe(true);
    });

    it('handles an empty item list', () => {
      const job = createBillingShiftJob();
      const result = job.run([]);
      expect(result.plan.total).toBe(0);
      expect(result.batches.length).toBe(0);
    });
  });
});
