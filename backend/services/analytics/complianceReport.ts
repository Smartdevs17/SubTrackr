import { getPiiFields, maskField, type Environment } from './encryption';
import { keyManager } from './keyManager';
import { piiAuditService } from './piiAudit';

export interface ComplianceReport {
  generatedAt: number;
  environment: Environment;
  encryptionStatus: EncryptionStatus;
  keyManagement: KeyManagementStatus;
  piiAccessSummary: PiiAccessSummary;
  dataMasking: DataMaskingStatus;
  overallComplianceScore: number;
  recommendations: string[];
}

export interface EncryptionStatus {
  algorithm: string;
  keyLength: number;
  piiFieldsProtected: string[];
  totalPiiFields: number;
  encryptionRate: number;
  fieldsEncrypted: number;
  isEncryptionActive: boolean;
}

export interface KeyManagementStatus {
  lastRotation: number;
  nextRotation: number;
  rotationIntervalDays: number;
  activeKeyCount: number;
  isRotationDue: boolean;
  keysExpiringWithin30Days: number;
}

export interface PiiAccessSummary {
  totalAccesses: number;
  accessesToday: number;
  accessesThisWeek: number;
  accessesThisMonth: number;
  byAction: Record<string, number>;
  uniqueActors: number;
}

export interface DataMaskingStatus {
  isEnabled: boolean;
  environment: Environment;
  maskedFields: string[];
}

function getEnv(): Environment {
  return (process.env['APP_ENV'] as Environment | undefined) ?? 'development';
}

export function generateComplianceReport(): ComplianceReport {
  const env = getEnv();
  const now = Date.now();
  const rotationInfo = keyManager.getRotationInfo();
  const accessSummary = piiAuditService.getPiiAccessSummary();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayAccesses = piiAuditService.getPiiAccessSummary(todayStart.getTime(), now);

  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

  const piiFields = getPiiFields();

  const encryptionStatus: EncryptionStatus = {
    algorithm: 'aes-256-gcm',
    keyLength: 256,
    piiFieldsProtected: piiFields,
    totalPiiFields: piiFields.length,
    encryptionRate: rotationInfo.activeKeys > 0 ? 1.0 : 0.0,
    fieldsEncrypted: rotationInfo.activeKeys > 0 ? piiFields.length : 0,
    isEncryptionActive: rotationInfo.activeKeys > 0,
  };

  const keyStatus: KeyManagementStatus = {
    lastRotation: rotationInfo.lastRotation,
    nextRotation: rotationInfo.nextRotation,
    rotationIntervalDays: rotationInfo.intervalDays,
    activeKeyCount: rotationInfo.activeKeys,
    isRotationDue: rotationInfo.isDue,
    keysExpiringWithin30Days: 0,
  };

  const piiSummary: PiiAccessSummary = {
    totalAccesses: accessSummary.totalAccesses,
    accessesToday: todayAccesses.totalAccesses,
    accessesThisWeek: piiAuditService.getPiiAccessSummary(weekAgo, now).totalAccesses,
    accessesThisMonth: piiAuditService.getPiiAccessSummary(monthAgo, now).totalAccesses,
    byAction: accessSummary.byAction,
    uniqueActors: accessSummary.uniqueActors,
  };

  const maskingStatus: DataMaskingStatus = {
    isEnabled: env !== 'production',
    environment: env,
    maskedFields: env !== 'production' ? piiFields : [],
  };

  const recommendations: string[] = [];
  let score = 100;

  if (encryptionStatus.encryptionRate < 1.0) {
    score -= 40;
    recommendations.push('CRITICAL: Encryption is not active - PII fields are at risk');
  }

  if (keyStatus.isRotationDue) {
    score -= 15;
    recommendations.push('Key rotation is overdue - rotate encryption keys immediately');
  }

  if (keyStatus.activeKeyCount === 0) {
    score -= 25;
    recommendations.push('No active encryption keys found - initialize KeyManager');
  }

  if (!maskingStatus.isEnabled && env === 'development') {
    score -= 5;
    recommendations.push(
      'Data masking is disabled in development - enable masking for non-prod environments'
    );
  }

  if (piiSummary.accessesThisWeek > 0 && piiSummary.byAction['pii.exported'] > 0) {
    recommendations.push(
      'PII exports detected this week - verify data handling agreement compliance'
    );
  }

  return {
    generatedAt: now,
    environment: env,
    encryptionStatus,
    keyManagement: keyStatus,
    piiAccessSummary: piiSummary,
    dataMasking: maskingStatus,
    overallComplianceScore: Math.max(0, score),
    recommendations,
  };
}

export function formatComplianceReport(report: ComplianceReport): string {
  const lines: string[] = [
    '='.repeat(60),
    'PII COMPLIANCE REPORT',
    '='.repeat(60),
    `Generated: ${new Date(report.generatedAt).toISOString()}`,
    `Environment: ${report.environment}`,
    `Overall Score: ${report.overallComplianceScore}/100`,
    '',
    '--- ENCRYPTION STATUS ---',
    `Algorithm: ${report.encryptionStatus.algorithm}`,
    `Key Length: ${report.encryptionStatus.keyLength}-bit`,
    `Status: ${report.encryptionStatus.isEncryptionActive ? 'ACTIVE' : 'INACTIVE'}`,
    `Protected Fields (${report.encryptionStatus.fieldsEncrypted}/${report.encryptionStatus.totalPiiFields}):`,
    ...report.encryptionStatus.piiFieldsProtected.map((f) => `  - ${f}`),
    `Encryption Rate: ${(report.encryptionStatus.encryptionRate * 100).toFixed(0)}%`,
    '',
    '--- KEY MANAGEMENT ---',
    `Last Rotation: ${new Date(report.keyManagement.lastRotation).toISOString()}`,
    `Next Rotation: ${new Date(report.keyManagement.nextRotation).toISOString()}`,
    `Rotation Interval: ${report.keyManagement.rotationIntervalDays} days`,
    `Active Keys: ${report.keyManagement.activeKeyCount}`,
    `Rotation Due: ${report.keyManagement.isRotationDue ? 'YES' : 'No'}`,
    '',
    '--- PII ACCESS SUMMARY ---',
    `Total Accesses: ${report.piiAccessSummary.totalAccesses}`,
    `Today: ${report.piiAccessSummary.accessesToday}`,
    `This Week: ${report.piiAccessSummary.accessesThisWeek}`,
    `This Month: ${report.piiAccessSummary.accessesThisMonth}`,
    `Unique Actors: ${report.piiAccessSummary.uniqueActors}`,
    'By Action:',
    ...Object.entries(report.piiAccessSummary.byAction).map(([k, v]) => `  ${k}: ${v}`),
    '',
    '--- DATA MASKING ---',
    `Environment: ${report.dataMasking.environment}`,
    `Masking Active: ${report.dataMasking.isEnabled ? 'Yes' : 'No'}`,
    ...(report.dataMasking.isEnabled
      ? [`Masked Fields: ${report.dataMasking.maskedFields.join(', ')}`]
      : []),
    '',
  ];

  if (report.recommendations.length > 0) {
    lines.push('--- RECOMMENDATIONS ---');
    for (const rec of report.recommendations) {
      lines.push(`  ! ${rec}`);
    }
    lines.push('');
  }

  lines.push('='.repeat(60));
  return lines.join('\n');
}
