/**
 * AnonymizationController
 *
 * Provides the configuration API for analytics export anonymization and records
 * a structured audit log entry for every export request.
 */

import { anonymizationPipeline, type AnonymizationResult } from '../domain/anonymization/pipeline';
import { type ExportLevel, getPiiFields } from '../../gdpr/piiRegistry';
import { piiAuditService } from '../../services/shared/piiAudit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportConfig {
  /** Export level requested by the caller */
  level: ExportLevel;
  /** Identifier of the user/system requesting the export */
  requestedBy: string;
  /** Optional label / description attached to this export */
  label?: string;
}

export interface ExportAuditEntry {
  exportId: string;
  requestedBy: string;
  level: ExportLevel;
  label?: string;
  timestamp: string;
  transformedFields: string[];
  warnings: string[];
  rowCount: number;
}

export interface ExportResponse {
  exportId: string;
  result: AnonymizationResult;
  audit: ExportAuditEntry;
}

// Role to allowed export levels (enforced by controller)
const LEVEL_PERMISSIONS: Record<string, ExportLevel[]> = {
  admin: ['full', 'pseudonymized', 'anonymized'],
  analytics: ['pseudonymized', 'anonymized'],
  'third-party': ['anonymized'],
};

// ---------------------------------------------------------------------------
// In-memory audit log (in production this would be persisted)
// ---------------------------------------------------------------------------
const _auditLog: ExportAuditEntry[] = [];

function generateExportId(): string {
  return `anon-export-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class AnonymizationController {
  /**
   * Run an anonymized analytics export.
   *
   * @param rows     Raw data rows to be exported
   * @param config   Export configuration (level, requester)
   * @param role     Caller's role – used to enforce level permissions
   */
  export(
    rows: Record<string, unknown>[],
    config: ExportConfig,
    role: string
  ): ExportResponse {
    this.authorize(config.level, role, config.requestedBy);

    const result = anonymizationPipeline.run(rows, config.level);

    const audit = this.recordAudit(result, config);

    return { exportId: audit.exportId, result, audit };
  }

  /**
   * Preview up to 5 anonymized sample rows without committing an audit entry.
   */
  previewExport(
    rows: Record<string, unknown>[],
    level: ExportLevel,
    role: string,
    requestedBy: string
  ): Record<string, unknown>[] {
    this.authorize(level, role, requestedBy);
    return anonymizationPipeline.preview(rows, level);
  }

  /** Returns the full export audit log. */
  getAuditLog(): ExportAuditEntry[] {
    return [..._auditLog];
  }

  /** Returns the PII field registry for UI configuration screens. */
  getPiiFieldRegistry() {
    return getPiiFields();
  }

  // ---------------------------------------------------------------------------

  private authorize(level: ExportLevel, role: string, requestedBy: string): void {
    const allowed = LEVEL_PERMISSIONS[role] ?? ['anonymized'];
    if (!allowed.includes(level)) {
      throw new Error(
        `Role '${role}' (${requestedBy}) is not permitted to request '${level}' exports. ` +
          `Allowed: ${allowed.join(', ')}`
      );
    }
  }

  private recordAudit(
    result: AnonymizationResult,
    config: ExportConfig
  ): ExportAuditEntry {
    const exportId = generateExportId();
    const entry: ExportAuditEntry = {
      exportId,
      requestedBy: config.requestedBy,
      level: config.level,
      label: config.label,
      timestamp: new Date().toISOString(),
      transformedFields: result.transformedFields,
      warnings: result.warnings,
      rowCount: result.rows.length,
    };

    _auditLog.push(entry);

    // Also write to the shared PII audit trail
    piiAuditService.logPiiAccess(
      'pii.exported',
      config.requestedBy,
      exportId,
      'analytics_export',
      result.transformedFields,
      {
        level: config.level,
        label: config.label,
        rowCount: result.rows.length,
        warnings: result.warnings,
        exportSalt: result.exportSalt === '[discarded]' ? '[discarded]' : '[retained]',
      }
    );

    return entry;
  }
}

export const anonymizationController = new AnonymizationController();
