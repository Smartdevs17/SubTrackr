import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FraudDetection,
  FraudAlert,
  FraudAnalytics,
  FraudInvestigation,
  FraudRule,
  FraudGeneratedReport,
  FraudCheckRequest,
  FraudCheckResponse,
  FraudIndicator,
  FraudRiskLevel,
  FraudStatus,
  FraudDetectionMethod,
  FraudIndicatorType,
  FraudFilters,
  RealTimeMonitoring,
  DetectionStats,
} from '../types/fraud';

const STORAGE_KEYS = {
  DETECTIONS: '@SubTrackr:fraudDetections',
  ALERTS: '@SubTrackr:fraudAlerts',
  INVESTIGATIONS: '@SubTrackr:fraudInvestigations',
  RULES: '@SubTrackr:fraudRules',
  MONITORING: '@SubTrackr:fraudMonitoring',
} as const;

// Real-time Fraud Detection
export async function performFraudCheck(request: FraudCheckRequest): Promise<FraudCheckResponse> {
  const indicators: FraudIndicator[] = [];
  let riskScore = 0;

  // Check 1: Velocity (rapid transactions)
  const velocityCheck = await checkVelocity(request.userId, request.subscriptionId);
  if (velocityCheck.exceeded) {
    indicators.push({
      type: FraudIndicatorType.RAPID_TRANSACTIONS,
      severity: 'high',
      description: `${velocityCheck.count} transactions in ${velocityCheck.timeWindow} minutes`,
      value: velocityCheck.count,
      threshold: velocityCheck.threshold,
    });
    riskScore += 30;
  }

  // Check 2: Amount anomaly
  const amountCheck = await checkAmountAnomaly(request.userId, request.amount);
  if (amountCheck.isAnomalous) {
    indicators.push({
      type: FraudIndicatorType.UNUSUAL_AMOUNT,
      severity: amountCheck.severity,
      description: `Amount ${request.amount} is ${amountCheck.deviation}x higher than average`,
      value: request.amount,
      threshold: amountCheck.averageAmount,
    });
    riskScore += amountCheck.severity === 'high' ? 25 : 15;
  }

  // Check 3: Location mismatch
  if (request.metadata.location) {
    const loc = typeof request.metadata.location === 'string'
      ? { country: request.metadata.location }
      : request.metadata.location;
    const locationCheck = await checkLocationAnomaly(request.userId, loc);
    if (locationCheck.isSuspicious) {
      indicators.push({
        type: FraudIndicatorType.LOCATION_MISMATCH,
        severity: 'medium',
        description: locationCheck.reason,
        value: typeof request.metadata.location === 'string'
          ? request.metadata.location
          : request.metadata.location.country,
      });
      riskScore += 20;
    }
  }

  // Check 4: Device fingerprint
  if (request.metadata.deviceId) {
    const deviceCheck = await checkDeviceFingerprint(request.userId, request.metadata.deviceId);
    if (deviceCheck.isNew) {
      indicators.push({
        type: FraudIndicatorType.NEW_DEVICE,
        severity: 'low',
        description: 'Transaction from new device',
        value: request.metadata.deviceId,
      });
      riskScore += 10;
    }
  }

  // Check 5: Time-based patterns
  const timeCheck = checkTimePattern(new Date());
  if (timeCheck.isUnusual) {
    indicators.push({
      type: FraudIndicatorType.UNUSUAL_TIME,
      severity: 'low',
      description: timeCheck.reason,
    });
    riskScore += 5;
  }

  // Check 6: IP reputation
  if (request.metadata.ipAddress) {
    const ipCheck = await checkIPReputation(request.metadata.ipAddress);
    if (ipCheck.isSuspicious) {
      indicators.push({
        type: FraudIndicatorType.IP_REPUTATION,
        severity: ipCheck.severity,
        description: ipCheck.reason,
        value: request.metadata.ipAddress,
      });
      riskScore += ipCheck.severity === 'high' ? 35 : 15;
    }
  }

  // Determine risk level
  const riskLevel = calculateRiskLevel(riskScore);
  
  // Create detection record if risky
  let detectionId: string | undefined;
  if (riskScore >= 30) {
    const detection = await createDetection({
      transactionId: request.transactionId,
      subscriptionId: request.subscriptionId,
      userId: request.userId,
      riskScore,
      riskLevel,
      indicators,
      metadata: request.metadata,
    });
    detectionId = detection.id;

    // Create alert for high-risk transactions
    if (riskLevel === 'high' || riskLevel === 'critical') {
      await createAlert(detection);
    }
  }

  // Update monitoring stats
  await updateMonitoringStats();

  const allowed = riskScore < 70; // Block if risk score >= 70

  return {
    allowed,
    riskScore,
    riskLevel,
    indicators,
    recommendation: generateRecommendation(riskScore, indicators),
    detectionId,
  };
}

