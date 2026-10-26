import { randomBytes } from 'crypto';
import { logger } from '../../shared/logging';
import { eventBus, buildEvent } from '../../shared/events';

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface GeoCoordinate {
  lat?: number | null;
  lon?: number | null;
  country?: string | null;
  city?: string | null;
}

export interface LoginAttempt {
  userId: string;
  ip: string;
  deviceFingerprint: string;
  userAgent: string;
  timestamp: number;
  geo?: GeoCoordinate;
  successful: boolean;
}

export interface LoginAnomalyAlert {
  id: string;
  userId: string;
  severity: AnomalySeverity;
  riskScore: number;
  triggeredHeuristics: string[];
  details: Record<string, unknown>;
  timestamp: string;
  ip: string;
  userAgent: string;
  geo?: GeoCoordinate;
}

export interface LoginAnomalyConfig {
  enabled: boolean;
  riskThreshold: number; // [0, 1], threshold to trigger alert
  maxTravelSpeedKmH: number; // max realistic flight travel velocity
  maxFailedAttempts: number; // threshold for failure burst heuristic
  failedAttemptWindowMs: number; // window to look for rapid failures
  unusualHoursStart: number; // 0-23 (default 1am)
  unusualHoursEnd: number; // 0-23 (default 5am)
  weights: {
    impossibleTravel: number;
    unrecognizedDevice: number;
    failedAttemptsBurst: number;
    rapidIpChange: number;
    unusualHours: number;
  };
}

export const DEFAULT_ANOMALY_CONFIG: LoginAnomalyConfig = {
  enabled: true,
  riskThreshold: 0.5,
  maxTravelSpeedKmH: 800,
  maxFailedAttempts: 3,
  failedAttemptWindowMs: 5 * 60 * 1000, // 5 minutes
  unusualHoursStart: 1, // 01:00
  unusualHoursEnd: 5,   // 05:00
  weights: {
    impossibleTravel: 0.45,
    unrecognizedDevice: 0.25,
    failedAttemptsBurst: 0.25,
    rapidIpChange: 0.15,
    unusualHours: 0.10,
  },
};

