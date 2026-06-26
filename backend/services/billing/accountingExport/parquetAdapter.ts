import { ExportRecord, ExportSchema, FormatAdapter, SerializedArtifact } from './types';

/**
 * Parquet adapter.
 *
 * Parquet is a columnar format: values for each column are stored together,
 * which is what makes it cheap to scan/compress at warehouse scale. Producing a
 * real binary Parquet file requires a native/heavy dependency (e.g. `parquetjs`),
 * so this adapter emits a **deterministic columnar representation** with the same
 * logical shape — a typed schema plus column-major value arrays — that a real
 * Parquet writer can be dropped in for without changing callers.
 *
 * The representation is self-describing (schema + version + dtypes), so schema
 * evolution is supported: adding/removing a field changes the schema block and
 * the column set, and older readers can ignore unknown columns.
 *
 * To switch to true binary Parquet, replace `serialize` with a `parquetjs`
 * writer keyed off the same `schema.fields`; the export pipeline is unaffected.
 */

const PARQUET_DTYPES: Partial<Record<keyof ExportRecord, 'INT64' | 'DOUBLE' | 'UTF8'>> = {
  lsn: 'INT64',
  version: 'INT64',
  price: 'DOUBLE',
};

const dtypeFor = (field: keyof ExportRecord): 'INT64' | 'DOUBLE' | 'UTF8' =>
  PARQUET_DTYPES[field] ?? 'UTF8';

export const parquetAdapter: FormatAdapter = {
  format: 'parquet',
  serialize(records: ExportRecord[], schema: ExportSchema): SerializedArtifact {
    // Column-major layout: one array of values per field, aligned by row index.
    const columns: Record<string, unknown[]> = {};
    for (const field of schema.fields) {
      columns[field] = records.map((record) => record[field] ?? null);
    }

    const content = JSON.stringify({
      format: 'parquet-columnar-v1',
      schemaVersion: schema.version,
      schema: schema.fields.map((field) => ({ name: field, type: dtypeFor(field) })),
      rowCount: records.length,
      columns,
    });

    return {
      content,
      contentType: 'application/vnd.apache.parquet',
      extension: 'parquet',
      byteLength: Buffer.byteLength(content, 'utf8'),
    };
  },
};