// Fraud Detection Management
async function createDetection(data: Partial<FraudDetection>): Promise<FraudDetection> {
  const detections = await getAllDetections();
  
  const detection: FraudDetection = {
    id: generateId(),
    transactionId: data.transactionId!,
    subscriptionId: data.subscriptionId!,
    userId: data.userId!,
    timestamp: new Date(),
    riskScore: data.riskScore || 0,
    riskLevel: data.riskLevel || 'low',
    detectionMethod: FraudDetectionMethod.PATTERN_ANALYSIS,
    indicators: data.indicators || [],
    status: FraudStatus.PENDING,
    isBlocked: data.riskScore! >= 70,
    metadata: data.metadata!,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  detections.push(detection);
  await AsyncStorage.setItem(STORAGE_KEYS.DETECTIONS, JSON.stringify(detections));
  
  return detection;
}

export async function updateDetectionStatus(
  id: string,
  status: FraudStatus,
  reviewedBy?: string,
  notes?: string
): Promise<FraudDetection> {
  const detections = await getAllDetections();
  const index = detections.findIndex(d => d.id === id);
  
  if (index === -1) {
    throw new Error(`Detection with id ${id} not found`);
  }

  detections[index] = {
    ...detections[index],
    status,
    reviewedBy,
    reviewedAt: reviewedBy ? new Date() : undefined,
    notes,
    updatedAt: new Date(),
  };

  await AsyncStorage.setItem(STORAGE_KEYS.DETECTIONS, JSON.stringify(detections));
  return detections[index];
}

export async function getAllDetections(filters?: FraudFilters): Promise<FraudDetection[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.DETECTIONS);
    if (!data) return [];
    
    let detections: FraudDetection[] = JSON.parse(data);
    detections = detections.map((d: any) => ({
      ...d,
      timestamp: new Date(d.timestamp),
      createdAt: new Date(d.createdAt),
      updatedAt: new Date(d.updatedAt),
      reviewedAt: d.reviewedAt ? new Date(d.reviewedAt) : undefined,
    }));

    return applyFilters(detections, filters);
  } catch (error) {
    console.error('Failed to load fraud detections:', error);
    return [];
  }
}

export async function getDetectionById(id: string): Promise<FraudDetection | null> {
  const detections = await getAllDetections();
  return detections.find(d => d.id === id) || null;
}

// Fraud Alerts
async function createAlert(detection: FraudDetection): Promise<FraudAlert> {
  const alerts = await getAllAlerts();
  
  const alert: FraudAlert = {
    id: generateId(),
    detectionId: detection.id,
    severity: detection.riskLevel,
    title: `${detection.riskLevel.toUpperCase()} Risk Transaction Detected`,
    message: `Transaction ${detection.transactionId} has been flagged with risk score ${detection.riskScore}`,
    actionRequired: detection.riskLevel === 'critical',
    isRead: false,
    isResolved: false,
    createdAt: new Date(),
  };

  alerts.push(alert);
  await AsyncStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(alerts));
  
  return alert;
}

export async function getAllAlerts(): Promise<FraudAlert[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.ALERTS);
    if (!data) return [];
    
    const alerts: FraudAlert[] = JSON.parse(data);
    return alerts.map((a: any) => ({
      ...a,
      createdAt: new Date(a.createdAt),
      resolvedAt: a.resolvedAt ? new Date(a.resolvedAt) : undefined,
    }));
  } catch (error) {
    console.error('Failed to load fraud alerts:', error);
    return [];
  }
}

export async function markAlertAsRead(id: string): Promise<void> {
  const alerts = await getAllAlerts();
  const index = alerts.findIndex(a => a.id === id);
  
  if (index !== -1) {
    alerts[index].isRead = true;
    await AsyncStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(alerts));
  }
}

