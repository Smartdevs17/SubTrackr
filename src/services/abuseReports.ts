/**
 * src/services/abuseReports.ts
 *
 * Structured abuse-report intake with automated triage labels.
 *
 * Implements:
 *  - AbuseReport DTO with structured fields
 *  - Intake endpoint logic with validation
 *  - Automated triage label assignment based on severity keywords
 *  - Idempotency key support for duplicate prevention
 *  - Rate limiting per IP/reporter
 *  - In-memory repository with pluggable interface
 *  - Structured telemetry hooks and PII-redacting audit logging
 */

// Simple fallback logger for environments without the shared logging module
const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => console.debug(message, meta),
  info: (message: string, meta?: Record<string, unknown>) => console.info(message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => console.warn(message, meta),
  error: (message: string, meta?: Record<string, unknown>) => console.error(message, meta),
  child: (name: string) => logger,
};

// ── Types ─────────────────────────────────────────────────────────────────────

/** Severity levels for abuse reports. */
export type AbuseSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Status of an abuse report through its lifecycle. */
export type AbuseReportStatus = 'open' | 'triaged' | 'investigating' | 'resolved' | 'rejected';

/** Category of abuse being reported. */
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

/** Source of the abuse report. */
export type ReportSource = 'user' | 'automated' | 'partner' | 'internal';

/** Triage labels that can be automatically assigned. */
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

