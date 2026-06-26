import { ExportRecord, ExportSchema, FormatAdapter, SerializedArtifact } from './types';

/** RFC 4180 field escaping: quote when the value contains `," \r \n`. */
const escapeCsv = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * CSV adapter. The header row is the schema's field list, so a consumer can
 * detect schema evolution (new/removed columns) by diffing the header. Output is
 * deterministic: fixed field order, `\n` line endings, no trailing clock data.
 */
export const csvAdapter: FormatAdapter = {
  format: 'csv',
  serialize(records: ExportRecord[], schema: ExportSchema): SerializedArtifact {
    const header = schema.fields.join(',');
    const rows = records.map((record) =>
      schema.fields.map((field) => escapeCsv(record[field])).join(',')
    );
    const content = [header, ...rows].join('\n');
    return {
      content,
      contentType: 'text/csv',
      extension: 'csv',
      byteLength: Buffer.byteLength(content, 'utf8'),
    };
  },
};
