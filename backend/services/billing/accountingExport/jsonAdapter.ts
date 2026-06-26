import { ExportRecord, ExportSchema, FormatAdapter, SerializedArtifact } from './types';

/**
 * JSON adapter. Emits a self-describing envelope carrying the schema version so
 * consumers can adapt to evolution. Records are projected to exactly the schema's
 * fields (in order) and key order is stable, keeping output deterministic.
 */
export const jsonAdapter: FormatAdapter = {
  format: 'json',
  serialize(records: ExportRecord[], schema: ExportSchema): SerializedArtifact {
    const projected = records.map((record) => {
      const row: Record<string, unknown> = {};
      for (const field of schema.fields) {
        if (record[field] !== undefined) row[field] = record[field];
      }
      return row;
    });

    const content = JSON.stringify({
      schemaVersion: schema.version,
      fields: schema.fields,
      records: projected,
    });

    return {
      content,
      contentType: 'application/json',
      extension: 'json',
      byteLength: Buffer.byteLength(content, 'utf8'),
    };
  },
};
