/**
 * Backend accounting export service.
 *
 * Handles large-dataset streaming exports, reconciliation checks,
 * PDF generation, custom field mappings, schedule management, analytics,
 * and encoding-safe output for CSV/JSON/QuickBooks/Xero/PDF formats.
 *
 * Issue #768: Added async-generator streaming exports and SSE progress variants.
 */

import { MemoryMonitor, toNdjsonLine } from '../shared/streaming';

export type AccountingFormat = 'csv' | 'json' | 'quickbooks' | 'xero' | 'pdf' | 'excel_xml' | 'ndjson' | 'ofx' | 'iif' | 'tsv';
export type TransactionType = 'revenue' | 'refund' | 'credit' | 'fee';
export type ExportFrequency = 'daily' | 'weekly' | 'monthly';
export type ExportStatus = 'success' | 'failed';

export interface TransactionRecord {
  id: string;
  merchantId: string;
  subscriptionId: string;
  subscriptionName: string;
  description?: string;
  category?: string;
  transactionType: TransactionType;
  amount: number;
  currency: string;
  billingCycle?: string;
  billingDate: number; // Unix ms
  deferredRevenue?: number;
  createdAt: number;
}

export interface ExportFilter {
  merchantId?: string;
  dateFrom?: number;
  dateTo?: number;
  transactionTypes?: TransactionType[];
  includeInactive?: boolean;
}

export interface CustomFieldMapping {
  targetField: string;
  sourceField: keyof TransactionRecord | `custom:${string}`;
  defaultValue?: string;
  transform?: 'none' | 'uppercase' | 'lowercase' | 'currency' | 'date';
}

export interface StreamExportOptions {
  format: AccountingFormat;
  filter?: ExportFilter;
  /** Called with each chunk of output (for streaming large datasets). */
  onChunk: (chunk: string) => void;
  /** Chunk size in number of records. Default: 500. */
  chunkSize?: number;
  /** Custom column mappings (CSV/QuickBooks/Xero only). */
  fieldMappings?: CustomFieldMapping[];
  /** Custom field key-value pairs appended to each record. */
  customFields?: Record<string, string>;
  /**
   * When true for JSON format, wraps records in a schema envelope with
   * `$schema`, `schemaVersion`, `merchantId`, `exportedAt`, `recordCount`,
   * and `records`.
   */
  includeSchema?: boolean;
}

// ── Async streaming types (Issue #768) ──────────────────────────────────────

/** Progress callback fired for each chunk during a streaming export. */
export type ExportProgressCallback = (progress: {
  /** 0–100 */
  percent: number;
  /** Records processed so far */
  recordsProcessed: number;
  /** Total records in the filtered result */
  totalRecords: number;
  /** Serialised chunk payload */
  chunk: string;
  /** Chunk index starting at 0 */
  chunkIndex: number;
}) => void | Promise<void>;

/** Options for the async-generator streaming export variants. */
export interface AsyncStreamExportOptions {
  format: AccountingFormat;
  filter?: ExportFilter;
  /** Chunk size in records. Default: 500. */
  chunkSize?: number;
  /** Optional memory monitor — will call check() between chunks. */
  memoryMonitor?: MemoryMonitor;
}

export interface ReconciliationResult {
  totalRecords: number;
  totalAmount: number;
  mismatches: Array<{ id: string; reason: string }>;
  isBalanced: boolean;
}

export interface ExportSchedule {
  id: string;
  merchantId: string;
  format: AccountingFormat;
  frequency: ExportFrequency;
  enabled: boolean;
  includeInactive: boolean;
  fieldMappings?: CustomFieldMapping[];
  customFields?: Record<string, string>;
  nextRunAt: number;
  lastRunAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type ExportScheduleInput = Omit<ExportSchedule, 'id' | 'createdAt' | 'updatedAt'>;

export interface ExportHistoryEntry {
  id: string;
  merchantId: string;
  format: AccountingFormat;
  status: ExportStatus;
  itemCount: number;
  checksum: string;
  scheduleId?: string;
  error?: string;
  downloadCount: number;
  lastDownloadedAt?: number;
  createdAt: number;
}

export interface ExportAnalytics {
  totalExports: number;
  totalDownloads: number;
  successCount: number;
  failedCount: number;
  totalItemsExported: number;
  formatBreakdown: Record<AccountingFormat, number>;
}

// ── In-process stores (swap for DB/cache in production) ───────────────────────

const scheduleStore: ExportSchedule[] = [];
const historyStore: ExportHistoryEntry[] = [];

// ── Encoding helpers ──────────────────────────────────────────────────────────

/** Escape a value for CSV, handling commas, quotes, and non-ASCII safely. */
function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  // Normalize to NFC to avoid encoding mismatches
  const normalized = text.normalize('NFC');
  return `"${normalized.replace(/"/g, '""')}"`;
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// ── Format builders ───────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'TransactionId',
  'MerchantId',
  'SubscriptionId',
  'Name',
  'Description',
  'Category',
  'Type',
  'Amount',
  'Currency',
  'BillingCycle',
  'BillingDate',
  'DeferredRevenue',
  'CreatedAt',
];

