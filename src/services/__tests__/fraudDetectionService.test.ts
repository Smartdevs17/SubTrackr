import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fraudService from '../fraudDetectionService';
import { FraudStatus } from '../../types/fraud';
import type { FraudCheckRequest } from '../../types/fraud';

jest.mock('@react-native-async-storage/async-storage');

describe('fraudDetectionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  describe('Fraud Detection', () => {
    const mockRequest: FraudCheckRequest = {
      transactionId: 'txn-123',
      subscriptionId: 'sub-123',
      userId: 'user-123',
      amount: 99.99,
      currency: 'USD',
      paymentMethod: 'credit_card',
      metadata: {
        ipAddress: '192.168.1.1',
        deviceId: 'device-123',
        userAgent: 'Mozilla/5.0',
        location: {
          country: 'US',
          city: 'New York',
        },
        transactionAmount: 99.99,
      },
    };

    it('should perform fraud check and return low risk for normal transaction', async () => {
      const response = await fraudService.performFraudCheck(mockRequest);

      expect(response).toBeDefined();
      expect(response.riskScore).toBeLessThan(30);
      expect(response.riskLevel).toBe('low');
      expect(response.allowed).toBe(true);
      expect(response.indicators).toBeDefined();
    });

    it('should detect velocity fraud', async () => {
      // Create multiple rapid transactions
      for (let i = 0; i < 5; i++) {
        await fraudService.performFraudCheck({
          ...mockRequest,
          transactionId: `txn-${i}`,
        });
      }

      // 6th transaction should trigger velocity check
      const response = await fraudService.performFraudCheck({
        ...mockRequest,
        transactionId: 'txn-6',
      });

      expect(response.riskScore).toBeGreaterThan(30);
      expect(response.indicators.some(i => i.type === 'rapid_transactions')).toBe(true);
    });

    it('should detect amount anomaly', async () => {
      // Create baseline transactions
      for (let i = 0; i < 3; i++) {
        await fraudService.performFraudCheck({
          ...mockRequest,
          amount: 10,
          transactionId: `txn-baseline-${i}`,
        });
      }

      // Transaction with unusually high amount
      const response = await fraudService.performFraudCheck({
        ...mockRequest,
        amount: 500, // 50x higher than baseline
        transactionId: 'txn-anomaly',
      });

      expect(response.indicators.some(i => i.type === 'unusual_amount')).toBe(true);
      expect(response.riskScore).toBeGreaterThan(0);
    });

    it('should detect unusual time patterns', async () => {
      const lateNightRequest = {
        ...mockRequest,
        transactionId: 'txn-late',
      };

      // Mock time to be 3 AM
      const mockDate = new Date('2026-07-26T03:00:00Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);

      const response = await fraudService.performFraudCheck(lateNightRequest);

      expect(response.indicators.some(i => i.type === 'unusual_time')).toBe(true);

      jest.restoreAllMocks();
    });

    it('should block high-risk transactions', async () => {
      const highRiskRequest = {
        ...mockRequest,
        metadata: {
          ...mockRequest.metadata,
          ipAddress: '192.168.1.100', // Blacklisted IP
        },
      };

      // Create velocity
      for (let i = 0; i < 6; i++) {
        await fraudService.performFraudCheck({
          ...highRiskRequest,
          transactionId: `txn-rapid-${i}`,
        });
      }

      const response = await fraudService.performFraudCheck({
        ...highRiskRequest,
        transactionId: 'txn-final',
        amount: 1000,
      });

      expect(response.riskScore).toBeGreaterThanOrEqual(70);
      expect(response.allowed).toBe(false);
      expect(response.detectionId).toBeDefined();
    });

    it('should create detection record for risky transactions', async () => {
      const request = {
        ...mockRequest,
        metadata: {
          ...mockRequest.metadata,
          ipAddress: '192.168.1.100',
        },
      };

      const response = await fraudService.performFraudCheck(request);

      if (response.riskScore >= 30) {
        expect(response.detectionId).toBeDefined();
        
        const detection = await fraudService.getDetectionById(response.detectionId!);
        expect(detection).toBeDefined();
        expect(detection?.riskScore).toBe(response.riskScore);
      }
    });
  });

  describe('Detection Management', () => {
    it('should update detection status', async () => {
      const request: FraudCheckRequest = {
        transactionId: 'txn-123',
        subscriptionId: 'sub-123',
        userId: 'user-123',
        amount: 500,
        currency: 'USD',
        paymentMethod: 'credit_card',
        metadata: {
          ipAddress: '192.168.1.100',
          transactionAmount: 500,
        },
      };

      const response = await fraudService.performFraudCheck(request);
      
      if (response.detectionId) {
        const updated = await fraudService.updateDetectionStatus(
          response.detectionId,
          FraudStatus.CONFIRMED,
          'admin',
          'Verified fraud case'
        );

        expect(updated.status).toBe(FraudStatus.CONFIRMED);
        expect(updated.reviewedBy).toBe('admin');
        expect(updated.notes).toBe('Verified fraud case');
        expect(updated.reviewedAt).toBeDefined();
      }
    });

    it('should get all detections', async () => {
      const detections = await fraudService.getAllDetections();
      expect(Array.isArray(detections)).toBe(true);
    });

    it('should filter detections by risk level', async () => {
      const detections = await fraudService.getAllDetections({
        riskLevel: ['high', 'critical'],
      });

      detections.forEach(d => {
        expect(['high', 'critical']).toContain(d.riskLevel);
      });
    });

    it('should filter detections by date range', async () => {
      const dateFrom = new Date('2026-07-01');
      const dateTo = new Date('2026-07-31');

      const detections = await fraudService.getAllDetections({
        dateFrom,
        dateTo,
      });

      detections.forEach(d => {
        expect(d.timestamp >= dateFrom).toBe(true);
        expect(d.timestamp <= dateTo).toBe(true);
      });
    });
  });

  describe('Fraud Alerts', () => {
    it('should get all alerts', async () => {
      const alerts = await fraudService.getAllAlerts();
      expect(Array.isArray(alerts)).toBe(true);
    });

    it('should mark alert as read', async () => {
      const alerts = await fraudService.getAllAlerts();
      
      if (alerts.length > 0) {
        await fraudService.markAlertAsRead(alerts[0].id);
        const updated = await fraudService.getAllAlerts();
        const alert = updated.find(a => a.id === alerts[0].id);
        expect(alert?.isRead).toBe(true);
      }
    });

    it('should resolve alert', async () => {
      const alerts = await fraudService.getAllAlerts();
      
      if (alerts.length > 0) {
        await fraudService.resolveAlert(alerts[0].id, 'Investigated and resolved');
        const updated = await fraudService.getAllAlerts();
        const alert = updated.find(a => a.id === alerts[0].id);
        expect(alert?.isResolved).toBe(true);
        expect(alert?.actionTaken).toBe('Investigated and resolved');
      }
    });
  });

  describe('Fraud Analytics', () => {
    it('should calculate fraud analytics', async () => {
      const analytics = await fraudService.getFraudAnalytics();

      expect(analytics).toBeDefined();
      expect(analytics.totalDetections).toBeGreaterThanOrEqual(0);
      expect(analytics.detectionsByLevel).toBeDefined();
      expect(analytics.detectionsByMethod).toBeDefined();
      expect(analytics.indicatorBreakdown).toBeDefined();
      expect(analytics.timeSeriesData).toBeDefined();
      expect(Array.isArray(analytics.topRiskUsers)).toBe(true);
    });

    it('should calculate detection rate', async () => {
      const analytics = await fraudService.getFraudAnalytics();
      expect(analytics.detectionRate).toBeGreaterThanOrEqual(0);
      expect(analytics.detectionRate).toBeLessThanOrEqual(100);
    });

    it('should calculate false positive rate', async () => {
      const analytics = await fraudService.getFraudAnalytics();
      expect(analytics.falsePositiveRate).toBeGreaterThanOrEqual(0);
      expect(analytics.falsePositiveRate).toBeLessThanOrEqual(100);
    });

    it('should calculate prevented loss', async () => {
      const analytics = await fraudService.getFraudAnalytics();
      expect(analytics.preventedLoss).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Fraud Investigation', () => {
    it('should create investigation', async () => {
      const investigation = await fraudService.createInvestigation(
        'detection-123',
        'investigator@example.com',
        'high'
      );

      expect(investigation).toBeDefined();
      expect(investigation.id).toBeDefined();
      expect(investigation.detectionId).toBe('detection-123');
      expect(investigation.investigator).toBe('investigator@example.com');
      expect(investigation.priority).toBe('high');
      expect(investigation.status).toBe('open');
    });

    it('should update investigation', async () => {
      const investigation = await fraudService.createInvestigation(
        'detection-123',
        'investigator@example.com',
        'medium'
      );

      const updated = await fraudService.updateInvestigation(investigation.id, {
        status: 'in_progress',
        findings: 'Suspicious activity confirmed',
      });

      expect(updated.status).toBe('in_progress');
      expect(updated.findings).toBe('Suspicious activity confirmed');
      expect(updated.updatedAt).toBeInstanceOf(Date);
    });

    it('should close investigation', async () => {
      const investigation = await fraudService.createInvestigation(
        'detection-123',
        'investigator@example.com',
        'low'
      );

      const closed = await fraudService.updateInvestigation(investigation.id, {
        status: 'closed',
        recommendation: 'No fraud detected',
      });

      expect(closed.status).toBe('closed');
      expect(closed.closedAt).toBeDefined();
    });
  });

  describe('Fraud Reporting', () => {
    it('should generate fraud report', async () => {
      const period = {
        start: new Date('2026-07-01'),
        end: new Date('2026-07-31'),
      };

      const report = await fraudService.generateFraudReport('monthly', period);

      expect(report).toBeDefined();
      expect(report.reportType).toBe('monthly');
      expect(report.period).toEqual(period);
      expect(report.summary).toBeDefined();
      expect(report.details).toBeDefined();
      expect(report.trends).toBeDefined();
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('should include report summary', async () => {
      const period = {
        start: new Date('2026-07-01'),
        end: new Date('2026-07-31'),
      };

      const report = await fraudService.generateFraudReport('monthly', period);

      expect(report.summary.totalDetections).toBeGreaterThanOrEqual(0);
      expect(report.summary.blockedAmount).toBeGreaterThanOrEqual(0);
      expect(report.summary.confirmedCases).toBeGreaterThanOrEqual(0);
      expect(report.summary.averageRiskScore).toBeGreaterThanOrEqual(0);
    });

    it('should include trends', async () => {
      const period = {
        start: new Date('2026-07-01'),
        end: new Date('2026-07-31'),
      };

      const report = await fraudService.generateFraudReport('monthly', period);

      expect(['increasing', 'decreasing', 'stable']).toContain(report.trends.detectionTrend);
      expect(['increasing', 'decreasing', 'stable']).toContain(report.trends.riskTrend);
    });
  });

  describe('Real-time Monitoring', () => {
    it('should get monitoring status', async () => {
      const monitoring = await fraudService.getMonitoringStatus();

      expect(monitoring).toBeDefined();
      expect(monitoring.isActive).toBeDefined();
      expect(monitoring.transactionsMonitored).toBeGreaterThanOrEqual(0);
      expect(monitoring.lastCheckTimestamp).toBeInstanceOf(Date);
      expect(['healthy', 'degraded', 'offline']).toContain(monitoring.systemHealth);
    });
  });
});
