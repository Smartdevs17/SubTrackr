/**
 * developer-portal/types/abuse.ts
 *
 * Type definitions for abuse report intake and management.
 */

export type AbuseCategory =
  | 'spam'
  | 'phishing'
  | 'malware'
  | 'fraud'
  | 'harassment'
  | 'copyright'
  | 'illegal_content'
  | 'platform_abuse'
  | 'api_abuse'
  | 'other';

export type AbuseSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ReportSource = 'user' | 'automated' | 'partner' | 'internal';

export type AbuseReportStatus = 'open' | 'triaged' | 'investigating' | 'resolved' | 'rejected';

export type TriageLabel =
  | 'severity:low'
  | 'severity:medium'
  | 'severity:high'
  | 'severity:critical'
  | 'category:spam'
  | 'category:phishing'
  | 'category:malware'
  | 'category:fraud'
  | 'category:harassment'
  | 'category:copyright'
  | 'category:illegal_content'
  | 'category:platform_abuse'
  | 'category:api_abuse'
  | 'category:other'
  | 'source:user'
  | 'source:automated'
  | 'source:partner'
  | 'source:internal'
  | 'needs:review'
  | 'needs:escalation'
  | 'duplicate:detected'
  | 'rate:limited';

export interface AbuseReport {
  id: string;
  idempotencyKey: string;
  reporterId: string;
  reporterIpHash: string;
  category: AbuseCategory;
  severity: AbuseSeverity;
  source: ReportSource;
  subject: string;
  description: string;
  targetResource?: string;
  evidenceUrls?: string[];
  metadata?: Record<string, unknown>;
  triageLabels: TriageLabel[];
  status: AbuseReportStatus;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface CreateAbuseReportRequest {
  idempotencyKey: string;
  reporterId: string;
  reporterIp: string;
  category: AbuseCategory;
  severity: AbuseSeverity;
  source: ReportSource;
  subject: string;
  description: string;
  targetResource?: string;
  evidenceUrls?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateAbuseReportResponse {
  report: AbuseReport;
}

export interface GetAbuseReportResponse {
  report: AbuseReport;
}

export interface ListAbuseReportsRequest {
  status?: AbuseReportStatus;
  category?: AbuseCategory;
  severity?: AbuseSeverity;
  reporterId?: string;
  labels?: TriageLabel[];
  limit?: number;
  offset?: number;
}

export interface ListAbuseReportsResponse {
  reports: AbuseReport[];
  total: number;
  hasMore: boolean;
}

export interface UpdateAbuseReportRequest {
  status?: AbuseReportStatus;
  assignedTo?: string;
  triageLabels?: TriageLabel[];
  resolutionNote?: string;
}

export interface UpdateAbuseReportResponse {
  report: AbuseReport;
}

export interface RateLimitStatus {
  allowed: boolean;
  remainingHourly: number;
  remainingDaily: number;
}

export interface AbuseReportMetricsSnapshot {
  totalIntake: number;
  totalDuplicates: number;
  totalRateLimited: number;
  bySeverity: Record<AbuseSeverity, number>;
  byCategory: Record<AbuseCategory, number>;
  bySource: Record<ReportSource, number>;
  byStatus: Record<AbuseReportStatus, number>;
  avgResolutionTimeMs: number;
}

export interface AbuseReportMetricsResponse {
  metrics: AbuseReportMetricsSnapshot;
}

// Category display names for UI
export const ABUSE_CATEGORY_LABELS: Record<AbuseCategory, string> = {
  spam: 'Spam',
  phishing: 'Phishing',
  malware: 'Malware',
  fraud: 'Fraud',
  harassment: 'Harassment',
  copyright: 'Copyright Infringement',
  illegal_content: 'Illegal Content',
  platform_abuse: 'Platform Abuse',
  api_abuse: 'API Abuse',
  other: 'Other',
};

// Severity display names and colors for UI
export const ABUSE_SEVERITY_LABELS: Record<AbuseSeverity, { label: string; color: string }> = {
  low: { label: 'Low', color: '#22C55E' },
  medium: { label: 'Medium', color: '#F59E0B' },
  high: { label: 'High', color: '#EF4444' },
  critical: { label: 'Critical', color: '#7C2D12' },
};

// Status display names and colors for UI
export const ABUSE_STATUS_LABELS: Record<AbuseReportStatus, { label: string; color: string }> = {
  open: { label: 'Open', color: '#3B82F6' },
  triaged: { label: 'Triaged', color: '#8B5CF6' },
  investigating: { label: 'Investigating', color: '#F59E0B' },
  resolved: { label: 'Resolved', color: '#22C55E' },
  rejected: { label: 'Rejected', color: '#6B7280' },
};

// Source display names for UI
export const REPORT_SOURCE_LABELS: Record<ReportSource, string> = {
  user: 'User Report',
  automated: 'Automated Detection',
  partner: 'Partner Report',
  internal: 'Internal',
};

// Triage label display names for UI
export const TRIAGE_LABEL_DISPLAY: Record<TriageLabel, string> = {
  'severity:low': 'Severity: Low',
  'severity:medium': 'Severity: Medium',
  'severity:high': 'Severity: High',
  'severity:critical': 'Severity: Critical',
  'category:spam': 'Category: Spam',
  'category:phishing': 'Category: Phishing',
  'category:malware': 'Category: Malware',
  'category:fraud': 'Category: Fraud',
  'category:harassment': 'Category: Harassment',
  'category:copyright': 'Category: Copyright',
  'category:illegal_content': 'Category: Illegal Content',
  'category:platform_abuse': 'Category: Platform Abuse',
  'category:api_abuse': 'Category: API Abuse',
  'category:other': 'Category: Other',
  'source:user': 'Source: User',
  'source:automated': 'Source: Automated',
  'source:partner': 'Source: Partner',
  'source:internal': 'Source: Internal',
  'needs:review': 'Needs Review',
  'needs:escalation': 'Needs Escalation',
  'duplicate:detected': 'Duplicate Detected',
  'rate:limited': 'Rate Limited',
};