const QB_HEADERS = [
  'Customer',
  'Product/Service',
  'Description',
  'Qty',
  'Rate',
  'Amount',
  'Currency',
  'Service Date',
  'Memo',
];

const XERO_HEADERS = [
  'ContactName',
  'InvoiceNumber',
  'InvoiceDate',
  'DueDate',
  'Description',
  'Quantity',
  'UnitAmount',
  'AccountCode',
  'TaxType',
  'Currency',
];

function recordToCsvRow(
  r: TransactionRecord,
  format: AccountingFormat,
  fieldMappings?: CustomFieldMapping[],
  customFields?: Record<string, string>
): string {
  if (fieldMappings?.length) {
    return fieldMappings
      .map((mapping) => {
        if (String(mapping.sourceField).startsWith('custom:')) {
          const key = String(mapping.sourceField).slice('custom:'.length);
          return csvEscape(customFields?.[key] ?? mapping.defaultValue ?? '');
        }
        const raw = r[mapping.sourceField as keyof TransactionRecord];
        let val: string;
        if (mapping.transform === 'currency') {
          val = Number(raw ?? 0).toFixed(2);
        } else if (mapping.transform === 'date' && typeof raw === 'number') {
          val = formatDate(raw);
        } else if (mapping.transform === 'uppercase') {
          val = String(raw ?? '').toUpperCase();
        } else if (mapping.transform === 'lowercase') {
          val = String(raw ?? '').toLowerCase();
        } else {
          val = String(raw ?? '');
        }
        return csvEscape(val);
      })
      .join(',');
  }

  if (format === 'quickbooks') {
    return [
      csvEscape(r.merchantId),
      csvEscape(r.subscriptionName),
      csvEscape(r.description ?? ''),
      csvEscape(customFields?.['quantity'] ?? '1'),
      csvEscape(r.amount.toFixed(2)),
      csvEscape(r.amount.toFixed(2)),
      csvEscape(r.currency.toUpperCase()),
      csvEscape(formatDate(r.billingDate)),
      csvEscape(r.billingCycle ?? ''),
    ].join(',');
  }
  if (format === 'xero') {
    return [
      csvEscape(r.merchantId),
      csvEscape(r.subscriptionId),
      csvEscape(formatDate(r.createdAt)),
      csvEscape(formatDate(r.billingDate)),
      csvEscape(r.subscriptionName),
      csvEscape(customFields?.['quantity'] ?? '1'),
      csvEscape(r.amount.toFixed(2)),
      csvEscape(customFields?.['accountCode'] ?? '400'),
      csvEscape(customFields?.['taxType'] ?? 'NONE'),
      csvEscape(r.currency.toUpperCase()),
    ].join(',');
  }
  // csv (generic)
  return [
    csvEscape(r.id),
    csvEscape(r.merchantId),
    csvEscape(r.subscriptionId),
    csvEscape(r.subscriptionName),
    csvEscape(r.description ?? ''),
    csvEscape(r.category ?? ''),
    csvEscape(r.transactionType),
    csvEscape(r.amount.toFixed(2)),
    csvEscape(r.currency.toUpperCase()),
    csvEscape(r.billingCycle ?? ''),
    csvEscape(formatDate(r.billingDate)),
    csvEscape((r.deferredRevenue ?? 0).toFixed(2)),
    csvEscape(formatDate(r.createdAt)),
  ].join(',');
}

function headersForFormat(
  format: AccountingFormat,
  fieldMappings?: CustomFieldMapping[]
): string[] {
  if (fieldMappings?.length) return fieldMappings.map((m) => m.targetField);
  if (format === 'quickbooks') return QB_HEADERS;
  if (format === 'xero') return XERO_HEADERS;
  return CSV_HEADERS;
}


