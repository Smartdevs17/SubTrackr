import { randomBytes } from 'crypto';
import { encryptField, isPiiField } from './encryption';
import { keyManager } from './keyManager';
import { piiAuditService } from './piiAudit';
import type { ExportFormat } from './auditTypes';
import type { EncryptedField } from './encryption';
import type { PiiAccessAction } from './piiAudit';

export type ExportSection = 'profile' | 'subscriptions' | 'billingHistory' | 'consentLogs';
export type ProfileField = 'email' | 'name' | 'registeredAt';

export interface ExportRequestOptions {
  actorId: string;
  ownerId: string;
  sections?: ExportSection[];
  profileFields?: ProfileField[];
  format?: ExportFormat;
  expiresInMinutes?: number;
}

export interface ExportRequestSummary {
  exportId: string;
  ownerId: string;
  format: ExportFormat;
  status: ExportState;
  downloadUrl: string | null;
  expiresAt: number;
  createdAt: number;
  fieldsIncluded: string[];
  encryptedPayload?: EncryptedField;
}

export interface ExportDownloadResult {
  exportId: string;
  format: ExportFormat;
  expiresAt: number;
  downloadedAt: number;
  encryptedPayload: EncryptedField;
}

export type ExportState = 'pending' | 'processing' | 'completed' | 'cancelled' | 'failed';

const DEFAULT_SECTIONS: ExportSection[] = ['profile', 'subscriptions', 'billingHistory', 'consentLogs'];
const DEFAULT_PROFILE_FIELDS: ProfileField[] = ['email', 'name', 'registeredAt'];
const DEFAULT_FORMAT: ExportFormat = 'json';
const DEFAULT_EXPIRES_MINUTES = 15;
const DOWNLOAD_BASE_URL = process.env['GDPR_DOWNLOAD_BASE_URL'] ?? 'https://api.subtrackr.example.com/gdpr/download';

export class ExportService {
  private requests = new Map<string, ExportRequestSummary>();
  private downloadTokenIndex = new Map<string, string>();

  public async requestExport(options: ExportRequestOptions): Promise<ExportRequestSummary> {
    await this.ensureEncryptionInitialized();
    this.authorizeExport(options.actorId, options.ownerId);

    const now = Date.now();
    const expiresInMs = (options.expiresInMinutes ?? DEFAULT_EXPIRES_MINUTES) * 60 * 1000;
    const expiresAt = now + expiresInMs;
    const exportId = this.generateExportId();
    const sections = options.sections && options.sections.length > 0 ? options.sections : DEFAULT_SECTIONS;
    const profileFields = options.profileFields && options.profileFields.length > 0 ? options.profileFields : DEFAULT_PROFILE_FIELDS;
    const format = options.format ?? DEFAULT_FORMAT;

    const request: ExportRequestSummary = {
      exportId,
      ownerId: options.ownerId,
      format,
      status: 'pending',
      downloadUrl: null,
      expiresAt,
      createdAt: now,
      fieldsIncluded: [],
    };

    this.requests.set(exportId, request);

    this.logAuditEvent(
      'pii.exported',
      options.actorId,
      options.ownerId,
      this.buildPiiFieldList(sections, profileFields),
      {
        exportId,
        requestedAt: new Date(now).toISOString(),
        expiresAt,
        requestedSections: sections,
        profileFields,
        format,
      }
    );

    try {
      request.status = 'processing';
      const payload = await this.buildExportPayload(options.ownerId, sections, profileFields, request);
      const serializedPayload = this.serializePayload(payload, format);
      const encryptedPayload = this.encryptExportPayload(serializedPayload);
      request.encryptedPayload = encryptedPayload;
      request.fieldsIncluded = this.extractPiiFieldNames(payload);
      request.status = 'completed';
      request.downloadUrl = this.buildDownloadUrl(this.generateDownloadToken(exportId));
      return request;
    } catch (error) {
      if (request.status === 'cancelled') {
        request.status = 'cancelled';
      } else {
        request.status = 'failed';
      }
      throw error;
    }
  }