/**
 * Calculates Great-Circle distance in kilometers between two lat/lon points using the Haversine formula.
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export type AlertListener = (alert: LoginAnomalyAlert) => void | Promise<void>;

export class LoginAnomalyService {
  private config: LoginAnomalyConfig;
  private userLoginHistory = new Map<string, LoginAttempt[]>();
  private knownDevices = new Map<string, Set<string>>();
  private alerts: LoginAnomalyAlert[] = [];
  private listeners: AlertListener[] = [];

  constructor(customConfig: Partial<LoginAnomalyConfig> = {}) {
    this.config = {
      ...DEFAULT_ANOMALY_CONFIG,
      ...customConfig,
      weights: {
        ...DEFAULT_ANOMALY_CONFIG.weights,
        ...(customConfig.weights ?? {}),
      },
    };
  }

  getConfig(): LoginAnomalyConfig {
    return { ...this.config, weights: { ...this.config.weights } };
  }

  updateConfig(patch: Partial<LoginAnomalyConfig>): LoginAnomalyConfig {
    if (patch.riskThreshold !== undefined && (patch.riskThreshold < 0 || patch.riskThreshold > 1)) {
      throw new Error('riskThreshold must be between 0 and 1');
    }
    if (patch.maxTravelSpeedKmH !== undefined && patch.maxTravelSpeedKmH <= 0) {
      throw new Error('maxTravelSpeedKmH must be greater than 0');
    }

    this.config = {
      ...this.config,
      ...patch,
      weights: {
        ...this.config.weights,
        ...(patch.weights ?? {}),
      },
    };
    return this.getConfig();
  }

  resetConfig(): LoginAnomalyConfig {
    this.config = {
      ...DEFAULT_ANOMALY_CONFIG,
      weights: { ...DEFAULT_ANOMALY_CONFIG.weights },
    };
    return this.getConfig();
  }

  onAlert(listener: AlertListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getAlerts(userId?: string): LoginAnomalyAlert[] {
    if (!userId) return [...this.alerts];
    return this.alerts.filter((a) => a.userId === userId);
  }

  recordFailedLogin(attempt: Omit<LoginAttempt, 'successful'>): void {
    const fullAttempt: LoginAttempt = { ...attempt, successful: false };
    const history = this.userLoginHistory.get(attempt.userId) ?? [];
    history.push(fullAttempt);
    // Keep last 50 entries
    if (history.length > 50) history.shift();
    this.userLoginHistory.set(attempt.userId, history);
  }

  async evaluateLogin(attempt: Omit<LoginAttempt, 'successful'>): Promise<{
    isAnomalous: boolean;
    riskScore: number;
    severity?: AnomalySeverity;
    triggeredHeuristics: string[];
    alert?: LoginAnomalyAlert;
  }> {
    const fullAttempt: LoginAttempt = { ...attempt, successful: true };
    const history = this.userLoginHistory.get(attempt.userId) ?? [];
    const knownDevices = this.knownDevices.get(attempt.userId) ?? new Set<string>();

    if (!this.config.enabled) {
      this.updateUserContext(attempt.userId, fullAttempt, knownDevices);
      return { isAnomalous: false, riskScore: 0, triggeredHeuristics: [] };
    }

    const triggeredHeuristics: string[] = [];
    const heuristicDetails: Record<string, unknown> = {};
    let rawScore = 0;

    // Previous successful login for velocity and IP hopping checks
    const lastSuccess = [...history].reverse().find((a) => a.successful);

    // Heuristic 1: Impossible Travel
    if (
      lastSuccess?.geo?.lat != null &&
      lastSuccess?.geo?.lon != null &&
      fullAttempt.geo?.lat != null &&
      fullAttempt.geo?.lon != null
    ) {
      const distanceKm = calculateHaversineDistanceKm(
        lastSuccess.geo.lat,
        lastSuccess.geo.lon,
        fullAttempt.geo.lat,
        fullAttempt.geo.lon
      );
      const elapsedHours = (fullAttempt.timestamp - lastSuccess.timestamp) / (1000 * 60 * 60);

      if (elapsedHours > 0) {
        const speedKmH = distanceKm / elapsedHours;
        heuristicDetails.travel = { distanceKm, elapsedHours, speedKmH };

        if (speedKmH > this.config.maxTravelSpeedKmH && distanceKm > 100) {
          triggeredHeuristics.push('impossible_travel');
          rawScore += this.config.weights.impossibleTravel;
        }
      }
    }

    // Heuristic 2: Unrecognized Device
    const isKnown = knownDevices.has(fullAttempt.deviceFingerprint);
    if (!isKnown && knownDevices.size > 0) {
      triggeredHeuristics.push('unrecognized_device');
      rawScore += this.config.weights.unrecognizedDevice;
      heuristicDetails.device = { fingerprint: fullAttempt.deviceFingerprint, knownCount: knownDevices.size };
    }

    // Heuristic 3: Rapid Failed Attempts Preceding Success
    const windowStart = fullAttempt.timestamp - this.config.failedAttemptWindowMs;
    const recentFailures = history.filter(
      (a) => !a.successful && a.timestamp >= windowStart && a.timestamp <= fullAttempt.timestamp
    );
    if (recentFailures.length >= this.config.maxFailedAttempts) {
      triggeredHeuristics.push('failed_attempts_burst');
      rawScore += this.config.weights.failedAttemptsBurst;
      heuristicDetails.failures = { count: recentFailures.length, windowMs: this.config.failedAttemptWindowMs };
    }

    // Heuristic 4: Rapid IP Change (< 5 minutes)
    if (lastSuccess && lastSuccess.ip !== fullAttempt.ip) {
      const elapsedSec = (fullAttempt.timestamp - lastSuccess.timestamp) / 1000;
      if (elapsedSec < 300) {
        triggeredHeuristics.push('rapid_ip_change');
        rawScore += this.config.weights.rapidIpChange;
        heuristicDetails.ipChange = { previousIp: lastSuccess.ip, currentIp: fullAttempt.ip, elapsedSec };
      }
    }

    // Heuristic 5: Unusual Hours (UTC or local)
    const loginDate = new Date(fullAttempt.timestamp);
    const loginHour = loginDate.getUTCHours();
    if (loginHour >= this.config.unusualHoursStart && loginHour <= this.config.unusualHoursEnd) {
      triggeredHeuristics.push('unusual_hours');
      rawScore += this.config.weights.unusualHours;
      heuristicDetails.hour = loginHour;
    }

    // Normalize risk score between [0, 1]
    const riskScore = Math.min(1, Math.round(rawScore * 100) / 100);
    const isAnomalous = riskScore >= this.config.riskThreshold || triggeredHeuristics.includes('impossible_travel');

    let alert: LoginAnomalyAlert | undefined;
    let severity: AnomalySeverity | undefined;

    if (isAnomalous) {
      if (riskScore >= 0.8 || triggeredHeuristics.includes('impossible_travel')) {
        severity = 'critical';
      } else if (riskScore >= 0.6) {
        severity = 'high';
      } else if (riskScore >= 0.4) {
        severity = 'medium';
      } else {
        severity = 'low';
      }

      alert = {
        id: `alert_${randomBytes(8).toString('hex')}`,
        userId: attempt.userId,
        severity,
        riskScore,
        triggeredHeuristics,
        details: heuristicDetails,
        timestamp: new Date(attempt.timestamp).toISOString(),
        ip: attempt.ip,
        userAgent: attempt.userAgent,
        geo: attempt.geo,
      };

      this.alerts.push(alert);
      if (this.alerts.length > 500) this.alerts.shift();

      // Emit event to domain EventBus
      try {
        await eventBus.publish(
          buildEvent(
            'security',
            'login_anomaly_alert',
            {
              alertId: alert.id,
              userId: alert.userId,
              severity: alert.severity,
              riskScore: alert.riskScore,
              triggeredHeuristics: alert.triggeredHeuristics,
              ip: alert.ip,
              detectedAt: alert.timestamp,
            },
            { aggregateId: alert.userId, correlationId: alert.id }
          )
        );
      } catch (err) {
        logger.warn('Failed to publish anomaly event', { error: (err as Error).message });
      }

      // Dispatch to registered alert listeners
      for (const listener of this.listeners) {
        try {
          await listener(alert);
        } catch (listenerErr) {
          logger.warn('Alert listener failed', { error: (listenerErr as Error).message });
        }
      }
    }

    // Update historical context
    this.updateUserContext(attempt.userId, fullAttempt, knownDevices);

    return {
      isAnomalous,
      riskScore,
      severity,
      triggeredHeuristics,
      alert,
    };
  }

  private updateUserContext(userId: string, attempt: LoginAttempt, knownDevices: Set<string>): void {
    knownDevices.add(attempt.deviceFingerprint);
    this.knownDevices.set(userId, knownDevices);

    const history = this.userLoginHistory.get(userId) ?? [];
    history.push(attempt);
    if (history.length > 50) history.shift();
    this.userLoginHistory.set(userId, history);
  }
}

export const loginAnomalyService = new LoginAnomalyService();
