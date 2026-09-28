import { RestPaginationBenchmark } from '../restPaginationBenchmark';

describe('RestPaginationBenchmark', () => {
  let benchmark: RestPaginationBenchmark;

  beforeEach(() => {
    benchmark = new RestPaginationBenchmark(5000);
  });

  it('generates mock dataset of specified size with correct field types', () => {
    const dataset = benchmark.generateDataset(100);

    expect(dataset).toHaveLength(100);
    expect(dataset[0]).toHaveProperty('id');
    expect(dataset[0]).toHaveProperty('createdAt');
    expect(dataset[0]).toHaveProperty('customerId');
    expect(dataset[0]).toHaveProperty('amount');
    expect(dataset[0]).toHaveProperty('status');
  });

  it('runs REST pagination performance benchmark and produces a valid report', () => {
    const report = benchmark.runBenchmark({
      datasetSize: 1000,
      pageSize: 50,
    });

    expect(report).toHaveProperty('timestamp');
    expect(report.results).toHaveLength(2);
    expect(report.results[0].strategy).toBe('OFFSET');
    expect(report.results[1].strategy).toBe('CURSOR');
    expect(report.results[0].totalPagesFetched).toBe(20);
    expect(report.results[1].totalPagesFetched).toBe(20);
    expect(report.cursorSpeedupFactor).toBeGreaterThan(0);
    expect(report.recommendation).toBeDefined();
  });

  it('calculates page latency and throughput metrics for both strategies', () => {
    const report = benchmark.runBenchmark({
      datasetSize: 500,
      pageSize: 25,
      targetPages: 10,
    });

    const [offsetMetrics, cursorMetrics] = report.results;

    expect(offsetMetrics.totalPagesFetched).toBe(10);
    expect(cursorMetrics.totalPagesFetched).toBe(10);
    expect(offsetMetrics.throughputItemsPerSec).toBeGreaterThan(0);
    expect(cursorMetrics.throughputItemsPerSec).toBeGreaterThan(0);
    expect(offsetMetrics.avgPageLatencyMs).toBeGreaterThanOrEqual(0);
    expect(cursorMetrics.avgPageLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('handles page size larger than total dataset size gracefully', () => {
    const report = benchmark.runBenchmark({
      datasetSize: 50,
      pageSize: 100,
    });

    expect(report.results[0].totalPagesFetched).toBe(1);
    expect(report.results[1].totalPagesFetched).toBe(1);
  });
});
