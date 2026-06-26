import { csvAdapter } from './csvAdapter';
import { jsonAdapter } from './jsonAdapter';
import { parquetAdapter } from './parquetAdapter';
import { ExportFormat, FormatAdapter } from './types';

/** Registry of pluggable format adapters. Add a new format by registering here. */
const ADAPTERS: Record<ExportFormat, FormatAdapter> = {
  csv: csvAdapter,
  json: jsonAdapter,
  parquet: parquetAdapter,
};

export const getAdapter = (format: ExportFormat): FormatAdapter => {
  const adapter = ADAPTERS[format];
  if (!adapter) throw new Error(`Unsupported export format: ${format}`);
  return adapter;
};

export const supportedFormats = (): ExportFormat[] => Object.keys(ADAPTERS) as ExportFormat[];

export { csvAdapter, jsonAdapter, parquetAdapter };
export * from './types';
