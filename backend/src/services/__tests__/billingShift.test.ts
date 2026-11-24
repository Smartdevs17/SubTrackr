import {
  BillingShiftError,
  DEFAULT_BILLING_SHIFT_CONFIG,
  WEEKDAY_NAMES,
  createBillingShifter,
  daysBetween,
  isWeekday,
  nextBillingDate,
  shiftDueDate,
  validateBillingShiftConfig,
} from '../billingShift';

describe('billingShift service', () => {
  describe('isWeekday / WEEKDAY_NAMES', () => {
    it('accepts integers 0-6 only', () => {
      expect(isWeekday(0)).toBe(true);
      expect(isWeekday(6)).toBe(true);
      expect(isWeekday(7)).toBe(false);
      expect(isWeekday(-1)).toBe(false);
      expect(isWeekday(1.5)).toBe(false);
      expect(isWeekday('1')).toBe(false);
    });

    it('names every weekday', () => {
      expect(WEEKDAY_NAMES[1]).toBe('Monday');
      expect(WEEKDAY_NAMES[0]).toBe('Sunday');
      expect(WEEKDAY_NAMES[6]).toBe('Saturday');
    });
  });

  describe('validateBillingShiftConfig', () => {
    it('returns defaults frozen', () => {
      const c = validateBillingShiftConfig();
      expect(c.targetWeekday).toBe(DEFAULT_BILLING_SHIFT_CONFIG.targetWeekday);
      expect(Object.isFrozen(c)).toBe(true);
    });

    it('rejects invalid weekday', () => {
      expect(() => validateBillingShiftConfig({ targetWeekday: 9 as any })).toThrow(BillingShiftError);
    });

    it('rejects invalid maxShiftDays', () => {
      expect(() => validateBillingShiftConfig({ maxShiftDays: 99 })).toThrow(BillingShiftError);
      expect(() => validateBillingShiftConfig({ maxShiftDays: -1 })).toThrow(BillingShiftError);
    });

    it('rejects invalid timezone offset', () => {
      expect(() => validateBillingShiftConfig({ timezoneOffsetMinutes: 2000 })).toThrow(BillingShiftError);
    });
  });

  describe('shiftDueDate', () => {
    it('leaves a date already on target weekday unchanged', () => {
      // 2026-11-23 is a Monday
      const r = shiftDueDate('2026-11-23T10:00:00.000Z', { targetWeekday: 1 });
      expect(r.shiftDays).toBe(0);
      expect(r.weekday).toBe(1);
    });

    it('shifts forward to the next Monday', () => {
      // 2026-11-25 is a Wednesday -> +5 days to Monday 2026-11-30
      const r = shiftDueDate('2026-11-25T10:00:00.000Z', { targetWeekday: 1 });
      expect(r.shiftDays).toBe(5);
      expect(r.weekday).toBe(1);
      expect(r.shiftedDate).toContain('2026-11-30');
    });

    it('supports backward shift within the same week', () => {
      const r = shiftDueDate('2026-11-24T10:00:00.000Z', { targetWeekday: 1, allowBackward: true });
      expect(r.shiftDays).toBeLessThan(0);
      expect(r.weekday).toBe(1);
    });

    it('throws SHIFT_EXCEEDED when shift is larger than maxShiftDays', () => {
      expect(() => shiftDueDate('2026-11-25T10:00:00.000Z', { targetWeekday: 1, maxShiftDays: 2 })).toThrow(
        BillingShiftError,
      );
    });

    it('rejects invalid dates', () => {
      expect(() => shiftDueDate('not-a-date')).toThrow(BillingShiftError);
      expect(() => shiftDueDate('')).toThrow(BillingShiftError);
    });
  });

  describe('daysBetween / nextBillingDate', () => {
    it('computes whole-day differences', () => {
      expect(daysBetween('2026-11-23T00:00:00Z', '2026-11-28T00:00:00Z')).toBe(5);
    });

    it('returns a Monday for nextBillingDate', () => {
      expect(nextBillingDate('2026-11-25T00:00:00Z', 1)).toContain('2026-11-30');
    });

    it('rejects invalid weekday', () => {
      expect(() => nextBillingDate('2026-11-25T00:00:00Z', 7 as any)).toThrow(BillingShiftError);
    });
  });

  describe('createBillingShifter', () => {
    it('records metrics and builds a plan', () => {
      const events: string[] = [];
      const shifter = createBillingShifter(
        { targetWeekday: 1 },
        {
          recordShift() { events.push('shift'); },
          recordRejected() { events.push('rejected'); },
          recordPlan() { events.push('plan'); },
        },
      );
      const plan = shifter.plan([
        { id: 'a', dueDate: '2026-11-25T00:00:00Z' },
        { id: 'b', dueDate: '2026-11-23T00:00:00Z' },
        { id: '', dueDate: '2026-11-23T00:00:00Z' },
      ]);
      expect(plan.total).toBe(3);
      expect(plan.shifted).toBe(2);
      expect(plan.rejected.length).toBe(1);
      expect(plan.rejected[0].code).toBe('INVALID_SUBSCRIPTION');
      expect(events).toContain('shift');
      expect(events).toContain('plan');
      expect(Object.isFrozen(plan)).toBe(true);
    });

    it('records rejection metric on invalid input', () => {
      let rejected = 0;
      const shifter = createBillingShifter({ targetWeekday: 1 }, { recordRejected() { rejected++; } });
      expect(() => shifter.shift('bad')).toThrow(BillingShiftError);
      expect(rejected).toBe(1);
    });
  });
});