  public cancelExport(exportId: string, actorId: string): boolean {
    const request = this.requests.get(exportId);
    if (!request) throw new Error('Export request not found');
    if (!this.isAuthorized(actorId, request)) throw new Error('Unauthorized');
    if (request.status !== 'pending' && request.status !== 'processing') {
      return false;
    }
    request.status = 'cancelled';
    return true;
  }

  public getExportStatus(exportId: string, actorId: string): ExportRequestSummary {
    const request = this.requests.get(exportId);
    if (!request) throw new Error('Export request not found');
    if (!this.isAuthorized(actorId, request)) throw new Error('Unauthorized');
    return { ...request };
  }

  public downloadExport(downloadToken: string, actorId?: string): ExportDownloadResult {
    const exportId = this.downloadTokenIndex.get(downloadToken);
    if (!exportId) throw new Error('Download token not found or expired');

    const request = this.requests.get(exportId);
    if (!request) throw new Error('Export request not found');
    if (actorId && !this.isAuthorized(actorId, request)) throw new Error('Unauthorized');
    if (request.status !== 'completed') throw new Error('Export is not available for download');
    if (Date.now() > request.expiresAt) {
      this.expireRequest(exportId, downloadToken);
      throw new Error('Download link has expired');
    }

    this.logAuditEvent('pii.viewed', actorId ?? request.ownerId, request.exportId, request.fieldsIncluded, {
      exportId: request.exportId,
      downloadedAt: new Date().toISOString(),
      downloadToken,
    });

    return {
      exportId: request.exportId,
      format: request.format,
      expiresAt: request.expiresAt,
      downloadedAt: Date.now(),
      encryptedPayload: request.encryptedPayload as EncryptedField,
    };
  }

  private async buildExportPayload(
    ownerId: string,
    sections: ExportSection[],
    profileFields: ProfileField[],
    request: ExportRequestSummary
  ): Promise<Record<string, unknown>> {
    const userData = this.fetchUserData(ownerId);
    const payload: Record<string, unknown> = {};

    if ((request.status as ExportState) === 'cancelled') throw new Error('Export request cancelled');

    if (sections.includes('profile')) {
      payload.profile = this.filterProfile(userData.profile, profileFields);
      await this.pauseForCancellation(request);
    }

    if ((request.status as ExportState) === 'cancelled') throw new Error('Export request cancelled');

    if (sections.includes('subscriptions')) {
      payload.subscriptions = userData.subscriptions.map((subscription) => ({
        id: subscription.id,
        name: subscription.name,
        amount: subscription.amount,
        status: subscription.status,
      }));
      await this.pauseForCancellation(request);
    }

    if ((request.status as ExportState) === 'cancelled') throw new Error('Export request cancelled');

    if (sections.includes('billingHistory')) {
      payload.billingHistory = userData.billingHistory.map((record) => ({
        id: record.id,
        date: record.date,
        amount: record.amount,
        status: record.status,
      }));
      await this.pauseForCancellation(request);
    }

    if ((request.status as ExportState) === 'cancelled') throw new Error('Export request cancelled');

    if (sections.includes('consentLogs')) {
      payload.consentLogs = userData.consentLogs.map((entry) => ({
        type: entry.type,
        status: entry.status,
        date: entry.date,
      }));
      await this.pauseForCancellation(request);
    }

    return payload;
  }

