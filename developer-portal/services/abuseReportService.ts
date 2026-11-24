/**
 * developer-portal/services/abuseReportService.ts
 *
 * Client-side service for abuse report API interactions.
 */

import {
  AbuseReport,
  CreateAbuseReportRequest,
  CreateAbuseReportResponse,
  GetAbuseReportResponse,
  ListAbuseReportsRequest,
  ListAbuseReportsResponse,
  UpdateAbuseReportRequest,
  UpdateAbuseReportResponse,
  RateLimitStatus,
  AbuseReportMetricsResponse,
  AbuseCategory,
  AbuseSeverity,
  ReportSource,
} from '../types/abuse';

const API_BASE = '/api/v1';

class AbuseReportService {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `API error: ${response.status} ${response.statusText}`
      );
    }

    return response.json();
  }

  /** Create a new abuse report. */
  async createReport(input: CreateAbuseReportRequest): Promise<AbuseReport> {
    const response = await this.request<CreateAbuseReportResponse>('/abuse/reports', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return response.report;
  }

  /** Get a single abuse report by ID. */
  async getReport(id: string): Promise<AbuseReport> {
    const response = await this.request<GetAbuseReportResponse>(`/abuse/reports/${id}`);
    return response.report;
  }

  /** List abuse reports with optional filters. */
  async listReports(filters?: ListAbuseReportsRequest): Promise<ListAbuseReportsResponse> {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.category) params.append('category', filters.category);
    if (filters?.severity) params.append('severity', filters.severity);
    if (filters?.reporterId) params.append('reporterId', filters.reporterId);
    if (filters?.labels?.length) params.append('labels', filters.labels.join(','));
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.offset) params.append('offset', filters.offset.toString());

    const queryString = params.toString();
    const endpoint = `/abuse/reports${queryString ? `?${queryString}` : ''}`;

    return this.request<ListAbuseReportsResponse>(endpoint);
  }

  /** Update an abuse report. */
  async updateReport(id: string, updates: UpdateAbuseReportRequest): Promise<AbuseReport> {
    const response = await this.request<UpdateAbuseReportResponse>(`/abuse/reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    return response.report;
  }

  /** Get rate limit status for current IP. */
  async getRateLimitStatus(): Promise<RateLimitStatus> {
    return this.request<RateLimitStatus>('/abuse/rate-limit');
  }

  /** Get abuse report metrics. */
  async getMetrics(): Promise<AbuseReportMetricsResponse> {
    return this.request<AbuseReportMetricsResponse>('/abuse/metrics');
  }

  /** Generate a client-side idempotency key. */
  generateIdempotencyKey(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `idem_${timestamp}_${random}`;
  }

  /** Get category options for dropdown. */
  getCategoryOptions(): { value: AbuseCategory; label: string }[] {
    return [
      { value: 'spam', label: 'Spam' },
      { value: 'phishing', label: 'Phishing' },
      { value: 'malware', label: 'Malware' },
      { value: 'fraud', label: 'Fraud' },
      { value: 'harassment', label: 'Harassment' },
      { value: 'copyright', label: 'Copyright Infringement' },
      { value: 'illegal_content', label: 'Illegal Content' },
      { value: 'platform_abuse', label: 'Platform Abuse' },
      { value: 'api_abuse', label: 'API Abuse' },
      { value: 'other', label: 'Other' },
    ];
  }

  /** Get severity options for dropdown. */
  getSeverityOptions(): { value: AbuseSeverity; label: string; color: string }[] {
    return [
      { value: 'low', label: 'Low', color: '#22C55E' },
      { value: 'medium', label: 'Medium', color: '#F59E0B' },
      { value: 'high', label: 'High', color: '#EF4444' },
      { value: 'critical', label: 'Critical', color: '#7C2D12' },
    ];
  }

  /** Get source options for dropdown. */
  getSourceOptions(): { value: ReportSource; label: string }[] {
    return [
      { value: 'user', label: 'User Report' },
      { value: 'automated', label: 'Automated Detection' },
      { value: 'partner', label: 'Partner Report' },
      { value: 'internal', label: 'Internal' },
    ];
  }
}

export const abuseReportService = new AbuseReportService();