/** Structured abuse report DTO. */
export interface AbuseReport {
  id: string;
  idempotencyKey: string;
  reporterId: string;          // hashed/reporter reference, not raw PII
  reporterIpHash: string;      // SHA-256 hash of IP for rate limiting
  category: AbuseCategory;
  severity: AbuseSeverity;
  source: ReportSource;
  subject: string;             // brief summary
  description: string;         // detailed description
  targetResource?: string;     // URL, user ID, or resource identifier
  evidenceUrls?: string[];     // links to screenshots, logs, etc.
  metadata?: Record<string, unknown>; // flexible additional data
  triageLabels: TriageLabel[];
  status: AbuseReportStatus;
  assignedTo?: string;         // team member ID
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

/** Input for creating a new abuse report. */
export interface CreateAbuseReportInput {
  idempotencyKey: string;
  reporterId: string;
  reporterIp: string;          // will be hashed before storage
  category: AbuseCategory;
  severity: AbuseSeverity;
  source: ReportSource;
  subject: string;
  description: string;
  targetResource?: string;
  evidenceUrls?: string[];
  metadata?: Record<string, unknown>;
}

/** Rate limit configuration. */
export interface RateLimitConfig {
  maxReportsPerHour: number;
  maxReportsPerDay: number;
  windowMs: number;
}

/** Rate limit tracking entry. */
interface RateLimitEntry {
  count: number;
  windowStart: number;
  dailyCount: number;
  dailyWindowStart: number;
}

/** Triage rule for keyword-based label assignment. */
interface TriageRule {
  label: TriageLabel;
  keywords: string[];
  categories?: AbuseCategory[];
  severities?: AbuseSeverity[];
  sources?: ReportSource[];
}

/** Repository interface for abuse reports. */
export interface AbuseReportRepository {
  save(report: AbuseReport): Promise<void>;
  findById(id: string): Promise<AbuseReport | null>;
  findByIdempotencyKey(key: string): Promise<AbuseReport | null>;
  findByReporterId(reporterId: string): Promise<AbuseReport[]>;
  findByStatus(status: AbuseReportStatus): Promise<AbuseReport[]>;
  findByLabels(labels: TriageLabel[]): Promise<AbuseReport[]>;
  update(report: AbuseReport): Promise<void>;
  list(limit?: number, offset?: number): Promise<AbuseReport[]>;
  count(): Promise<number>;
}

/** Metrics interface for observability. */
export interface AbuseReportMetrics {
  recordIntake(report: AbuseReport): void;
  recordDuplicate(key: string): void;
  recordRateLimited(ipHash: string): void;
  recordTriage(report: AbuseReport, labels: TriageLabel[]): void;
  recordResolution(reportId: string, resolutionTimeMs: number): void;
  getSnapshot(): AbuseReportMetricsSnapshot;
}

/** Snapshot of metrics for reporting. */
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

/** No-op metrics implementation. */
export const noopAbuseReportMetrics: AbuseReportMetrics = {
  recordIntake: () => {},
  recordDuplicate: () => {},
  recordRateLimited: () => {},
  recordTriage: () => {},
  recordResolution: () => {},
  getSnapshot: () => ({
    totalIntake: 0,
    totalDuplicates: 0,
    totalRateLimited: 0,
    bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
    byCategory: {
      spam: 0, phishing: 0, malware: 0, fraud: 0, harassment: 0,
      copyright: 0, illegal_content: 0, platform_abuse: 0, api_abuse: 0, other: 0,
    },
    bySource: { user: 0, automated: 0, partner: 0, internal: 0 },
    byStatus: { open: 0, triaged: 0, investigating: 0, resolved: 0, rejected: 0 },
    avgResolutionTimeMs: 0,
  }),
};

/** Service options. */
export interface AbuseReportServiceOptions {
  repository?: AbuseReportRepository;
  metrics?: AbuseReportMetrics;
  now?: () => Date;
  rateLimitConfig?: Partial<RateLimitConfig>;
  hashIp?: (ip: string) => string;
  generateId?: (prefix: string) => string;
}

// ── Default Triage Rules ──────────────────────────────────────────────────────

const DEFAULT_TRIAGE_RULES: TriageRule[] = [
  // Severity-based labels (based on severity field, no keyword requirement)
  { label: 'severity:critical', keywords: [], severities: ['critical'] },
  { label: 'severity:high', keywords: [], severities: ['high'] },
  { label: 'severity:medium', keywords: [], severities: ['medium'] },
  { label: 'severity:low', keywords: [], severities: ['low'] },

  // Category-based labels (keyword matching on subject/description)
  { label: 'category:spam', keywords: ['spam', 'unsolicited', 'bulk message', 'mass mailing', 'spam campaign'], categories: ['spam'] },
  { label: 'category:phishing', keywords: ['phishing', 'credential harvest', 'fake login', 'spoofed', 'impersonation', 'social engineering'], categories: ['phishing'] },
  { label: 'category:malware', keywords: ['malware', 'virus', 'trojan', 'ransomware', 'malicious software', 'infected', 'payload', 'dropper'], categories: ['malware'] },
  { label: 'category:fraud', keywords: ['fraud', 'scam', 'fake', 'deceptive', 'fraudulent', 'identity theft', 'financial fraud'], categories: ['fraud'] },
  { label: 'category:harassment', keywords: ['harassment', 'harass', 'threat', 'abuse', 'bullying', 'stalking', 'doxxing', 'hate speech'], categories: ['harassment'] },
  { label: 'category:copyright', keywords: ['copyright', 'dmca', 'piracy', 'infringement', 'unauthorized copy', 'stolen content'], categories: ['copyright'] },
  { label: 'category:illegal_content', keywords: ['illegal', 'criminal', 'child exploitation', 'csam', 'terrorism', 'drug trafficking'], categories: ['illegal_content'] },
  { label: 'category:platform_abuse', keywords: ['platform abuse', 'terms violation', 'tos violation', 'policy violation', 'fake account', 'bot network'], categories: ['platform_abuse'] },
  { label: 'category:api_abuse', keywords: ['api abuse', 'rate limit bypass', 'credential stuffing', 'api scraping', 'automated abuse'], categories: ['api_abuse'] },

  // Source-based labels
  { label: 'source:user', keywords: [], sources: ['user'] },
  { label: 'source:automated', keywords: [], sources: ['automated'] },
  { label: 'source:partner', keywords: [], sources: ['partner'] },
  { label: 'source:internal', keywords: [], sources: ['internal'] },

  // Escalation triggers
  { label: 'needs:escalation', keywords: ['urgent', 'emergency', 'critical', 'data breach', 'ransomware', 'active attack', 'immediate'], severities: ['critical', 'high'] },
  { label: 'needs:review', keywords: ['review', 'triage'], severities: ['low', 'medium'] }, // default for non-critical
];

// ── In-Memory Repository ──────────────────────────────────────────────────────

export class InMemoryAbuseReportRepository implements AbuseReportRepository {
  private reports = new Map<string, AbuseReport>();
  private byIdempotencyKey = new Map<string, string>(); // key -> report id

