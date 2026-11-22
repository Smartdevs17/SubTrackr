/**
 * GDPR Data Export Service (Right to Portability — Article 20)
 *
 * Collects all personal data associated with a user across system
 * components and packages it in a machine-readable format (JSON).
 * Applies PII anonymization strategies from the PII registry based
 * on the requested export level.
 */

import {
  PII_REGISTRY,
  getFieldDefinition,
  type ExportLevel,
  type PiiFieldDefinition,
} from './piiRegistry';
import { createHash } from 'crypto';

export interface UserDataCollector {
  /** Collect all data for a user from a specific source (e.g. subscriptions, billing) */
  collect(userId: string): Promise<Record<string, unknown>[]>;
  /** Human-readable name of this data source */
  sourceName: string;
}

export interface DataExportRequest {
  userId: string;
  exportLevel: ExportLevel;
  requestedAt: number;
  requestId: string;
}

export interface DataExportResult {
  requestId: string;
  userId: string;
  exportedAt: number;
  exportLevel: ExportLevel;
  sources: string[];
  recordCount: number;
  data: Record<string, unknown>[];
  checksum: string;
}

export class DataExportService {
  private collectors: UserDataCollector[] = [];

  registerCollector(collector: UserDataCollector): void {
    this.collectors.push(collector);
  }

  /**
   * Export all user data. Collects from all registered sources and
   * applies anonymization based on the export level.
   */
  async exportUserData(request: DataExportRequest): Promise<DataExportResult> {
    const allRecords: Record<string, unknown>[] = [];
    const sources: string[] = [];

    for (const collector of this.collectors) {
      const records = await collector.collect(request.userId);
      sources.push(collector.sourceName);
      for (const record of records) {
        const processed = this.applyAnonymization(record, request.exportLevel);
        allRecords.push({ _source: collector.sourceName, ...processed });
      }
    }

    const checksum = createHash('sha256')
      .update(JSON.stringify(allRecords))
      .digest('hex');

    return {
      requestId: request.requestId,
      userId: this.anonymizeValue('userId', request.userId, request.exportLevel),
      exportedAt: Date.now(),
      exportLevel: request.exportLevel,
      sources,
      recordCount: allRecords.length,
      data: allRecords,
      checksum,
    };
  }

  /**
   * Apply the appropriate anonymization strategy to each PII field
   * in a record based on the export level.
   */
  private applyAnonymization(
    record: Record<string, unknown>,
    level: ExportLevel,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      result[key] = this.anonymizeValue(key, value, level);
    }
    return result;
  }

  /**
   * Anonymize a single field value based on its PII definition and export level.
   * - 'full' — no anonymization, data as-is
   * - 'pseudonymized' — direct identifiers hashed, quasi-identifiers kept
   * - 'anonymized' — all PII irreversibly anonymized
   */
  private anonymizeValue(field: string, value: unknown, level: ExportLevel): unknown {
    if (value === null || value === undefined) return value;
    if (level === 'full') return value;

    const def = getFieldDefinition(field);
    if (!def) return value;

    const strValue = String(value);

    if (level === 'pseudonymized') {
      if (def.sensitivity === 'direct') {
        return this.applyStrategy(def, strValue);
      }
      return value;
    }

    // anonymized level — all PII is anonymized
    return this.applyStrategy(def, strValue);
  }

  private applyStrategy(def: PiiFieldDefinition, value: string): string {
    switch (def.strategy) {
      case 'hash':
        return createHash('sha256').update(value).digest('hex').substring(0, 16);
      case 'mask':
        if (value.length <= 2) return '*'.repeat(value.length);
        return value.charAt(0) + '*'.repeat(value.length - 2) + value.charAt(value.length - 1);
      case 'truncate':
        if (value.length <= 3) return value;
        return value.substring(0, 3) + '***';
      case 'perturb':
        return '[redacted-timestamp]';
      case 'none':
        return value;
      default:
        return value;
    }
  }

  /**
   * List all registered data sources available for export.
   */
  listSources(): string[] {
    return this.collectors.map((c) => c.sourceName);
  }
}
