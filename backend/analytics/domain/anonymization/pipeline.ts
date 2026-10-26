import { randomBytes } from 'crypto';
import {
  MaskStrategy,
  HashStrategy,
  TruncateStrategy,
  PerturbStrategy,
  AnonymizationStrategy,
} from './strategies';
import {
  PII_REGISTRY,
  ExportLevel,
  getQuasiIdentifiers,
  type AnonymizationStrategyType,
} from '../../../gdpr/piiRegistry';

export interface AnonymizationResult {
  rows: Record<string, unknown>[];
  /** Per-field summary of what was transformed */
  transformedFields: string[];
  /** Salt used for this export (must NOT be stored for anonymized exports) */
  exportSalt: string;
  warnings: string[];
}

/** Minimum group size for k-anonymity */
const K_ANONYMITY_THRESHOLD = 5;
/** Dataset size below which re-identification risk warning is issued */
const SMALL_DATASET_THRESHOLD = 20;

const STRATEGY_MAP: Record<AnonymizationStrategyType, AnonymizationStrategy> = {
  mask: new MaskStrategy(),
  hash: new HashStrategy(),
  truncate: new TruncateStrategy(),
  perturb: new PerturbStrategy(),
  none: { apply: (v) => v },
};

export class AnonymizationPipeline {
  /**
   * Processes rows according to the requested export level.
   *
   * - `full`          – no transformation (admin only)
   * - `pseudonymized` – direct PII is hashed with a per-export salt (reversible
   *                     only if the salt is retained; default: salt is kept)
   * - `anonymized`    – all PII strategies applied; salt is discarded after use
   */
  run(
    rows: Record<string, unknown>[],
    level: ExportLevel
  ): AnonymizationResult {
    const warnings: string[] = [];
    const exportSalt = randomBytes(16).toString('hex');

    // Small dataset warning
    if (rows.length > 0 && rows.length < SMALL_DATASET_THRESHOLD) {
      warnings.push(
        `Small dataset (${rows.length} records): re-identification risk is elevated. ` +
          'Consider aggregating before sharing.'
      );
    }

    if (level === 'full') {
      this.checkKAnonymity(rows, warnings);
      return {
        rows,
        transformedFields: [],
        exportSalt,
        warnings,
      };
    }

    const transformedFields = new Set<string>();
    const anonymizedRows = rows.map((row) =>
      this.transformRow(row, level, exportSalt, transformedFields)
    );

    this.checkKAnonymity(anonymizedRows, warnings);

    return {
      rows: anonymizedRows,
      transformedFields: Array.from(transformedFields),
      exportSalt: level === 'anonymized' ? '[discarded]' : exportSalt,
      warnings,
    };
  }

  /** Returns a sample (up to 5 rows) of anonymized data for preview. */
  preview(
    rows: Record<string, unknown>[],
    level: ExportLevel
  ): Record<string, unknown>[] {
    const sample = rows.slice(0, 5);
    return this.run(sample, level).rows;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private transformRow(
    row: Record<string, unknown>,
    level: ExportLevel,
    salt: string,
    transformedFields: Set<string>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
      const def = PII_REGISTRY[key];
      if (!def || def.strategy === 'none') {
        result[key] = value;
        continue;
      }

      // For pseudonymized, only transform direct PII; quasi-identifiers pass through
      if (level === 'pseudonymized' && def.sensitivity !== 'direct') {
        result[key] = value;
        continue;
      }

      const strategy = STRATEGY_MAP[def.strategy];
      result[key] = strategy.apply(String(value ?? ''), salt);
      transformedFields.add(key);
    }

    return result;
  }

  private checkKAnonymity(rows: Record<string, unknown>[], warnings: string[]): void {
    if (rows.length === 0) return;

    const quasiIds = getQuasiIdentifiers();
    const groups = new Map<string, number>();

    for (const row of rows) {
      const key = quasiIds
        .map((q) => `${q}=${String(row[q] ?? '')}`)
        .join('|');
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }

    const violations = Array.from(groups.values()).filter(
      (count) => count < K_ANONYMITY_THRESHOLD
    );

    if (violations.length > 0) {
      warnings.push(
        `k-anonymity violation: ${violations.length} quasi-identifier group(s) have fewer than ` +
          `${K_ANONYMITY_THRESHOLD} records. Re-identification risk is elevated.`
      );
    }
  }
}

export const anonymizationPipeline = new AnonymizationPipeline();
