import { MerchantMetrics } from '../BenchmarkEngine';

export interface AggregatedCohort {
  vertical: string;
  region: string;
  companySize: string;
  metrics: MerchantMetrics[];
  cohortSize: number;
}

export class MonthlyAggregationJob {
  private onAggregate: (cohorts: AggregatedCohort[]) => Promise<void>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(onAggregate: (cohorts: AggregatedCohort[]) => Promise<void>) {
    this.onAggregate = onAggregate;
  }

  start(): void {
    const msUntilNextMonth = this.msUntilNextMonth();
    setTimeout(() => {
      void this.aggregate();
      this.timer = setInterval(() => void this.aggregate(), 30 * 24 * 60 * 60 * 1000);
    }, msUntilNextMonth);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async aggregate(): Promise<void> {
    try {
      console.info('[MonthlyAggregationJob] Starting monthly aggregation');
    } catch (err) {
      console.error('[MonthlyAggregationJob] Aggregation failed:', err);
    }
  }

  private msUntilNextMonth(): number {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return next.getTime() - now.getTime();
  }
}