export async function resolveAlert(id: string, actionTaken: string): Promise<void> {
  const alerts = await getAllAlerts();
  const index = alerts.findIndex(a => a.id === id);
  
  if (index !== -1) {
    alerts[index].isResolved = true;
    alerts[index].actionTaken = actionTaken;
    alerts[index].resolvedAt = new Date();
    await AsyncStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify(alerts));
  }
}

// Fraud Analytics
export async function getFraudAnalytics(): Promise<FraudAnalytics> {
  const detections = await getAllDetections();
  
  const totalDetections = detections.length;
  const blockedTransactions = detections.filter(d => d.isBlocked).length;
  const confirmedFraud = detections.filter(d => d.status === FraudStatus.CONFIRMED).length;
  const falsePositives = detections.filter(d => d.status === FraudStatus.FALSE_POSITIVE).length;
  
  const averageRiskScore = totalDetections > 0
    ? detections.reduce((sum, d) => sum + d.riskScore, 0) / totalDetections
    : 0;

  // Detections by level
  const detectionsByLevel: Record<FraudRiskLevel, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  detections.forEach(d => detectionsByLevel[d.riskLevel]++);

  // Detections by method
  const detectionsByMethod: Record<FraudDetectionMethod, number> = {
    velocity_check: 0,
    pattern_analysis: 0,
    geolocation: 0,
    device_fingerprint: 0,
    amount_anomaly: 0,
    behavioral: 0,
    network_analysis: 0,
    ml_model: 0,
  };
  detections.forEach(d => detectionsByMethod[d.detectionMethod]++);

  // Indicator breakdown
  const indicatorBreakdown: Record<FraudIndicatorType, number> = {
    rapid_transactions: 0,
    unusual_amount: 0,
    location_mismatch: 0,
    new_device: 0,
    suspicious_pattern: 0,
    multiple_failed_attempts: 0,
    velocity_exceeded: 0,
    blacklisted: 0,
    unusual_time: 0,
    ip_reputation: 0,
  };
  detections.forEach(d => {
    d.indicators.forEach(ind => indicatorBreakdown[ind.type]++);
  });

  // Calculate prevented loss (mock calculation)
  const preventedLoss = detections
    .filter(d => d.isBlocked && d.status !== FraudStatus.FALSE_POSITIVE)
    .reduce((sum, d) => sum + (d.metadata.transactionAmount || 0), 0);

  // Detection and false positive rates
  const detectionRate = totalDetections > 0 
    ? (confirmedFraud / totalDetections) * 100 
    : 0;
  const falsePositiveRate = totalDetections > 0 
    ? (falsePositives / totalDetections) * 100 
    : 0;

  // Time series data (last 30 days)
  const timeSeriesData = generateTimeSeriesData(detections, 30);

  // Top risk users
  const userRiskMap = new Map<string, { riskScore: number; count: number }>();
  detections.forEach(d => {
    const existing = userRiskMap.get(d.userId) || { riskScore: 0, count: 0 };
    userRiskMap.set(d.userId, {
      riskScore: Math.max(existing.riskScore, d.riskScore),
      count: existing.count + 1,
    });
  });

  const topRiskUsers = Array.from(userRiskMap.entries())
    .map(([userId, data]) => ({
      userId,
      riskScore: data.riskScore,
      detectionCount: data.count,
    }))
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10);

  return {
    totalDetections,
    blockedTransactions,
    confirmedFraud,
    falsePositives,
    averageRiskScore,
    detectionsByLevel,
    detectionsByMethod,
    indicatorBreakdown,
    preventedLoss,
    detectionRate,
    falsePositiveRate,
    timeSeriesData,
    topRiskUsers,
  };
}