// ── Excel 2003 XML Builder (SpreadsheetML) ────────────────────────────────────
function buildExcelXmlContent(records: TransactionRecord[], merchantId: string): string {
  const rows = records.map((r) => [
    '      <Row>',
    '        <Cell><Data ss:Type="String">' + r.id + '</Data></Cell>',
    '        <Cell><Data ss:Type="String">' + r.merchantId + '</Data></Cell>',
    '        <Cell><Data ss:Type="String">' + r.subscriptionId + '</Data></Cell>',
    '        <Cell><Data ss:Type="String">' + r.subscriptionName + '</Data></Cell>',
    '        <Cell><Data ss:Type="String">' + r.transactionType + '</Data></Cell>',
    '        <Cell><Data ss:Type="Number">' + r.amount.toFixed(2) + '</Data></Cell>',
    '        <Cell><Data ss:Type="String">' + r.currency.toUpperCase() + '</Data></Cell>',
    '        <Cell><Data ss:Type="String">' + formatDate(r.billingDate) + '</Data></Cell>',
    '      </Row>',
  ].join('\n')).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    '  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    '  <Styles>',
    '    <Style ss:ID="Header">',
    '      <Font ss:Bold="1" />',
    '      <Interior ss:Color="#EEEEEE" ss:Pattern="Solid" />',
    '    </Style>',
    '  </Styles>',
    '  <Worksheet ss:Name="Subscriptions">',
    '    <Table>',
    '      <Row ss:StyleID="Header">',
    '        <Cell><Data ss:Type="String">TransactionId</Data></Cell>',
    '        <Cell><Data ss:Type="String">MerchantId</Data></Cell>',
    '        <Cell><Data ss:Type="String">SubscriptionId</Data></Cell>',
    '        <Cell><Data ss:Type="String">SubscriptionName</Data></Cell>',
    '        <Cell><Data ss:Type="String">TransactionType</Data></Cell>',
    '        <Cell><Data ss:Type="String">Amount</Data></Cell>',
    '        <Cell><Data ss:Type="String">Currency</Data></Cell>',
    '        <Cell><Data ss:Type="String">BillingDate</Data></Cell>',
    '      </Row>',
    rows,
    '    </Table>',
    '  </Worksheet>',
    '</Workbook>',
  ].join('\n');
}

// ── QuickBooks IIF Builder (Intuit Interchange Format) ────────────────────────
function buildIifContent(records: TransactionRecord[]): string {
  const header = '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n!SPL\tSPLID\tSPLTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n!ENDTRNS\n';
  const transactions = records.map((r) => {
    const d = formatDate(r.billingDate);
    const amt = r.amount.toFixed(2);
    return 'TRNS\t' + r.id + '\tINVOICE\t' + d + '\tAccounts Receivable\t' + r.subscriptionName + '\t' + amt + '\t' + (r.description || '') + '\nSPL\t' + r.id + '_spl\tINVOICE\t' + d + '\tSubscription Income\t' + r.subscriptionName + '\t-' + amt + '\t' + (r.description || '') + '\nENDTRNS';
  }).join('\n');
  return header + transactions;
}