  private async pauseForCancellation(request: ExportRequestSummary): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (request.status === 'cancelled') {
      throw new Error('Export request cancelled');
    }
  }

  private buildPiiFieldList(sections: ExportSection[], profileFields: ProfileField[]): string[] {
    const piiFields: string[] = [];
    if (sections.includes('profile')) {
      if (profileFields.includes('email')) piiFields.push('email');
      if (profileFields.includes('name')) piiFields.push('name');
    }
    return piiFields;
  }

  private buildDownloadUrl(token: string): string {
    return `${DOWNLOAD_BASE_URL}/${token}`;
  }

  private expireRequest(exportId: string, downloadToken: string): void {
    this.requests.delete(exportId);
    this.downloadTokenIndex.delete(downloadToken);
  }

  private generateDownloadToken(exportId: string): string {
    const token = randomBytes(24).toString('hex');
    this.downloadTokenIndex.set(token, exportId);
    return token;
  }

  private generateExportId(): string {
    return `export-${Date.now()}-${randomBytes(8).toString('hex')}`;
  }

  private extractPiiFieldNames(payload: Record<string, unknown>): string[] {
    const piiFields: string[] = [];
    if (payload.profile && typeof payload.profile === 'object') {
      for (const key of Object.keys(payload.profile as Record<string, unknown>)) {
        if (isPiiField(key)) {
          piiFields.push(`profile.${key}`);
        }
      }
    }
    return piiFields;
  }

  private filterProfile(profile: Record<string, unknown>, fields: ProfileField[]): Record<string, unknown> {
    const filtered: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in profile) {
        filtered[field] = profile[field];
      }
    }
    return filtered;
  }

  private fetchUserData(ownerId: string) {
    return {
      profile: { id: ownerId, email: 'user@example.com', name: 'John Doe', registeredAt: '2026-01-01' },
      subscriptions: [{ id: 'sub_1', name: 'Netflix', amount: 15.99, status: 'active' }],
      billingHistory: [{ id: 'tx_1', date: '2026-04-20', amount: 15.99, status: 'completed' }],
      consentLogs: [{ type: 'analytics', status: 'granted', date: '2026-01-01' }],
    };
  }

  private encryptExportPayload(serializedData: string): EncryptedField {
    const key = keyManager.getActiveEncryptionKey();
    if (!key) throw new Error('Encryption key not initialized');
    return encryptField(serializedData, key);
  }

  private serializePayload(payload: Record<string, unknown>, format: ExportFormat): string {
    if (format === 'json') {
      return JSON.stringify(payload, null, 2);
    }

    const chunks: string[] = [];
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

    for (const section of Object.keys(payload)) {
      const sectionValue = payload[section];
      if (Array.isArray(sectionValue)) {
        if (sectionValue.length === 0) {
          chunks.push(`${section},`);
          continue;
        }
        const headers = Object.keys(sectionValue[0] as Record<string, unknown>);
        chunks.push(`${escapeCsv(section)},${headers.map(escapeCsv).join(',')}`);
        for (const item of sectionValue as Record<string, unknown>[]) {
          chunks.push(
            [escapeCsv(section), ...headers.map((key) => escapeCsv(String((item as Record<string, unknown>)[key] ?? '')))].join(',')
          );
        }
      } else if (sectionValue && typeof sectionValue === 'object') {
        const record = sectionValue as Record<string, unknown>;
        for (const key of Object.keys(record)) {
          chunks.push([escapeCsv(section), escapeCsv(key), escapeCsv(String(record[key] ?? ''))].join(','));
        }
      } else {
        chunks.push([escapeCsv(section), escapeCsv(String(sectionValue ?? ''))].join(','));
      }
    }

    return chunks.join('\n');
  }

  private authorizeExport(actorId: string, ownerId: string): void {
    if (actorId !== ownerId && actorId !== 'admin') {
      throw new Error('Unauthorized to request export');
    }
  }

  private isAuthorized(actorId: string, request: ExportRequestSummary): boolean {
    return actorId === request.ownerId || actorId === 'admin';
  }

  private async ensureEncryptionInitialized(): Promise<void> {
    if (!keyManager.getActiveEncryptionKey()) {
      await keyManager.initialize();
    }
  }

  private logAuditEvent(
    action: PiiAccessAction,
    actorId: string,
    resourceId: string,
    fieldsAccessed: string[],
    metadata: Record<string, unknown> = {}
  ) {
    piiAuditService.logPiiAccess(action, actorId, resourceId, 'user', fieldsAccessed, metadata);
  }
}

export const exportService = new ExportService();