  async save(report: AbuseReport): Promise<void> {
    this.reports.set(report.id, report);
    this.byIdempotencyKey.set(report.idempotencyKey, report.id);
  }

  async findById(id: string): Promise<AbuseReport | null> {
    return this.reports.get(id) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<AbuseReport | null> {
    const id = this.byIdempotencyKey.get(key);
    return id ? this.reports.get(id) ?? null : null;
  }

  async findByReporterId(reporterId: string): Promise<AbuseReport[]> {
    return Array.from(this.reports.values()).filter(r => r.reporterId === reporterId);
  }

  async findByStatus(status: AbuseReportStatus): Promise<AbuseReport[]> {
    return Array.from(this.reports.values()).filter(r => r.status === status);
  }

  async findByLabels(labels: TriageLabel[]): Promise<AbuseReport[]> {
    return Array.from(this.reports.values()).filter(r =>
      labels.some(l => r.triageLabels.includes(l))
    );
  }

  async update(report: AbuseReport): Promise<void> {
    this.reports.set(report.id, report);
  }

  async list(limit = 100, offset = 0): Promise<AbuseReport[]> {
    const all = Array.from(this.reports.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return all.slice(offset, offset + limit);
  }

  async count(): Promise<number> {
    return this.reports.size;
  }

  clear(): void {
    this.reports.clear();
    this.byIdempotencyKey.clear();
  }
}

// ── Structured Telemetry ──────────────────────────────────────────────────────

export class StructuredAbuseReportTelemetry implements AbuseReportMetrics {
  private counts = {
    totalIntake: 0,
    totalDuplicates: 0,
    totalRateLimited: 0,
    bySeverity: { low: 0, medium: 0, high: 0, critical: 0 } as Record<AbuseSeverity, number>,
    byCategory: {
      spam: 0, phishing: 0, malware: 0, fraud: 0, harassment: 0,
      copyright: 0, illegal_content: 0, platform_abuse: 0, api_abuse: 0, other: 0,
    } as Record<AbuseCategory, number>,
    bySource: { user: 0, automated: 0, partner: 0, internal: 0 } as Record<ReportSource, number>,
    byStatus: { open: 0, triaged: 0, investigating: 0, resolved: 0, rejected: 0 } as Record<AbuseReportStatus, number>,
    resolutionTimes: [] as number[],
  };

  recordIntake(report: AbuseReport): void {
    this.counts.totalIntake++;
    this.counts.bySeverity[report.severity]++;
    this.counts.byCategory[report.category]++;
    this.counts.bySource[report.source]++;
    this.counts.byStatus[report.status]++;
  }

  recordDuplicate(key: string): void {
    this.counts.totalDuplicates++;
  }

  recordRateLimited(ipHash: string): void {
    this.counts.totalRateLimited++;
  }

  recordTriage(report: AbuseReport, labels: TriageLabel[]): void {
    // Track triage action but don't modify status counts
    // Status only changes via updateReport()
  }

  recordResolution(reportId: string, resolutionTimeMs: number): void {
    this.counts.resolutionTimes.push(resolutionTimeMs);
  }

  getSnapshot(): AbuseReportMetricsSnapshot {
    const avgResolution = this.counts.resolutionTimes.length > 0
      ? this.counts.resolutionTimes.reduce((a, b) => a + b, 0) / this.counts.resolutionTimes.length
      : 0;

    return {
      totalIntake: this.counts.totalIntake,
      totalDuplicates: this.counts.totalDuplicates,
      totalRateLimited: this.counts.totalRateLimited,
      bySeverity: { ...this.counts.bySeverity },
      byCategory: { ...this.counts.byCategory },
      bySource: { ...this.counts.bySource },
      byStatus: { ...this.counts.byStatus },
      avgResolutionTimeMs: avgResolution,
    };
  }

  clear(): void {
    this.counts = {
      totalIntake: 0,
      totalDuplicates: 0,
      totalRateLimited: 0,
      bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
      byCategory: {
        spam: 0, phishing: 0, malware: 0, fraud: 0, harassment: 0,
        copyright: 0, illegal_content: 0, platform_abuse: 0, api_abuse: 0, other: 0,
      },
      bySource: { user: 0, automated: 0, partner: 0, internal: 0 },
      byStatus: { open: 0, triaged: 0, investigating: 0, resolved: 0, rejected: 0 },
      resolutionTimes: [],
    };
  }
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class AbuseReportError extends Error {
  public readonly code: string;
  public readonly message: string;

  constructor(message: string, code: string) {
    super(message);
    this.message = message;
    this.name = 'AbuseReportError';
    this.code = code;
  }
}

// ── Main Service ──────────────────────────────────────────────────────────────

export class AbuseReportService {
  private readonly repo: AbuseReportRepository;
  private readonly metrics: AbuseReportMetrics;
  private readonly now: () => Date;
  private readonly rateLimitConfig: RateLimitConfig;
  private readonly hashIp: (ip: string) => string;
  private readonly generateId: (prefix: string) => string;
  private readonly triageRules: TriageRule[];

  // Rate limit tracking: ipHash -> RateLimitEntry
  private rateLimitStore = new Map<string, RateLimitEntry>();

  constructor(options: AbuseReportServiceOptions = {}) {
    this.repo = options.repository ?? new InMemoryAbuseReportRepository();
    this.metrics = options.metrics ?? noopAbuseReportMetrics;
    this.now = options.now ?? (() => new Date());
    this.rateLimitConfig = {
      maxReportsPerHour: options.rateLimitConfig?.maxReportsPerHour ?? 10,
      maxReportsPerDay: options.rateLimitConfig?.maxReportsPerDay ?? 50,
      windowMs: options.rateLimitConfig?.windowMs ?? 60 * 60 * 1000, // 1 hour
    };
    this.hashIp = options.hashIp ?? this.defaultHashIp;
    this.generateId = options.generateId ?? this.defaultGenerateId;
    this.triageRules = DEFAULT_TRIAGE_RULES;
  }

  /** Default IP hashing using a simple hash (replace with crypto in production). */
  private defaultHashIp(ip: string): string {
    // Simple deterministic hash for demo; production should use crypto.subtle.digest
    let hash = 0;
    for (let i = 0; i < ip.length; i++) {
      hash = ((hash << 5) - hash) + ip.charCodeAt(i);
      hash |= 0;
    }
    return `ip_${Math.abs(hash).toString(16).padStart(8, '0')}`;
  }

  /** Default ID generation. */
  private defaultGenerateId(prefix: string): string {
    const timestamp = this.now().getTime().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${prefix}_${timestamp}_${random}`;
  }

  /** Check and update rate limit for an IP hash. Returns true if allowed. */
  private checkRateLimit(ipHash: string): boolean {
    const now = this.now().getTime();
    const entry = this.rateLimitStore.get(ipHash);

    if (!entry) {
      this.rateLimitStore.set(ipHash, {
        count: 1,
        windowStart: now,
        dailyCount: 1,
        dailyWindowStart: now,
      });
      return true;
    }

    // Check hourly window
    if (now - entry.windowStart >= this.rateLimitConfig.windowMs) {
      // Reset hourly window
      entry.count = 1;
      entry.windowStart = now;
    } else if (entry.count >= this.rateLimitConfig.maxReportsPerHour) {
      return false;
    } else {
      entry.count++;
    }

    // Check daily window (24 hours)
    const dailyWindowMs = 24 * 60 * 60 * 1000;
    if (now - entry.dailyWindowStart >= dailyWindowMs) {
      entry.dailyCount = 1;
      entry.dailyWindowStart = now;
    } else if (entry.dailyCount >= this.rateLimitConfig.maxReportsPerDay) {
      return false;
    } else {
      entry.dailyCount++;
    }

    return true;
  }

  /** Compute triage labels for a report based on rules. */
  private computeTriageLabels(report: AbuseReport): TriageLabel[] {
    const labels: TriageLabel[] = [];
    const searchText = `${report.subject} ${report.description}`.toLowerCase();

    for (const rule of this.triageRules) {
      let matches = true;

      // Check category filter
      if (rule.categories && !rule.categories.includes(report.category)) {
        matches = false;
      }

      // Check severity filter
      if (rule.severities && !rule.severities.includes(report.severity)) {
        matches = false;
      }

      // Check source filter
      if (rule.sources && !rule.sources.includes(report.source)) {
        matches = false;
      }

      // Check keywords
      if (rule.keywords.length > 0) {
        const keywordMatch = rule.keywords.some(kw => searchText.includes(kw.toLowerCase()));
        if (!keywordMatch) {
          matches = false;
        }
      }

      if (matches) {
        labels.push(rule.label);
      }
    }

    // Deduplicate
    return Array.from(new Set(labels));
  }

  /** Create a new abuse report. */
  async createReport(input: CreateAbuseReportInput): Promise<AbuseReport> {
    const nowIso = this.now().toISOString();
    const ipHash = this.hashIp(input.reporterIp);

    // Check idempotency key
    const existing = await this.repo.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      this.metrics.recordDuplicate(input.idempotencyKey);
      logger.warn('Duplicate abuse report rejected', { idempotencyKey: input.idempotencyKey, existingId: existing.id });
      throw new AbuseReportError(
        `Report with idempotency key already exists: ${existing.id}`,
        'DUPLICATE_IDEMPOTENCY_KEY'
      );
    }

    // Check rate limit
    if (!this.checkRateLimit(ipHash)) {
      this.metrics.recordRateLimited(ipHash);
      logger.warn('Rate limit exceeded for abuse report', { ipHash });
      throw new AbuseReportError(
        'Rate limit exceeded. Please try again later.',
        'RATE_LIMIT_EXCEEDED'
      );
    }

    // Compute triage labels
    const tempReport: AbuseReport = {
      id: this.generateId('abuse'),
      idempotencyKey: input.idempotencyKey,
      reporterId: input.reporterId,
      reporterIpHash: ipHash,
      category: input.category,
      severity: input.severity,
      source: input.source,
      subject: input.subject,
      description: input.description,
      targetResource: input.targetResource,
      evidenceUrls: input.evidenceUrls,
      metadata: input.metadata,
      triageLabels: [],
      status: 'open',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const triageLabels = this.computeTriageLabels(tempReport);
    tempReport.triageLabels = triageLabels;

    // Add default 'needs:review' if no escalation label
    if (!triageLabels.includes('needs:escalation') && !triageLabels.some(l => l.startsWith('needs:'))) {
      tempReport.triageLabels.push('needs:review');
    }

    // Save report
    await this.repo.save(tempReport);
    this.metrics.recordIntake(tempReport);
    this.metrics.recordTriage(tempReport, triageLabels);

    logger.info('Abuse report created', {
      reportId: tempReport.id,
      category: tempReport.category,
      severity: tempReport.severity,
      triageLabels: tempReport.triageLabels,
    });

    return tempReport;
  }

  /** Get a report by ID. */
  async getReport(id: string): Promise<AbuseReport | null> {
    return this.repo.findById(id);
  }

  /** Get a report by idempotency key. */
  async getReportByIdempotencyKey(key: string): Promise<AbuseReport | null> {
    return this.repo.findByIdempotencyKey(key);
  }

  /** Update report status and assignee. */
  async updateReport(
    id: string,
    updates: {
      status?: AbuseReportStatus;
      assignedTo?: string;
      triageLabels?: TriageLabel[];
      resolutionNote?: string;
    }
  ): Promise<AbuseReport | null> {
    const report = await this.repo.findById(id);
    if (!report) return null;

    const nowIso = this.now().toISOString();
    let statusChanged = false;

    if (updates.status && updates.status !== report.status) {
      report.status = updates.status;
      statusChanged = true;
      if (updates.status === 'resolved') {
        report.resolvedAt = nowIso;
        const createdTime = new Date(report.createdAt).getTime();
        const resolutionTime = new Date(nowIso).getTime() - createdTime;
        this.metrics.recordResolution(report.id, resolutionTime);
      }
    }

    if (updates.assignedTo !== undefined) {
      report.assignedTo = updates.assignedTo;
    }

    if (updates.triageLabels) {
      report.triageLabels = updates.triageLabels;
    }

    report.updatedAt = nowIso;
    await this.repo.update(report);

    logger.info('Abuse report updated', { reportId: id, status: report.status, assignedTo: report.assignedTo });

    return report;
  }

  /** List reports with filtering. */
  async listReports(filters?: {
    status?: AbuseReportStatus;
    category?: AbuseCategory;
    severity?: AbuseSeverity;
    reporterId?: string;
    labels?: TriageLabel[];
    limit?: number;
    offset?: number;
  }): Promise<AbuseReport[]> {
    let reports: AbuseReport[];

    if (filters?.labels && filters.labels.length > 0) {
      reports = await this.repo.findByLabels(filters.labels);
    } else if (filters?.reporterId) {
      reports = await this.repo.findByReporterId(filters.reporterId);
    } else if (filters?.status) {
      reports = await this.repo.findByStatus(filters.status);
    } else {
      // Get all reports without pagination at repo level; we'll paginate after filtering/sorting
      reports = await this.repo.list();
    }

    // Apply additional filters
    if (filters?.category) {
      reports = reports.filter(r => r.category === filters.category);
    }
    if (filters?.severity) {
      reports = reports.filter(r => r.severity === filters.severity);
    }
    if (filters?.status && !filters.labels && !filters.reporterId) {
      reports = reports.filter(r => r.status === filters.status);
    }

    // Sort by createdAt descending
    reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply pagination
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 100;
    return reports.slice(offset, offset + limit);
  }

  /** Get metrics snapshot. */
  getMetrics(): AbuseReportMetricsSnapshot {
    return this.metrics.getSnapshot();
  }

  /** Reset rate limit store (for testing). */
  resetRateLimits(): void {
    this.rateLimitStore.clear();
  }

  /** Get rate limit status for an IP. */
  getRateLimitStatus(ip: string): { allowed: boolean; remainingHourly: number; remainingDaily: number } {
    const ipHash = this.hashIp(ip);
    const now = this.now().getTime();
    const entry = this.rateLimitStore.get(ipHash);

    if (!entry) {
      return {
        allowed: true,
        remainingHourly: this.rateLimitConfig.maxReportsPerHour,
        remainingDaily: this.rateLimitConfig.maxReportsPerDay,
      };
    }

    let hourlyCount = entry.count;
    if (now - entry.windowStart >= this.rateLimitConfig.windowMs) {
      hourlyCount = 0;
    }

    let dailyCount = entry.dailyCount;
    if (now - entry.dailyWindowStart >= 24 * 60 * 60 * 1000) {
      dailyCount = 0;
    }

    return {
      allowed: hourlyCount < this.rateLimitConfig.maxReportsPerHour && dailyCount < this.rateLimitConfig.maxReportsPerDay,
      remainingHourly: Math.max(0, this.rateLimitConfig.maxReportsPerHour - hourlyCount),
      remainingDaily: Math.max(0, this.rateLimitConfig.maxReportsPerDay - dailyCount),
    };
  }
}