// Fraud Investigation
export async function createInvestigation(
  detectionId: string,
  investigator: string,
  priority: 'low' | 'medium' | 'high' | 'urgent'
): Promise<FraudInvestigation> {
  const investigations = await getAllInvestigations();
  
  const investigation: FraudInvestigation = {
    id: generateId(),
    detectionId,
    investigator,
    status: 'open',
    priority,
    findings: '',
    evidence: [],
    recommendation: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  investigations.push(investigation);
  await AsyncStorage.setItem(STORAGE_KEYS.INVESTIGATIONS, JSON.stringify(investigations));
  
  return investigation;
}

export async function updateInvestigation(
  id: string,
  updates: Partial<FraudInvestigation>
): Promise<FraudInvestigation> {
  const investigations = await getAllInvestigations();
  const index = investigations.findIndex(i => i.id === id);
  
  if (index === -1) {
    throw new Error(`Investigation with id ${id} not found`);
  }

  investigations[index] = {
    ...investigations[index],
    ...updates,
    updatedAt: new Date(),
    closedAt: updates.status === 'closed' ? new Date() : investigations[index].closedAt,
  };

  await AsyncStorage.setItem(STORAGE_KEYS.INVESTIGATIONS, JSON.stringify(investigations));
  return investigations[index];
}

export async function getAllInvestigations(): Promise<FraudInvestigation[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.INVESTIGATIONS);
    if (!data) return [];
    
    const investigations: FraudInvestigation[] = JSON.parse(data);
    return investigations.map((i: any) => ({
      ...i,
      createdAt: new Date(i.createdAt),
      updatedAt: new Date(i.updatedAt),
      closedAt: i.closedAt ? new Date(i.closedAt) : undefined,
    }));
  } catch (error) {
    console.error('Failed to load investigations:', error);
    return [];
  }
}

// Fraud Reporting
export async function generateFraudReport(
  reportType: 'daily' | 'weekly' | 'monthly' | 'custom',
  period: { start: Date; end: Date }
): Promise<FraudGeneratedReport> {
  const analytics = await getFraudAnalytics();
  const detections = await getAllDetections({
    dateFrom: period.start,
    dateTo: period.end,
  });

  const totalDetections = detections.length;
  const blockedAmount = detections
    .filter(d => d.isBlocked)
    .reduce((sum, d) => sum + (d.metadata.transactionAmount || 0), 0);
  const confirmedCases = detections.filter(d => d.status === FraudStatus.CONFIRMED).length;
  const averageRiskScore = totalDetections > 0
    ? detections.reduce((sum, d) => sum + d.riskScore, 0) / totalDetections
    : 0;

  // Calculate trends
  const prevPeriod = calculatePreviousPeriod(period, reportType);
  const prevDetections = await getAllDetections({
    dateFrom: prevPeriod.start,
    dateTo: prevPeriod.end,
  });

  const detectionTrend = totalDetections > prevDetections.length 
    ? 'increasing' 
    : totalDetections < prevDetections.length 
    ? 'decreasing' 
    : 'stable';

  const prevAvgRisk = prevDetections.length > 0
    ? prevDetections.reduce((sum, d) => sum + d.riskScore, 0) / prevDetections.length
    : 0;
  const riskTrend = averageRiskScore > prevAvgRisk 
    ? 'increasing' 
    : averageRiskScore < prevAvgRisk 
    ? 'decreasing' 
    : 'stable';

  const recommendations = generateReportRecommendations(analytics, detectionTrend, riskTrend);

  return {
    id: generateId(),
    reportType,
    period,
    summary: {
      totalDetections,
      blockedAmount,
      confirmedCases,
      averageRiskScore,
    },
    details: analytics,
    trends: {
      detectionTrend,
      riskTrend,
    },
    recommendations,
    generatedAt: new Date(),
  };
}

// Real-time Monitoring
export async function getMonitoringStatus(): Promise<RealTimeMonitoring> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.MONITORING);
    if (!data) {
      return {
        isActive: true,
        transactionsMonitored: 0,
        activeDetections: 0,
        lastCheckTimestamp: new Date(),
        systemHealth: 'healthy',
        averageResponseTime: 0,
      };
    }
    
    const monitoring: RealTimeMonitoring = JSON.parse(data);
    return {
      ...monitoring,
      lastCheckTimestamp: monitoring.lastCheckTimestamp ? new Date(monitoring.lastCheckTimestamp) : undefined,
    };
  } catch (error) {
    console.error('Failed to load monitoring status:', error);
    throw error;
  }
}

async function updateMonitoringStats(): Promise<void> {
  const monitoring = await getMonitoringStatus();
  const detections = await getAllDetections();
  
  monitoring.transactionsMonitored = (monitoring.transactionsMonitored ?? 0) + 1;
  monitoring.activeDetections = detections.filter(d => d.status === FraudStatus.PENDING).length;
  monitoring.lastCheckTimestamp = new Date();
  
  await AsyncStorage.setItem(STORAGE_KEYS.MONITORING, JSON.stringify(monitoring));
}

