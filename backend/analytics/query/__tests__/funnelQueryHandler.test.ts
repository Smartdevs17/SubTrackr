import { FunnelQueryHandler, FunnelQueryResult, FunnelStageResult } from '../funnelQueryHandler';

// Mock QueryClient
const mockQuery = jest.fn();
const mockDb = { query: mockQuery } as any;

describe('FunnelQueryHandler', () => {
  let handler: FunnelQueryHandler;

  beforeEach(() => {
    handler = new FunnelQueryHandler(mockDb);
    mockQuery.mockReset();
  });

  const mockRow = {
    period: '2026-09',
    cohort: 'organic',
    visitor_count: 10000,
    signup_count: 3000,
    trial_started_count: 2000,
    trial_completed_count: 1200,
    paid_conversion_count: 800,
    retained_30d_count: 600,
    refreshedAt: new Date('2026-09-24'),
  };

  describe('getFunnel', () => {
    it('should return funnel results with stages', async () => {
      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const results = await handler.getFunnel('2026-01', '2026-09');

      expect(results).toHaveLength(1);
      expect(results[0].period).toBe('2026-09');
      expect(results[0].cohort).toBe('organic');
      expect(results[0].stages).toHaveLength(6);
      expect(results[0].stages[0].stage).toBe('visitor');
      expect(results[0].stages[0].count).toBe(10000);
      expect(results[0].stages[5].stage).toBe('retained_30d');
      expect(results[0].stages[5].count).toBe(600);
    });

    it('should compute conversion rates between stages', async () => {
      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const results = await handler.getFunnel();

      const signupStage = results[0].stages[1];
      expect(signupStage.count).toBe(3000);
      expect(signupStage.conversionRate).toBeCloseTo(30, 0); // 3000/10000 * 100
      expect(signupStage.dropOffRate).toBeCloseTo(70, 0); // (10000-3000)/10000 * 100
      expect(signupStage.dropOffCount).toBe(7000);
    });

    it('should compute overall conversion rate', async () => {
      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const results = await handler.getFunnel();

      expect(results[0].overallConversionRate).toBeCloseTo(6, 0); // 600/10000 * 100
      expect(results[0].totalVisitors).toBe(10000);
      expect(results[0].totalConversions).toBe(600);
    });

    it('should pass date range parameters to SQL', async () => {
      mockQuery.mockResolvedValue({ rows: [mockRow] });

      await handler.getFunnel('2026-01', '2026-09');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('period >= $1');
      expect(sql).toContain('period <= $2');
      expect(params).toEqual(['2026-01', '2026-09']);
    });

    it('should filter by cohort when provided', async () => {
      mockQuery.mockResolvedValue({ rows: [mockRow] });

      await handler.getFunnel(undefined, undefined, 'organic');

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('cohort = $1');
      expect(params).toEqual(['organic']);
    });

    it('should handle empty results', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const results = await handler.getFunnel();
      expect(results).toHaveLength(0);
    });
  });

  describe('getAggregatedFunnel', () => {
    it('should return a single aggregated result', async () => {
      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await handler.getAggregatedFunnel('2026-01', '2026-09');

      expect(result.period).toBe('aggregated');
      expect(result.stages).toHaveLength(6);
      expect(result.totalVisitors).toBe(10000);
    });

    it('should return empty result when no data', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await handler.getAggregatedFunnel();

      expect(result.period).toBe('N/A');
      expect(result.stages).toHaveLength(0);
      expect(result.totalVisitors).toBe(0);
    });
  });

  describe('compareCohorts', () => {
    it('should return results grouped by cohort', async () => {
      const mockRows = [
        { ...mockRow, cohort: 'organic' },
        { ...mockRow, cohort: 'paid', visitor_count: 5000, paid_conversion_count: 500 },
      ];
      mockQuery.mockResolvedValue({ rows: mockRows });

      const results = await handler.compareCohorts('2026-01', '2026-09');

      expect(results).toHaveLength(2);
      expect(results[0].cohort).toBe('organic');
      expect(results[1].cohort).toBe('paid');
    });

    it('should use GROUP BY in SQL', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await handler.compareCohorts();

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('GROUP BY period, cohort');
      expect(sql).toContain('cohort IS NOT NULL');
    });
  });

  describe('stage computation edge cases', () => {
    it('should handle zero visitors gracefully', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          ...mockRow,
          visitor_count: 0,
          signup_count: 0,
          trial_started_count: 0,
          trial_completed_count: 0,
          paid_conversion_count: 0,
          retained_30d_count: 0,
        }],
      });

      const results = await handler.getFunnel();

      expect(results[0].overallConversionRate).toBe(0);
      expect(results[0].stages[0].conversionRate).toBe(0);
    });

    it('should label stages correctly', async () => {
      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const results = await handler.getFunnel();

      expect(results[0].stages[0].label).toBe('Visitors');
      expect(results[0].stages[1].label).toBe('Sign-ups');
      expect(results[0].stages[2].label).toBe('Trial Started');
      expect(results[0].stages[3].label).toBe('Trial Completed');
      expect(results[0].stages[4].label).toBe('Paid Conversion');
      expect(results[0].stages[5].label).toBe('Retained (30d)');
    });
  });
});
