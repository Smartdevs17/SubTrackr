/**
 * RetentionCalculator
 *
 * Pure retention math used by CohortService: is-a-subscriber-still-active-at-day-N,
 * and the Day 1/7/30/60/90 retention curve required by issue #545.
 */

import type { RetentionCurvePoint, SubscriberRecord } from '../../../src/types/cohortAnalytics';

const DAY_MS = 24 * 60 * 60 * 1_000;
export const RETENTION_CURVE_DAYS: RetentionCurvePoint['day'][] = [1, 7, 30, 60, 90];

export class RetentionCalculator {
  /**
   * A subscriber is "retained at day N" if, N days after signup, they had not
   * yet churned (or, when activity data is available, were still active on or
   * after that day).
   */
  static isRetainedAtDay(record: SubscriberRecord, day: number, asOf: number = Date.now()): boolean {
    const dayMark = record.signupAt + day * DAY_MS;
    if (asOf < dayMark) return false; // cohort hasn't reached this day yet
    if (record.churnedAt !== undefined && record.churnedAt < dayMark) return false;
    if (record.lastActiveAt !== undefined) {
      return record.lastActiveAt >= dayMark || record.churnedAt === undefined;
    }
    return record.churnedAt === undefined || record.churnedAt >= dayMark;
  }

  /** Retention curve across the standard Day 1/7/30/60/90 checkpoints for a set of records. */
  static retentionCurve(
    records: SubscriberRecord[],
    asOf: number = Date.now(),
    days: RetentionCurvePoint['day'][] = RETENTION_CURVE_DAYS
  ): RetentionCurvePoint[] {
    return days.map((day) => {
      // Only cohorts old enough to have reached this checkpoint are eligible —
      // otherwise a brand-new cohort would incorrectly show 0% Day 90 retention.
      const eligible = records.filter((record) => asOf >= record.signupAt + day * DAY_MS);
      const retained = eligible.filter((record) => this.isRetainedAtDay(record, day, asOf));
      return {
        day,
        retainedCount: retained.length,
        cohortSize: eligible.length,
        retentionRate: eligible.length ? retained.length / eligible.length : 0,
      };
    });
  }
}
