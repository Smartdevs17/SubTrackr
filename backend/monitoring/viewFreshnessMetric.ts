import { MVRefreshJob } from '../analytics/jobs/mvRefreshJob';

export function createViewFreshnessHandler(job: MVRefreshJob) {
  return function handleMetrics(_req: unknown, res: {
    setHeader(name: string, value: string): void;
    end(body: string): void;
  }): void {
    const body = job.prometheusMetrics();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(body);
  };
}