// Helper Functions
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function checkVelocity(
  userId: string,
  subscriptionId: string
): Promise<{ exceeded: boolean; count: number; timeWindow: number; threshold: number }> {
  const detections = await getAllDetections();
  const timeWindow = 60; // minutes
  const threshold = 5; // max transactions
  const cutoff = new Date(Date.now() - timeWindow * 60 * 1000);
  
  const recentTransactions = detections.filter(
    d => d.userId === userId && d.subscriptionId === subscriptionId && d.timestamp >= cutoff
  );

  return {
    exceeded: recentTransactions.length >= threshold,
    count: recentTransactions.length,
    timeWindow,
    threshold,
  };
}

async function checkAmountAnomaly(
  userId: string,
  amount: number
): Promise<{ isAnomalous: boolean; severity: 'low' | 'medium' | 'high'; deviation: number; averageAmount: number }> {
  const detections = await getAllDetections({ userId });
  
  if (detections.length < 3) {
    return { isAnomalous: false, severity: 'low', deviation: 1, averageAmount: amount };
  }

  const amounts = detections
    .map(d => d.metadata.transactionAmount || 0)
    .filter(a => a > 0);
  
  const averageAmount = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
  const deviation = amount / averageAmount;

  return {
    isAnomalous: deviation > 3,
    severity: deviation > 5 ? 'high' : deviation > 3 ? 'medium' : 'low',
    deviation,
    averageAmount,
  };
}

async function checkLocationAnomaly(
  userId: string,
  location: { country: string; city?: string }
): Promise<{ isSuspicious: boolean; reason: string }> {
  const detections = await getAllDetections({ userId });
  
  if (detections.length === 0) {
    return { isSuspicious: false, reason: '' };
  }

  const rawLocation = detections[detections.length - 1].metadata.location;
  if (!rawLocation) {
    return { isSuspicious: false, reason: '' };
  }

  const recentCountry = typeof rawLocation === 'string' ? rawLocation : rawLocation.country;

  if (recentCountry !== location.country) {
    const timeDiff = Date.now() - detections[detections.length - 1].timestamp.getTime();
    const hoursDiff = timeDiff / (1000 * 60 * 60);
    
    if (hoursDiff < 2) {
      return {
        isSuspicious: true,
        reason: `Location changed from ${recentCountry} to ${location.country} in ${hoursDiff.toFixed(1)} hours`,
      };
    }
  }

  return { isSuspicious: false, reason: '' };
}

async function checkDeviceFingerprint(
  userId: string,
  deviceId: string
): Promise<{ isNew: boolean }> {
  const detections = await getAllDetections({ userId });
  const knownDevices = new Set(detections.map(d => d.metadata.deviceId).filter(Boolean));
  
  return { isNew: !knownDevices.has(deviceId) };
}

function checkTimePattern(timestamp: Date): { isUnusual: boolean; reason: string } {
  const hour = timestamp.getHours();
  
  // Flag transactions between 2 AM and 5 AM
  if (hour >= 2 && hour < 5) {
    return {
      isUnusual: true,
      reason: 'Transaction during unusual hours (2 AM - 5 AM)',
    };
  }

  return { isUnusual: false, reason: '' };
}

async function checkIPReputation(
  ipAddress: string
): Promise<{ isSuspicious: boolean; severity: 'low' | 'medium' | 'high'; reason: string }> {
  // Mock IP reputation check
  // In production, integrate with IP reputation services
  const suspiciousIPs = ['192.168.1.100', '10.0.0.1']; // Mock blacklist
  
  if (suspiciousIPs.includes(ipAddress)) {
    return {
      isSuspicious: true,
      severity: 'high',
      reason: 'IP address is on blacklist',
    };
  }

  return { isSuspicious: false, severity: 'low', reason: '' };
}

function calculateRiskLevel(riskScore: number): FraudRiskLevel {
  if (riskScore >= 70) return 'critical';
  if (riskScore >= 50) return 'high';
  if (riskScore >= 30) return 'medium';
  return 'low';
}

