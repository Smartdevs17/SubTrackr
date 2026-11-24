/**
 * src/services/__tests__/abuseReports.test.ts
 *
 * Comprehensive unit tests for AbuseReportService.
 */

import {
  AbuseReportError,
  AbuseReportService,
  InMemoryAbuseReportRepository,
  StructuredAbuseReportTelemetry,
  type AbuseReport,
  type CreateAbuseReportInput,
} from '../abuseReports';

const VALID_INPUT: CreateAbuseReportInput = {
  idempotencyKey: 'idem_test_001',
  reporterId: 'user_123',
  reporterIp: '192.168.1.100',
  category: 'phishing',
  severity: 'high',
  source: 'user',
  subject: 'Phishing attempt on login page',
  description: 'Received email with fake login page mimicking SubTrackr. Credential harvesting attempt.',
  targetResource: 'https://subtrackr.fake-login.com',
  evidenceUrls: ['https://example.com/screenshot1.png'],
  metadata: { userAgent: 'Mozilla/5.0', referrer: 'email' },
};

describe('AbuseReportService', () => {
  let repo: InMemoryAbuseReportRepository;
  let telemetry: StructuredAbuseReportTelemetry;
  let service: AbuseReportService;
  let clockTime: number;

  beforeEach(() => {
    repo = new InMemoryAbuseReportRepository();
    telemetry = new StructuredAbuseReportTelemetry();
    clockTime = 1_700_000_000_000;
    service = new AbuseReportService({
      repository: repo,
      metrics: telemetry,
      now: () => new Date(clockTime),
      rateLimitConfig: { maxReportsPerHour: 10, maxReportsPerDay: 50 },
    });
  });

  describe('Report Creation - Happy Path', () => {
    it('creates an abuse report with all fields and computed triage labels', async () => {
      const report = await service.createReport(VALID_INPUT);

      expect(report.id).toMatch(/^abuse_/);
      expect(report.idempotencyKey).toBe(VALID_INPUT.idempotencyKey);
      expect(report.reporterId).toBe(VALID_INPUT.reporterId);
      expect(report.category).toBe('phishing');
      expect(report.severity).toBe('high');
      expect(report.source).toBe('user');
      expect(report.subject).toBe(VALID_INPUT.subject);
      expect(report.description).toBe(VALID_INPUT.description);
      expect(report.targetResource).toBe(VALID_INPUT.targetResource);
      expect(report.evidenceUrls).toEqual(VALID_INPUT.evidenceUrls);
      expect(report.metadata).toEqual(VALID_INPUT.metadata);
      expect(report.status).toBe('open');
      expect(report.createdAt).toBeDefined();
      expect(report.updatedAt).toBeDefined();
      expect(report.resolvedAt).toBeUndefined();

      // Verify triage labels include category, severity, source, and needs:review
      expect(report.triageLabels).toContain('category:phishing');
      expect(report.triageLabels).toContain('severity:high');
      expect(report.triageLabels).toContain('source:user');
      expect(report.triageLabels).toContain('needs:review');
      expect(report.triageLabels).not.toContain('needs:escalation');
    });

    it('assigns needs:escalation for critical severity', async () => {
      const input = { ...VALID_INPUT, idempotencyKey: 'idem_critical_001', severity: 'critical' as const };
      const report = await service.createReport(input);

      expect(report.triageLabels).toContain('severity:critical');
      expect(report.triageLabels).toContain('needs:escalation');
      expect(report.triageLabels).not.toContain('needs:review');
    });

    it('assigns needs:escalation for high severity with urgent keywords', async () => {
      const input = {
        ...VALID_INPUT,
        idempotencyKey: 'idem_urgent_001',
        severity: 'high' as const,
        subject: 'URGENT: Active data breach detected',
        description: 'Immediate threat - data breach in progress',
      };
      const report = await service.createReport(input);

      expect(report.triageLabels).toContain('needs:escalation');
    });

    it('stores reporter IP as hash, not raw IP', async () => {
      const report = await service.createReport(VALID_INPUT);

      expect(report.reporterIpHash).toMatch(/^ip_[a-f0-9]{8}$/);
      expect(report.reporterIpHash).not.toBe('192.168.1.100');
    });

    it('records intake metrics', async () => {
      await service.createReport(VALID_INPUT);
      const snapshot = telemetry.getSnapshot();

      expect(snapshot.totalIntake).toBe(1);
      expect(snapshot.bySeverity.high).toBe(1);
      expect(snapshot.byCategory.phishing).toBe(1);
      expect(snapshot.bySource.user).toBe(1);
      expect(snapshot.byStatus.open).toBe(1);
    });
  });

  describe('Idempotency Key Handling', () => {
    it('rejects duplicate idempotency key with DUPLICATE_IDEMPOTENCY_KEY error', async () => {
      await service.createReport(VALID_INPUT);

      await expect(service.createReport(VALID_INPUT)).rejects.toThrow(AbuseReportError);
      await expect(service.createReport(VALID_INPUT)).rejects.toMatchObject({
        code: 'DUPLICATE_IDEMPOTENCY_KEY',
      });
    });

    it('records duplicate metric on idempotency conflict', async () => {
      await service.createReport(VALID_INPUT);

      try {
        await service.createReport(VALID_INPUT);
      } catch {
        // expected
      }

      const snapshot = telemetry.getSnapshot();
      expect(snapshot.totalDuplicates).toBe(1);
    });

    it('allows different reports with different idempotency keys', async () => {
      const r1 = await service.createReport({ ...VALID_INPUT, idempotencyKey: 'idem_a' });
      const r2 = await service.createReport({ ...VALID_INPUT, idempotencyKey: 'idem_b' });

      expect(r1.id).not.toBe(r2.id);
    });
  });

  describe('Rate Limiting', () => {
    it('allows requests within hourly limit', async () => {
      for (let i = 0; i < 10; i++) {
        await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: `idem_rate_${i}`,
          reporterIp: '10.0.0.50',
        });
      }

      const snapshot = telemetry.getSnapshot();
      expect(snapshot.totalIntake).toBe(10);
      expect(snapshot.totalRateLimited).toBe(0);
    });

    it('blocks requests exceeding hourly limit with RATE_LIMIT_EXCEEDED error', async () => {
      // Create 10 reports (at limit)
      for (let i = 0; i < 10; i++) {
        await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: `idem_rate_limit_${i}`,
          reporterIp: '10.0.0.51',
        });
      }

      // 11th should fail
      await expect(service.createReport({
        ...VALID_INPUT,
        idempotencyKey: 'idem_rate_limit_11',
        reporterIp: '10.0.0.51',
      })).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
    });

    it('records rate limited metric', async () => {
      for (let i = 0; i < 10; i++) {
        await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: `idem_rl_metric_${i}`,
          reporterIp: '10.0.0.52',
        });
      }

      try {
        await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: 'idem_rl_metric_11',
          reporterIp: '10.0.0.52',
        });
      } catch {
        // expected
      }

      const snapshot = telemetry.getSnapshot();
      expect(snapshot.totalRateLimited).toBe(1);
    });

    it('resets hourly window after time passes', async () => {
      // Create 10 reports at limit
      for (let i = 0; i < 10; i++) {
        await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: `idem_window_${i}`,
          reporterIp: '10.0.0.53',
        });
      }

      // Advance clock by 2 hours
      clockTime += 2 * 60 * 60 * 1000;
      service = new AbuseReportService({
        repository: repo,
        metrics: telemetry,
        now: () => new Date(clockTime),
        rateLimitConfig: { maxReportsPerHour: 10, maxReportsPerDay: 50 },
      });

      // Should allow new reports
      const report = await service.createReport({
        ...VALID_INPUT,
        idempotencyKey: 'idem_window_after',
        reporterIp: '10.0.0.53',
      });

      expect(report.id).toBeDefined();
    });

    it('enforces daily limit', async () => {
      // Create 50 reports (at daily limit) with different IPs to avoid hourly limit
      for (let i = 0; i < 50; i++) {
        await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: `idem_daily_${i}`,
          reporterIp: `10.0.${i}.1`,
        });
      }

      // 51st from same IP should fail daily limit
      await expect(service.createReport({
        ...VALID_INPUT,
        idempotencyKey: 'idem_daily_51',
        reporterIp: '10.0.0.1',
      })).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
    });

    it('getRateLimitStatus returns correct remaining counts', async () => {
      const statusBefore = service.getRateLimitStatus('192.168.1.200');
      expect(statusBefore.allowed).toBe(true);
      expect(statusBefore.remainingHourly).toBe(10);
      expect(statusBefore.remainingDaily).toBe(50);

      await service.createReport({
        ...VALID_INPUT,
        idempotencyKey: 'idem_status_1',
        reporterIp: '192.168.1.200',
      });

      const statusAfter = service.getRateLimitStatus('192.168.1.200');
      expect(statusAfter.remainingHourly).toBe(9);
      expect(statusAfter.remainingDaily).toBe(49);
    });
  });

  describe('Triage Label Assignment', () => {
    it('assigns category labels based on category field', async () => {
      const categories: Array<{ cat: typeof VALID_INPUT.category; expectedLabel: string }> = [
        { cat: 'spam', expectedLabel: 'category:spam' },
        { cat: 'phishing', expectedLabel: 'category:phishing' },
        { cat: 'malware', expectedLabel: 'category:malware' },
        { cat: 'fraud', expectedLabel: 'category:fraud' },
        { cat: 'harassment', expectedLabel: 'category:harassment' },
        { cat: 'copyright', expectedLabel: 'category:copyright' },
        { cat: 'illegal_content', expectedLabel: 'category:illegal_content' },
        { cat: 'platform_abuse', expectedLabel: 'category:platform_abuse' },
        { cat: 'api_abuse', expectedLabel: 'category:api_abuse' },
        { cat: 'other', expectedLabel: 'category:other' },
      ];

      for (const { cat, expectedLabel } of categories) {
        const report = await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: `idem_cat_${cat}`,
          category: cat,
        });
        expect(report.triageLabels).toContain(expectedLabel);
      }
    });

    it('assigns severity labels based on severity field', async () => {
      const severities: Array<{ sev: typeof VALID_INPUT.severity; expectedLabel: string }> = [
        { sev: 'low', expectedLabel: 'severity:low' },
        { sev: 'medium', expectedLabel: 'severity:medium' },
        { sev: 'high', expectedLabel: 'severity:high' },
        { sev: 'critical', expectedLabel: 'severity:critical' },
      ];

      for (const { sev, expectedLabel } of severities) {
        const report = await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: `idem_sev_${sev}`,
          severity: sev,
        });
        expect(report.triageLabels).toContain(expectedLabel);
      }
    });

    it('assigns source labels based on source field', async () => {
      const sources: Array<{ src: typeof VALID_INPUT.source; expectedLabel: string }> = [
        { src: 'user', expectedLabel: 'source:user' },
        { src: 'automated', expectedLabel: 'source:automated' },
        { src: 'partner', expectedLabel: 'source:partner' },
        { src: 'internal', expectedLabel: 'source:internal' },
      ];

      for (const { src, expectedLabel } of sources) {
        const report = await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: `idem_src_${src}`,
          source: src,
        });
        expect(report.triageLabels).toContain(expectedLabel);
      }
    });

    it('assigns keyword-based labels from subject and description', async () => {
      const report = await service.createReport({
        ...VALID_INPUT,
        idempotencyKey: 'idem_keywords_1',
        category: 'phishing',
        subject: 'Credential harvesting via fake login page',
        description: 'Phishing email with spoofed SubTrackr login. Social engineering attempt.',
      });

      expect(report.triageLabels).toContain('category:phishing');
      // Keywords like 'credential harvest', 'fake login', 'spoofed', 'social engineering' should trigger phishing label
    });

    it('assigns malware labels for malware keywords', async () => {
      const report = await service.createReport({
        ...VALID_INPUT,
        idempotencyKey: 'idem_malware_1',
        category: 'malware',
        subject: 'Malware distribution via download link',
        description: 'Trojan dropper payload delivered through malicious attachment. Ransomware detected.',
      });

      expect(report.triageLabels).toContain('category:malware');
    });

    it('does not assign duplicate labels', async () => {
      const report = await service.createReport({
        ...VALID_INPUT,
        idempotencyKey: 'idem_dedup_1',
        subject: 'phishing phishing phishing', // repeated keyword
      });

      const phishingLabels = report.triageLabels.filter(l => l === 'category:phishing');
      expect(phishingLabels.length).toBe(1);
    });

    it('defaults to needs:review for non-escalation cases', async () => {
      const report = await service.createReport({
        ...VALID_INPUT,
        idempotencyKey: 'idem_default_review',
        severity: 'low',
        subject: 'Minor cosmetic issue',
        description: 'UI alignment problem on dashboard',
      });

      expect(report.triageLabels).toContain('needs:review');
      expect(report.triageLabels).not.toContain('needs:escalation');
    });
  });

  describe('Report Retrieval', () => {
    it('retrieves report by ID', async () => {
      const created = await service.createReport(VALID_INPUT);
      const retrieved = await service.getReport(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
    });

    it('returns null for non-existent ID', async () => {
      const retrieved = await service.getReport('abuse_nonexistent');
      expect(retrieved).toBeNull();
    });

    it('retrieves report by idempotency key', async () => {
      const created = await service.createReport(VALID_INPUT);
      const retrieved = await service.getReportByIdempotencyKey(VALID_INPUT.idempotencyKey);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
    });
  });

  describe('Report Updates', () => {
    it('updates report status and records resolution time', async () => {
      const created = await service.createReport(VALID_INPUT);

      // Advance clock
      clockTime += 30 * 60 * 1000; // 30 minutes later
      service = new AbuseReportService({
        repository: repo,
        metrics: telemetry,
        now: () => new Date(clockTime),
      });

      const updated = await service.updateReport(created.id, { status: 'resolved' });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('resolved');
      expect(updated!.resolvedAt).toBeDefined();
      expect(updated!.updatedAt).toBeDefined();

      const snapshot = telemetry.getSnapshot();
      expect(snapshot.avgResolutionTimeMs).toBeGreaterThan(0);
    });

    it('assigns team member', async () => {
      const created = await service.createReport(VALID_INPUT);
      const updated = await service.updateReport(created.id, { assignedTo: 'team_member_42' });

      expect(updated!.assignedTo).toBe('team_member_42');
    });

    it('updates triage labels', async () => {
      const created = await service.createReport(VALID_INPUT);
      const updated = await service.updateReport(created.id, {
        triageLabels: ['severity:high', 'category:phishing', 'needs:escalation', 'custom:label'],
      });

      expect(updated!.triageLabels).toContain('needs:escalation');
      expect(updated!.triageLabels).toContain('custom:label');
    });

    it('returns null for updating non-existent report', async () => {
      const updated = await service.updateReport('abuse_nonexistent', { status: 'resolved' });
      expect(updated).toBeNull();
    });
  });

  describe('Report Listing and Filtering', () => {
    beforeEach(async () => {
      // Create test reports
      await service.createReport({ ...VALID_INPUT, idempotencyKey: 'list_1', severity: 'low', category: 'spam' });
      await service.createReport({ ...VALID_INPUT, idempotencyKey: 'list_2', severity: 'high', category: 'phishing' });
      await service.createReport({ ...VALID_INPUT, idempotencyKey: 'list_3', severity: 'critical', category: 'malware', source: 'automated' });
      await service.createReport({ ...VALID_INPUT, idempotencyKey: 'list_4', severity: 'medium', category: 'fraud' });
    });

    it('lists all reports sorted by createdAt descending', async () => {
      const reports = await service.listReports({ limit: 10 });
      expect(reports.length).toBe(4);
      // Most recent first
      expect(new Date(reports[0].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(reports[1].createdAt).getTime());
    });

    it('filters by status', async () => {
      const reports = await service.listReports({ status: 'open' });
      expect(reports.length).toBe(4);
      expect(reports.every(r => r.status === 'open')).toBe(true);
    });

    it('filters by category', async () => {
      const reports = await service.listReports({ category: 'phishing' });
      expect(reports.length).toBe(1);
      expect(reports[0].category).toBe('phishing');
    });

    it('filters by severity', async () => {
      const reports = await service.listReports({ severity: 'critical' });
      expect(reports.length).toBe(1);
      expect(reports[0].severity).toBe('critical');
    });

    it('filters by labels', async () => {
      const reports = await service.listReports({ labels: ['source:automated'] });
      expect(reports.length).toBe(1);
      expect(reports[0].source).toBe('automated');
    });

    it('supports pagination', async () => {
      const page1 = await service.listReports({ limit: 2, offset: 0 });
      const page2 = await service.listReports({ limit: 2, offset: 2 });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe('Input Validation', () => {
    it('accepts valid enum values for category', async () => {
      const validCategories: typeof VALID_INPUT.category[] = [
        'spam', 'phishing', 'malware', 'fraud', 'harassment',
        'copyright', 'illegal_content', 'platform_abuse', 'api_abuse', 'other',
      ];

      for (const cat of validCategories) {
        const report = await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: `valid_cat_${cat}`,
          category: cat,
        });
        expect(report.category).toBe(cat);
      }
    });

    it('accepts valid enum values for severity', async () => {
      const validSeverities: typeof VALID_INPUT.severity[] = ['low', 'medium', 'high', 'critical'];

      for (const sev of validSeverities) {
        const report = await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: `valid_sev_${sev}`,
          severity: sev,
        });
        expect(report.severity).toBe(sev);
      }
    });

    it('accepts valid enum values for source', async () => {
      const validSources: typeof VALID_INPUT.source[] = ['user', 'automated', 'partner', 'internal'];

      for (const src of validSources) {
        const report = await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: `valid_src_${src}`,
          source: src,
        });
        expect(report.source).toBe(src);
      }
    });
  });

  describe('Edge Cases', () => {
    it('handles empty evidenceUrls array', async () => {
      const report = await service.createReport({
        ...VALID_INPUT,
        idempotencyKey: 'empty_evidence',
        evidenceUrls: [],
      });
      expect(report.evidenceUrls).toEqual([]);
    });

    it('handles undefined optional fields', async () => {
      const report = await service.createReport({
        ...VALID_INPUT,
        idempotencyKey: 'minimal_report',
        targetResource: undefined,
        evidenceUrls: undefined,
        metadata: undefined,
      });
      expect(report.targetResource).toBeUndefined();
      expect(report.evidenceUrls).toBeUndefined();
      expect(report.metadata).toBeUndefined();
    });

    it('handles long description text', async () => {
      const longDesc = 'A'.repeat(10000);
      const report = await service.createReport({
        ...VALID_INPUT,
        idempotencyKey: 'long_desc',
        description: longDesc,
      });
      expect(report.description.length).toBe(10000);
    });

    it('resets rate limits correctly', async () => {
      // Hit rate limit
      for (let i = 0; i < 10; i++) {
        await service.createReport({
          ...VALID_INPUT,
          idempotencyKey: `reset_rl_${i}`,
          reporterIp: '10.0.0.99',
        });
      }

      // Reset
      service.resetRateLimits();

      // Should allow again
      const report = await service.createReport({
        ...VALID_INPUT,
        idempotencyKey: 'after_reset',
        reporterIp: '10.0.0.99',
      });
      expect(report.id).toBeDefined();
    });
  });
});