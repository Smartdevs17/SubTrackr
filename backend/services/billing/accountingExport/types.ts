import { ChangeOperation } from '../../subscription/subscriptionEventStore';

/** Supported export serialization formats. */
export type ExportFormat = 'csv' | 'json' | 'parquet';

/**
 * A single exportable record. Derived from a CDC change event, so it always
 * carries the `lsn`, `operation` and `version` needed for downstream ordering,
 * tombstone handling and conflict resolution. Field columns are optional because
 * a delete tombstone only needs the id.
 */
export interface ExportRecord {
  lsn: number;
  operation: ChangeOperation;
  id: string;
  version: number;
  merchantId?: string;
  name?: string;
  price?: number;
  currency?: string;
  billingCycle?: string;
  status?: string;
  nextBillingDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Export schema. Ordered field list + a version so consumers can detect and
 * adapt to evolution (added/removed columns) without breaking older readers.
 */
export interface ExportSchema {
  version: number;
  fields: (keyof ExportRecord)[];
}

export const CURRENT_EXPORT_SCHEMA: ExportSchema = {
  version: 1,
  fields: [
    'lsn',
    'operation',
    'id',
    'version',
    'merchantId',
    'name',
    'price',
    'currency',
    'billingCycle',
    'status',
    'nextBillingDate',
    'createdAt',
    'updatedAt',
  ],
};

export interface SerializedArtifact {
  content: string;
  contentType: string;
  extension: string;
  byteLength: number;
}

/**
 * A format adapter turns records + schema into a serialized artifact. Adapters
 * MUST be pure and deterministic — no clocks, no RNG — so re-running an export
 * for the same watermark yields byte-identical output (idempotency guarantee).
 */
export interface FormatAdapter {
  readonly format: ExportFormat;
  serialize(records: ExportRecord[], schema: ExportSchema): SerializedArtifact;
}