function generateRecommendation(riskScore: number, indicators: FraudIndicator[]): string {
  if (riskScore >= 70) {
    return 'BLOCK: High-risk transaction. Manual review required before processing.';
  }
  if (riskScore >= 50) {
    return 'REVIEW: Elevated risk detected. Recommend additional verification.';
  }
  if (riskScore >= 30) {
    return 'MONITOR: Moderate risk. Continue monitoring for patterns.';
  }
  return 'ALLOW: Low risk. Transaction appears normal.';
}

function applyFilters(detections: FraudDetection[], filters?: FraudFilters): FraudDetection[] {
  if (!filters) return detections;

  return detections.filter(d => {
    if (filters.riskLevel && !filters.riskLevel.includes(d.riskLevel)) return false;
    if (filters.status && !filters.status.includes(d.status)) return false;
    if (filters.dateFrom && d.timestamp < filters.dateFrom) return false;
    if (filters.dateTo && d.timestamp > filters.dateTo) return false;
    if (filters.subscriptionId && d.subscriptionId !== filters.subscriptionId) return false;
    if (filters.userId && d.userId !== filters.userId) return false;
    if (filters.minRiskScore && d.riskScore < filters.minRiskScore) return false;
    if (filters.maxRiskScore && d.riskScore > filters.maxRiskScore) return false;
    return true;
  });
}

function generateTimeSeriesData(
  detections: FraudDetection[],
  days: number
): Array<{ date: string; detections: number; blocked: number; confirmed: number }> {
  const data: Array<{ date: string; detections: number; blocked: number; confirmed: number }> = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const dayDetections = detections.filter(d => {
      const dStr = d.timestamp.toISOString().split('T')[0];
      return dStr === dateStr;
    });

    data.push({
      date: dateStr,
      detections: dayDetections.length,
      blocked: dayDetections.filter(d => d.isBlocked).length,
      confirmed: dayDetections.filter(d => d.status === FraudStatus.CONFIRMED).length,
    });
  }

  return data;
}

function calculatePreviousPeriod(
  period: { start: Date; end: Date },
  reportType: string
): { start: Date; end: Date } {
  const duration = period.end.getTime() - period.start.getTime();
  
  return {
    start: new Date(period.start.getTime() - duration),
    end: new Date(period.start.getTime()),
  };
}

function generateReportRecommendations(
  analytics: FraudAnalytics,
  detectionTrend: string,
  riskTrend: string
): string[] {
  const recommendations: string[] = [];

  if (detectionTrend === 'increasing') {
    recommendations.push('Fraud detections are increasing. Review and strengthen fraud rules.');
  }

  if (riskTrend === 'increasing') {
    recommendations.push('Average risk score is rising. Consider implementing additional verification steps.');
  }

  if (analytics.falsePositiveRate && analytics.falsePositiveRate > 20) {
    recommendations.push(`False positive rate is ${analytics.falsePositiveRate.toFixed(1)}%. Review and adjust fraud detection thresholds.`);
  }

  if (analytics.preventedLoss && analytics.preventedLoss > 1000) {
    recommendations.push(`Successfully prevented $${analytics.preventedLoss.toFixed(2)} in potential fraud.`);
  }

  if (recommendations.length === 0) {
    recommendations.push('Fraud detection system is operating normally. Continue monitoring.');
  }

  return recommendations;
}

// ── Synchronous service singleton ──────────────────────────────────────────────
// Provides a lightweight synchronous facade for hooks that need immediate values.

class FraudDetectionService {
  private stats: DetectionStats = {
    total: 0,
    blocked: 0,
    flagged: 0,
    approved: 0,
    avgRiskScore: 0,
  };

  getDetectionStats(): DetectionStats {
    return { ...this.stats };
  }

  updateStats(partial: Partial<DetectionStats>): void {
    this.stats = { ...this.stats, ...partial };
  }
}

export const fraudDetectionService = new FraudDetectionService();

// ── Prevention recommendation type ─────────────────────────────────────────────

export interface PreventionRecommendation {
  id: string;
  category: 'velocity' | 'geo' | 'device' | 'chargeback' | 'account' | 'monitoring';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impactScore: number;
  effort: 'low' | 'medium' | 'high';
}

// Re-export DetectionStats so callers can import it from this module
export type { DetectionStats };
