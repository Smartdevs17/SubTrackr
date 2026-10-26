export interface BenchmarkItem {
  id: string;
  createdAt: number;
  customerId: string;
  amount: number;
  status: 'active' | 'canceled' | 'past_due';
}

export type PaginationStrategy = 'OFFSET' | 'CURSOR';

export interface PaginationBenchmarkOptions {
  datasetSize: number;
  pageSize: number;
  targetPages?: number;
}

export interface MetricSummary {
  strategy: PaginationStrategy;
  datasetSize: number;
  pageSize: number;
  totalPagesFetched: number;
  totalTimeMs: number;
  avgPageLatencyMs: number;
  throughputPagesPerSec: number;
  throughputItemsPerSec: number;
  memoryDeltaBytes: number;
}

export interface RestPaginationBenchmarkReport {
  timestamp: number;
  results: MetricSummary[];
  cursorSpeedupFactor: number;
  recommendation: string;
}

export class RestPaginationBenchmark {
  private dataset: BenchmarkItem[] = [];

  constructor(datasetSize: number = 10000) {
    this.dataset = this.generateDataset(datasetSize);
  }

  public generateDataset(size: number): BenchmarkItem[] {
    const items: BenchmarkItem[] = new Array(size);
    const baseTime = Date.now() - size * 1000;

    for (let i = 0; i < size; i++) {
      items[i] = {
        id: `sub_${(i + 1).toString().padStart(6, '0')}`,
        createdAt: baseTime + i * 1000,
        customerId: `cust_${((i % 100) + 1).toString().padStart(4, '0')}`,
        amount: 1000 + (i % 50) * 100,
        status: i % 10 === 0 ? 'canceled' : 'active',
      };
    }
    return items;
  }

  public runBenchmark(options: PaginationBenchmarkOptions): RestPaginationBenchmarkReport {
    const datasetSize = Math.min(options.datasetSize, this.dataset.length);
    const subset = this.dataset.slice(0, datasetSize);
    const pageSize = options.pageSize;
    const maxPages = options.targetPages || Math.ceil(datasetSize / pageSize);

    const offsetMetrics = this.benchmarkOffsetPagination(subset, pageSize, maxPages);
    const cursorMetrics = this.benchmarkCursorPagination(subset, pageSize, maxPages);

    const speedup =
      offsetMetrics.avgPageLatencyMs > 0 && cursorMetrics.avgPageLatencyMs > 0
        ? offsetMetrics.avgPageLatencyMs / cursorMetrics.avgPageLatencyMs
        : 1.0;

    return {
      timestamp: Date.now(),
      results: [offsetMetrics, cursorMetrics],
      cursorSpeedupFactor: parseFloat(speedup.toFixed(2)),
      recommendation:
        speedup >= 1.1
          ? 'Cursor-based pagination recommended for lower deep-page latency and index efficiency.'
          : 'Both pagination strategies perform within expected threshold for current dataset size.',
    };
  }

  private benchmarkOffsetPagination(
    dataset: BenchmarkItem[],
    pageSize: number,
    maxPages: number
  ): MetricSummary {
    const initialMemory = process.memoryUsage().heapUsed;
    const startTime = performance.now();

    let pagesFetched = 0;
    let itemsFetched = 0;

    for (let page = 0; page < maxPages; page++) {
      const offset = page * pageSize;
      if (offset >= dataset.length) break;

      const pageItems = dataset.slice(offset, offset + pageSize);
      pagesFetched++;
      itemsFetched += pageItems.length;
    }

    const endTime = performance.now();
    const finalMemory = process.memoryUsage().heapUsed;
    const totalTimeMs = Math.max(0.01, endTime - startTime);

    return {
      strategy: 'OFFSET',
      datasetSize: dataset.length,
      pageSize,
      totalPagesFetched: pagesFetched,
      totalTimeMs: parseFloat(totalTimeMs.toFixed(3)),
      avgPageLatencyMs: parseFloat((totalTimeMs / Math.max(1, pagesFetched)).toFixed(4)),
      throughputPagesPerSec: Math.round((pagesFetched / totalTimeMs) * 1000),
      throughputItemsPerSec: Math.round((itemsFetched / totalTimeMs) * 1000),
      memoryDeltaBytes: Math.max(0, finalMemory - initialMemory),
    };
  }

  private benchmarkCursorPagination(
    dataset: BenchmarkItem[],
    pageSize: number,
    maxPages: number
  ): MetricSummary {
    const initialMemory = process.memoryUsage().heapUsed;
    const startTime = performance.now();

    let pagesFetched = 0;
    let itemsFetched = 0;
    let afterCursor: string | null = null;

    for (let page = 0; page < maxPages; page++) {
      let startIndex = 0;
      if (afterCursor) {
        startIndex = dataset.findIndex((item) => item.id === afterCursor) + 1;
        if (startIndex === 0 || startIndex >= dataset.length) break;
      }

      const pageItems = dataset.slice(startIndex, startIndex + pageSize);
      if (pageItems.length === 0) break;

      afterCursor = pageItems[pageItems.length - 1].id;
      pagesFetched++;
      itemsFetched += pageItems.length;
    }

    const endTime = performance.now();
    const finalMemory = process.memoryUsage().heapUsed;
    const totalTimeMs = Math.max(0.01, endTime - startTime);

    return {
      strategy: 'CURSOR',
      datasetSize: dataset.length,
      pageSize,
      totalPagesFetched: pagesFetched,
      totalTimeMs: parseFloat(totalTimeMs.toFixed(3)),
      avgPageLatencyMs: parseFloat((totalTimeMs / Math.max(1, pagesFetched)).toFixed(4)),
      throughputPagesPerSec: Math.round((pagesFetched / totalTimeMs) * 1000),
      throughputItemsPerSec: Math.round((itemsFetched / totalTimeMs) * 1000),
      memoryDeltaBytes: Math.max(0, finalMemory - initialMemory),
    };
  }
}
