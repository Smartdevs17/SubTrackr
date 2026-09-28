import { GeographicRevenueQueryHandler, GeographicRevenueResult, GeographicSummaryResult } from '../geographicRevenueQueryHandler';

const mockQuery = jest.fn();
const mockDb = { query: mockQuery } as any;

describe('GeographicRevenueQueryHandler', () => {
  let handler: GeographicRevenueQueryHandler;

  beforeEach(() => {
    handler = new GeographicRevenueQueryHandler(mockDb);
    mockQuery.mockReset();
  });

  const mockCountryRow: GeographicRevenueResult = {
    country: 'United States',
    countryCode: 'US',
    region: 'North America',
    mrr: 50000,
    arr: 600000,
    subscriberCount: 500,
    arpu: 100,
    revenueShare: 50,
    growthRate: 12.5,
    churnRate: 3.2,
    refreshedAt: new Date('2026-09-24'),
  };

  describe('getRevenueByCountry', () => {
    it('should return country-level revenue data', async () => {
      mockQuery.mockResolvedValue({ rows: [mockCountryRow] });

      const results = await handler.getRevenueByCountry();

      expect(results).toHaveLength(1);
      expect(results[0].country).toBe('United States');
      expect(results[0].countryCode).toBe('US');
      expect(results[0].region).toBe('North America');
      expect(results[0].mrr).toBe(50000);
    });

    it('should filter by date range', async () => {
      mockQuery.mockResolvedValue({ rows: [mockCountryRow] });

      await handler.getRevenueByCountry('2026-01', '2026-09');

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('period >= $1');
      expect(sql).toContain('period <= $2');
      expect(params).toEqual(['2026-01', '2026-09']);
    });

    it('should filter by region', async () => {
      mockQuery.mockResolvedValue({ rows: [mockCountryRow] });

      await handler.getRevenueByCountry(undefined, undefined, 'North America');

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('region = $1');
      expect(params).toEqual(['North America']);
    });

    it('should order by MRR descending', async () => {
      mockQuery.mockResolvedValue({ rows: [mockCountryRow] });

      await handler.getRevenueByCountry();

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('ORDER BY mrr DESC');
    });

    it('should handle empty results', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const results = await handler.getRevenueByCountry();
      expect(results).toHaveLength(0);
    });
  });

  describe('getSummary', () => {
    it('should return aggregated summary', async () => {
      // First call: summary
      mockQuery.mockResolvedValueOnce({
        rows: [{
          totalMRR: 100000,
          totalARR: 1200000,
          totalSubscribers: 1000,
          countryCount: 10,
          refreshedAt: new Date('2026-09-24'),
        }],
      });
      // Second call: top country
      mockQuery.mockResolvedValueOnce({
        rows: [{ country: 'United States', mrr: 50000 }],
      });
      // Third call: regions
      mockQuery.mockResolvedValueOnce({
        rows: [
          { region: 'North America', mrr: 60000, subscriberCount: 600 },
          { region: 'Europe', mrr: 30000, subscriberCount: 300 },
        ],
      });
      // Fourth call: avg growth rate
      mockQuery.mockResolvedValueOnce({
        rows: [{ avgGrowthRate: 8.5 }],
      });

      const summary = await handler.getSummary();

      expect(summary.totalMRR).toBe(100000);
      expect(summary.totalARR).toBe(1200000);
      expect(summary.totalSubscribers).toBe(1000);
      expect(summary.countryCount).toBe(10);
      expect(summary.topCountry).toBe('United States');
      expect(summary.topCountryMRR).toBe(50000);
      expect(summary.avgGrowthRate).toBe(8.5);
      expect(summary.regions).toHaveLength(2);
      expect(summary.regions[0].region).toBe('North America');
      expect(summary.regions[0].share).toBeCloseTo(60, 0);
    });

    it('should return empty summary when no data', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const summary = await handler.getSummary();

      expect(summary.totalMRR).toBe(0);
      expect(summary.topCountry).toBe('N/A');
      expect(summary.regions).toHaveLength(0);
    });
  });

  describe('getRevenueTrendByRegion', () => {
    it('should return trend data grouped by period and region', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { period: '2026-09', region: 'North America', mrr: 60000, subscriberCount: 600 },
          { period: '2026-09', region: 'Europe', mrr: 30000, subscriberCount: 300 },
        ],
      });

      const trends = await handler.getRevenueTrendByRegion('2026-01', '2026-09');

      expect(trends).toHaveLength(2);
      expect(trends[0].region).toBe('North America');
      expect(trends[0].mrr).toBe(60000);
    });

    it('should use GROUP BY period, region', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await handler.getRevenueTrendByRegion();

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('GROUP BY period, region');
    });
  });
});