// ── Open Financial Exchange (OFX) Builder ─────────────────────────────────────
function buildOfxContent(records: TransactionRecord[], merchantId: string): string {
  const nowStr = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const trans = records.map((r) => {
    const dateStr = new Date(r.billingDate).toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const trnType = r.transactionType === 'refund' ? 'DEBIT' : 'CREDIT';
    return [
      '          <STMTTRN>',
      '            <TRNTYPE>' + trnType + '</TRNTYPE>',
      '            <DTPOSTED>' + dateStr + '</DTPOSTED>',
      '            <TRNAMT>' + r.amount.toFixed(2) + '</TRNAMT>',
      '            <FITID>' + r.id + '</FITID>',
      '            <NAME>' + r.subscriptionName + '</NAME>',
      '            <MEMO>' + (r.description || 'Subscription payment') + '</MEMO>',
      '          </STMTTRN>',
    ].join('\n');
  }).join('\n');

  return [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'VERSION:102',
    'SECURITY:NONE',
    'ENCODING:USASCII',
    'CHARSET:1252',
    'COMPRESSION:NONE',
    'OLDFILEVERSION:NONE',
    'NEWFILEVERSION:NONE',
    '',
    '<OFX>',
    '  <SIGNONMSGSRSV1>',
    '    <SONRS>',
    '      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>',
    '      <DTSERVER>' + nowStr + '</DTSERVER>',
    '      <LANGUAGE>ENG</LANGUAGE>',
    '    </SONRS>',
    '  </SIGNONMSGSRSV1>',
    '  <BANKMSGSRSV1>',
    '    <STMTTRNRS>',
    '      <TRNUID>1001</TRNUID>',
    '      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>',
    '      <STMTRS>',
    '        <CURDEF>' + (records[0]?.currency || 'USD').toUpperCase() + '</CURDEF>',
    '        <BANKACCTFROM>',
    '          <BANKID>SubTrackr</BANKID>',
    '          <ACCTID>' + merchantId + '</ACCTID>',
    '          <ACCTTYPE>CHECKING</ACCTTYPE>',
    '        </BANKACCTFROM>',
    '        <BANKTRANLIST>',
    '          <DTSTART>' + nowStr + '</DTSTART>',
    '          <DTEND>' + nowStr + '</DTEND>',
    trans,
    '        </BANKTRANLIST>',
    '      </STMTRS>',
    '    </STMTTRNRS>',
    '  </BANKMSGSRSV1>',
    '</OFX>',
  ].join('\n');
}

// ── PDF builder ───────────────────────────────────────────────────────────────

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Build a minimal valid single-page PDF from transaction records.
 * Zero-dependency: hand-written ASCII PDF streams (safe for all JS runtimes).
 */
function buildPdfContent(records: TransactionRecord[], merchantId: string): Buffer {
  const exportedAt = new Date().toISOString();

  const COL_ID = 14;
  const COL_NAME = 20;
  const COL_TYPE = 8;
  const COL_AMOUNT = 12;
  const COL_DATE = 12;

  const pad = (s: string, len: number) => s.slice(0, len).padEnd(len);

  const headerRow = [
    pad('TransactionId', COL_ID),
    pad('Name', COL_NAME),
    pad('Type', COL_TYPE),
    pad('Amount', COL_AMOUNT),
    pad('BillingDate', COL_DATE),
  ].join(' ');

  const lines: string[] = [
    `SubTrackr Subscription Export`,
    `Merchant: ${merchantId}`,
    `Generated: ${exportedAt}`,
    `Total records: ${records.length}`,
    '',
    headerRow,
    '-'.repeat(headerRow.length),
    ...records.map((r) =>
      [
        pad(r.id, COL_ID),
        pad(r.subscriptionName, COL_NAME),
        pad(r.transactionType, COL_TYPE),
        pad(`${r.currency.toUpperCase()} ${r.amount.toFixed(2)}`, COL_AMOUNT),
        pad(formatDate(r.billingDate), COL_DATE),
      ].join(' ')
    ),
  ];

  if (records.length === 0) {
    lines.push('(No records matched the export criteria)');
  }

  const fontSize = 9;
  const leading = 13;
  const marginTop = 770;
  const escaped = lines.map(escapePdfText);

  const streamBody = [
    'BT',
    `/F1 ${fontSize} Tf`,
    `${leading} TL`,
    `40 ${marginTop} Td`,
    ...escaped.flatMap((line, index) => (index === 0 ? [`(${line}) Tj`] : ['T*', `(${line}) Tj`])),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    `<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

// ── JSON Schema envelope ──────────────────────────────────────────────────────

const ACCOUNTING_JSON_SCHEMA_ID =
  'https://subtrackr.app/schemas/accounting-export.json';

function wrapJsonWithSchema(
  records: TransactionRecord[],
  merchantId: string
): string {
  return JSON.stringify(
    {
      $schema: ACCOUNTING_JSON_SCHEMA_ID,
      schemaVersion: '1.0.0',
      merchantId,
      exportedAt: new Date().toISOString().slice(0, 10),
      recordCount: records.length,
      records,
    },
    null,
    2
  );
}

// ── Filtering ─────────────────────────────────────────────────────────────────

function applyFilter(records: TransactionRecord[], filter: ExportFilter): TransactionRecord[] {
  return records.filter((r) => {
    if (filter.merchantId && r.merchantId !== filter.merchantId) return false;
    if (filter.dateFrom !== undefined && r.billingDate < filter.dateFrom) return false;
    if (filter.dateTo !== undefined && r.billingDate > filter.dateTo) return false;
    if (filter.transactionTypes?.length && !filter.transactionTypes.includes(r.transactionType))
      return false;
    return true;
  });
}

// ── Streaming export ──────────────────────────────────────────────────────────

/**
 * Stream-export a large set of transaction records in chunks.
 * Emits header first, then rows in batches to avoid memory pressure.
 * Supports CSV, QuickBooks, Xero, JSON, and PDF formats.
 */
export function streamExport(
  records: TransactionRecord[],
  options: StreamExportOptions
): { totalRecords: number; checksum: string } {
  const {
    format,
    filter = {},
    onChunk,
    chunkSize = 500,
    fieldMappings,
    customFields,
    includeSchema,
  } = options;
  const filtered = applyFilter(records, filter);
  const merchantId = filter.merchantId ?? (filtered[0]?.merchantId ?? 'unknown');

  if (format === 'pdf') {
    // PDF: build full document, emit as single string chunk
    const pdfBuffer = buildPdfContent(filtered, merchantId);
    onChunk(pdfBuffer.toString('latin1'));
  } else if (format === 'excel_xml') {
    onChunk(buildExcelXmlContent(filtered, merchantId));
  } else if (format === 'ofx') {
    onChunk(buildOfxContent(filtered, merchantId));
  } else if (format === 'iif') {
    onChunk(buildIifContent(filtered));
  } else if (format === 'ndjson') {
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      onChunk(batch.map((r) => JSON.stringify(r)).join('\n') + '\n');
    }
  } else if (format === 'tsv') {
    const headers = headersForFormat(format, fieldMappings);
    onChunk(headers.map(csvEscape).join('\t') + '\n');
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      onChunk(batch.map((r) => recordToCsvRow(r, 'csv', fieldMappings, customFields).replace(/,/g, '\t')).join('\n') + '\n');
    }
  } else if (format === 'json') {
    if (includeSchema) {
      // Emit schema-wrapped JSON; streaming with full envelope requires buffering for counts
      onChunk(wrapJsonWithSchema(filtered, merchantId));
    } else {
      // Stream JSON array in chunks
      onChunk('[');
      for (let i = 0; i < filtered.length; i += chunkSize) {
        const batch = filtered.slice(i, i + chunkSize);
        const separator = i === 0 ? '' : ',';
        onChunk(separator + batch.map((r) => JSON.stringify(r)).join(','));
      }
      onChunk(']');
    }
  } else {
    const headers = headersForFormat(format, fieldMappings);
    onChunk(headers.map(csvEscape).join(',') + '\n');
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      onChunk(batch.map((r) => recordToCsvRow(r, format, fieldMappings, customFields)).join('\n') + '\n');
    }
  }

  // Simple checksum over record IDs for reconciliation
  const cs = filtered.reduce(
    (acc, r) => acc ^ r.id.split('').reduce((h, c) => h + c.charCodeAt(0), 0),
    0
  );
  return { totalRecords: filtered.length, checksum: Math.abs(cs).toString(16) };
}

// ── Async-generator streaming export (Issue #768) ───────────────────────────

/**
 * Async-generator variant of `streamExport`.
 *
 * Yields string chunks lazily — the full result set is never held in memory at
 * once. Each yielded value is a self-contained fragment that can be piped
 * directly to an HTTP response or a file stream.
 *
 * ```ts
 * const gen = streamExportAsync(records, { format: 'csv' });
 * for await (const chunk of gen) {
 *   res.write(chunk);
 * }
 * ```
 */
export async function* streamExportAsync(
  records: TransactionRecord[],
  options: AsyncStreamExportOptions
): AsyncGenerator<string> {
  const { format, filter = {}, chunkSize = 500, memoryMonitor } = options;
  const filtered = applyFilter(records, filter);

  if (format === 'json') {
    yield '[';
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      const separator = i === 0 ? '' : ',';
      yield separator + batch.map((r) => JSON.stringify(r)).join(',');
      memoryMonitor?.check();
      // Yield to event loop between chunks to avoid blocking
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    yield ']';
  } else {
    const headers = headersForFormat(format);
    yield headers.map(csvEscape).join(',') + '\n';
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      yield batch.map((r) => recordToCsvRow(r, format)).join('\n') + '\n';
      memoryMonitor?.check();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}

/**
 * NDJSON streaming export — each record is its own JSON line.
 *
 * Suitable for endpoints that need line-by-line client parsing (e.g., the
 * `GET /subscriptions/stream` endpoint).
 */
export async function* streamExportNdjson(
  records: TransactionRecord[],
  options: Omit<AsyncStreamExportOptions, 'format'>
): AsyncGenerator<string> {
  const { filter = {}, chunkSize = 500, memoryMonitor } = options;
  const filtered = applyFilter(records, filter);

  for (let i = 0; i < filtered.length; i += chunkSize) {
    const batch = filtered.slice(i, i + chunkSize);
    for (const record of batch) {
      yield toNdjsonLine(record);
    }
    memoryMonitor?.check();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * Streaming export with per-chunk progress callbacks — intended for SSE
 * endpoints where the caller needs to emit `progress` events to the client
 * while the export is being built.
 *
 * Returns a summary `{ totalRecords, checksum }` once complete (same as
 * the synchronous `streamExport`).
 */
export async function streamExportWithProgress(
  records: TransactionRecord[],
  options: AsyncStreamExportOptions,
  onProgress: ExportProgressCallback
): Promise<{ totalRecords: number; checksum: string }> {
  const { format, filter = {}, chunkSize = 500, memoryMonitor } = options;
  const filtered = applyFilter(records, filter);
  const totalRecords = filtered.length;
  let chunkIndex = 0;

  let checksum = 0;

  const emitChunk = async (chunk: string, recordsProcessed: number) => {
    const percent = totalRecords === 0 ? 100 : Math.round((recordsProcessed / totalRecords) * 100);
    await onProgress({ percent, recordsProcessed, totalRecords, chunk, chunkIndex });
    chunkIndex++;
    memoryMonitor?.check();
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  if (format === 'json') {
    await emitChunk('[', 0);
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      const separator = i === 0 ? '' : ',';
      await emitChunk(separator + batch.map((r) => JSON.stringify(r)).join(','), i + batch.length);
    }
    await emitChunk(']', totalRecords);
  } else {
    const headers = headersForFormat(format);
    await emitChunk(headers.map(csvEscape).join(',') + '\n', 0);
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const batch = filtered.slice(i, i + chunkSize);
      await emitChunk(
        batch.map((r) => recordToCsvRow(r, format)).join('\n') + '\n',
        i + batch.length
      );
    }
  }

  checksum = filtered.reduce(
    (acc, r) => acc ^ r.id.split('').reduce((h, c) => h + c.charCodeAt(0), 0),
    0
  );

  return { totalRecords, checksum: Math.abs(checksum).toString(16) };
}

// ── Reconciliation ────────────────────────────────────────────────────────────

/**
 * Reconcile exported records against expected totals.
 * Returns mismatches where amount or type doesn't match expectations.
 */
export function reconcile(
  exported: TransactionRecord[],
  expected: Array<{ id: string; amount: number; transactionType: TransactionType }>
): ReconciliationResult {
  const exportedMap = new Map(exported.map((r) => [r.id, r]));
  const mismatches: Array<{ id: string; reason: string }> = [];
  let totalAmount = 0;

  for (const exp of expected) {
    const actual = exportedMap.get(exp.id);
    if (!actual) {
      mismatches.push({ id: exp.id, reason: 'missing from export' });
      continue;
    }
    if (Math.abs(actual.amount - exp.amount) > 0.001) {
      mismatches.push({
        id: exp.id,
        reason: `amount mismatch: expected ${exp.amount}, got ${actual.amount}`,
      });
    }
    if (actual.transactionType !== exp.transactionType) {
      mismatches.push({
        id: exp.id,
        reason: `type mismatch: expected ${exp.transactionType}, got ${actual.transactionType}`,
      });
    }
    totalAmount += actual.amount;
  }

  return {
    totalRecords: exported.length,
    totalAmount,
    mismatches,
    isBalanced: mismatches.length === 0,
  };
}

// ── Schedule management ───────────────────────────────────────────────────────

function generateId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function nextRunAtForFrequency(frequency: ExportFrequency, from: number): number {
  const next = new Date(from);
  if (frequency === 'daily') next.setDate(next.getDate() + 1);
  if (frequency === 'weekly') next.setDate(next.getDate() + 7);
  if (frequency === 'monthly') next.setMonth(next.getMonth() + 1);
  return next.getTime();
}

export function createExportSchedule(input: ExportScheduleInput): ExportSchedule {
  const now = Date.now();
  const schedule: ExportSchedule = {
    ...input,
    id: generateId('schedule'),
    createdAt: now,
    updatedAt: now,
  };
  scheduleStore.push(schedule);
  return schedule;
}

export function getExportSchedules(merchantId?: string): ExportSchedule[] {
  return merchantId ? scheduleStore.filter((s) => s.merchantId === merchantId) : [...scheduleStore];
}

export function updateExportSchedule(
  id: string,
  patch: Partial<Omit<ExportSchedule, 'id' | 'createdAt'>>
): ExportSchedule | null {
  const index = scheduleStore.findIndex((s) => s.id === id);
  if (index < 0) return null;
  const updated = { ...scheduleStore[index]!, ...patch, updatedAt: Date.now() };
  scheduleStore[index] = updated;
  return updated;
}

export function deleteExportSchedule(id: string): boolean {
  const index = scheduleStore.findIndex((s) => s.id === id);
  if (index < 0) return false;
  scheduleStore.splice(index, 1);
  return true;
}

export function toggleExportSchedule(id: string, enabled: boolean): ExportSchedule | null {
  return updateExportSchedule(id, { enabled });
}

/**
 * Run all due schedules against a provided record set.
 * Advances `nextRunAt` for each executed schedule.
 */
export function runDueExports(
  records: TransactionRecord[],
  now = Date.now()
): Array<{ schedule: ExportSchedule; result: { totalRecords: number; checksum: string } }> {
  const due = scheduleStore.filter((s) => s.enabled && s.nextRunAt <= now);
  const results: Array<{ schedule: ExportSchedule; result: { totalRecords: number; checksum: string } }> = [];

  for (const schedule of due) {
    const chunks: string[] = [];
    const result = streamExport(records, {
      format: schedule.format,
      filter: { merchantId: schedule.merchantId },
      onChunk: (c) => chunks.push(c),
      fieldMappings: schedule.fieldMappings,
      customFields: schedule.customFields,
    });

    const index = scheduleStore.findIndex((s) => s.id === schedule.id);
    if (index >= 0) {
      scheduleStore[index] = {
        ...scheduleStore[index]!,
        lastRunAt: now,
        nextRunAt: nextRunAtForFrequency(schedule.frequency, now),
        updatedAt: now,
      };
    }

    const historyEntry: ExportHistoryEntry = {
      id: generateId('history'),
      merchantId: schedule.merchantId,
      format: schedule.format,
      status: 'success',
      itemCount: result.totalRecords,
      checksum: result.checksum,
      scheduleId: schedule.id,
      downloadCount: 0,
      createdAt: now,
    };
    historyStore.push(historyEntry);

    results.push({ schedule, result });
  }

  return results;
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export function recordExportDownload(exportId: string): ExportHistoryEntry | null {
  const index = historyStore.findIndex((e) => e.id === exportId);
  if (index < 0) return null;
  const now = Date.now();
  const updated: ExportHistoryEntry = {
    ...historyStore[index]!,
    downloadCount: (historyStore[index]!.downloadCount ?? 0) + 1,
    lastDownloadedAt: now,
  };
  historyStore[index] = updated;
  return updated;
}

export function getExportHistory(merchantId?: string): ExportHistoryEntry[] {
  return merchantId ? historyStore.filter((e) => e.merchantId === merchantId) : [...historyStore];
}

export function getExportAnalytics(merchantId?: string): ExportAnalytics {
  const relevant = merchantId
    ? historyStore.filter((e) => e.merchantId === merchantId)
    : historyStore;

  const formatBreakdown: Record<AccountingFormat, number> = {
    csv: 0,
    json: 0,
    quickbooks: 0,
    xero: 0,
    pdf: 0,
    excel_xml: 0,
    ndjson: 0,
    ofx: 0,
    iif: 0,
    tsv: 0,
  };

  let totalDownloads = 0;
  let successCount = 0;
  let failedCount = 0;
  let totalItemsExported = 0;

  for (const entry of relevant) {
    if (entry.status === 'success') {
      successCount += 1;
      totalItemsExported += entry.itemCount;
    } else {
      failedCount += 1;
    }
    totalDownloads += entry.downloadCount ?? 0;
    formatBreakdown[entry.format] = (formatBreakdown[entry.format] ?? 0) + 1;
  }

  return {
    totalExports: relevant.length,
    totalDownloads,
    successCount,
    failedCount,
    totalItemsExported,
    formatBreakdown,
  };
}
