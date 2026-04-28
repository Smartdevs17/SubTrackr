import AsyncStorage from '@react-native-async-storage/async-storage';
import { BillingCycle, Subscription } from '../types/subscription';

export type MerchantId = string;
export type AccountingFormat = 'quickbooks' | 'xero';
export type ExportFrequency = 'daily' | 'weekly' | 'monthly';
export type ExportDestination = 'download' | 'email' | 'webhook';
export type ExportStatus = 'success' | 'failed';

export type AccountingSourceField =
  | 'merchantId'
  | 'subscriptionId'
  | 'subscriptionName'
  | 'description'
  | 'category'
  | 'price'
  | 'currency'
  | 'billingCycle'
  | 'nextBillingDate'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | `custom:${string}`;

export type AccountingTransform = 'none' | 'uppercase' | 'lowercase' | 'currency' | 'date';

export interface AccountingFieldMapping {
  targetField: string;
  sourceField: AccountingSourceField;
  defaultValue?: string;
  transform?: AccountingTransform;
}

export interface ExportSchedule {
  id: string;
  merchantId: MerchantId;
  format: AccountingFormat;
  frequency: ExportFrequency;
  destination: ExportDestination;
  enabled: boolean;
  includeInactive: boolean;
  fieldMappings: AccountingFieldMapping[];
  customFields: Record<string, string>;
  nextRunAt: number;
  lastRunAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type ExportScheduleInput = {
  merchantId: MerchantId;
  format: AccountingFormat;
  frequency: ExportFrequency;
  destination?: ExportDestination;
  enabled?: boolean;
  includeInactive?: boolean;
  fieldMappings?: AccountingFieldMapping[];
  customFields?: Record<string, string>;
  nextRunAt?: number;
};

export interface ExportHistoryEntry {
  id: string;
  merchantId: MerchantId;
  format: AccountingFormat;
  status: ExportStatus;
  itemCount: number;
  fileName?: string;
  checksum?: string;
  scheduleId?: string;
  error?: string;
  createdAt: number;
}

export interface ExportResult {
  exportId: string;
  merchantId: MerchantId;
  format: AccountingFormat;
  status: ExportStatus;
  fileName: string;
  mimeType: 'text/csv';
  content: string;
  itemCount: number;
  checksum: string;
  historyEntry: ExportHistoryEntry;
}

export interface ExportOptions {
  subscriptions?: Subscription[];
  includeInactive?: boolean;
  fieldMappings?: AccountingFieldMapping[];
  customFields?: Record<string, string>;
  scheduleId?: string;
  now?: number;
}

export interface ScheduledExportRun {
  schedule: ExportSchedule;
  result: ExportResult;
}

const HISTORY_STORAGE_KEY = 'subtrackr-accounting-export-history';
const SCHEDULE_STORAGE_KEY = 'subtrackr-accounting-export-schedules';
const MAX_HISTORY_ITEMS = 50;

const quickBooksDefaultMapping: AccountingFieldMapping[] = [
  { targetField: 'Customer', sourceField: 'merchantId' },
  { targetField: 'Product/Service', sourceField: 'subscriptionName' },
  { targetField: 'Description', sourceField: 'description' },
  { targetField: 'Qty', sourceField: 'custom:quantity', defaultValue: '1' },
  { targetField: 'Rate', sourceField: 'price', transform: 'currency' },
  { targetField: 'Amount', sourceField: 'price', transform: 'currency' },
  { targetField: 'Currency', sourceField: 'currency', transform: 'uppercase' },
  { targetField: 'Service Date', sourceField: 'nextBillingDate', transform: 'date' },
  { targetField: 'Memo', sourceField: 'billingCycle' },
];

const xeroDefaultMapping: AccountingFieldMapping[] = [
  { targetField: 'ContactName', sourceField: 'merchantId' },
  { targetField: 'InvoiceNumber', sourceField: 'subscriptionId' },
  { targetField: 'InvoiceDate', sourceField: 'createdAt', transform: 'date' },
  { targetField: 'DueDate', sourceField: 'nextBillingDate', transform: 'date' },
  { targetField: 'Description', sourceField: 'subscriptionName' },
  { targetField: 'Quantity', sourceField: 'custom:quantity', defaultValue: '1' },
  { targetField: 'UnitAmount', sourceField: 'price', transform: 'currency' },
  { targetField: 'AccountCode', sourceField: 'custom:accountCode', defaultValue: '400' },
  { targetField: 'TaxType', sourceField: 'custom:taxType', defaultValue: 'NONE' },
  { targetField: 'Currency', sourceField: 'currency', transform: 'uppercase' },
];

function generateId(prefix: string, now = Date.now()): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${now.toString(36)}_${random}`;
}

function normalizeDate(value: Date | string | number | undefined): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

function formatDate(value: Date | string | number | undefined): string {
  return normalizeDate(value).toISOString().slice(0, 10);
}

function formatBillingCycle(cycle: BillingCycle): string {
  return cycle.replace(/_/g, ' ');
}

function csvEscape(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(csvEscape).join(',');
  const rowLines = rows.map((row) => row.map(csvEscape).join(','));
  return [headerLine, ...rowLines].join('\n');
}

function checksum(content: string): string {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = (hash << 5) - hash + content.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function getDefaultMapping(format: AccountingFormat): AccountingFieldMapping[] {
  return format === 'quickbooks' ? quickBooksDefaultMapping : xeroDefaultMapping;
}

function getSourceValue(
  subscription: Subscription,
  mapping: AccountingFieldMapping,
  merchantId: MerchantId,
  customFields: Record<string, string>
): string | number | boolean | Date | undefined {
  if (mapping.sourceField.startsWith('custom:')) {
    const key = mapping.sourceField.slice('custom:'.length);
    return customFields[key] ?? mapping.defaultValue;
  }

  switch (mapping.sourceField) {
    case 'merchantId':
      return merchantId;
    case 'subscriptionId':
      return subscription.id;
    case 'subscriptionName':
      return subscription.name;
    case 'description':
      return subscription.description ?? mapping.defaultValue;
    case 'category':
      return subscription.category;
    case 'price':
      return subscription.price;
    case 'currency':
      return subscription.currency;
    case 'billingCycle':
      return formatBillingCycle(subscription.billingCycle);
    case 'nextBillingDate':
      return subscription.nextBillingDate;
    case 'status':
      return subscription.isActive ? 'active' : 'inactive';
    case 'createdAt':
      return subscription.createdAt;
    case 'updatedAt':
      return subscription.updatedAt;
    default:
      return mapping.defaultValue;
  }
}

function applyTransform(
  value: string | number | boolean | Date | undefined,
  transform: AccountingTransform | undefined
): string {
  if (value === undefined) return '';
  if (transform === 'currency') return Number(value || 0).toFixed(2);
  if (transform === 'date') return formatDate(value as Date | string | number);

  const text = String(value);
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  return text;
}

function buildRows(
  subscriptions: Subscription[],
  merchantId: MerchantId,
  mappings: AccountingFieldMapping[],
  customFields: Record<string, string>
): string[][] {
  return subscriptions.map((subscription) =>
    mappings.map((mapping) =>
      applyTransform(
        getSourceValue(subscription, mapping, merchantId, customFields),
        mapping.transform
      )
    )
  );
}

function buildFileName(merchantId: MerchantId, format: AccountingFormat, now: number): string {
  const safeMerchant = merchantId.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  return `${safeMerchant}-${format}-subscription-export-${formatDate(now)}.csv`;
}

function nextRunAtForFrequency(frequency: ExportFrequency, from: number): number {
  const next = new Date(from);
  if (frequency === 'daily') next.setDate(next.getDate() + 1);
  if (frequency === 'weekly') next.setDate(next.getDate() + 7);
  if (frequency === 'monthly') next.setMonth(next.getMonth() + 1);
  return next.getTime();
}

async function readJsonArray<T>(key: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeJsonArray<T>(key: string, values: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(values));
}

async function recordHistory(entry: ExportHistoryEntry): Promise<void> {
  const history = await readJsonArray<ExportHistoryEntry>(HISTORY_STORAGE_KEY);
  await writeJsonArray(HISTORY_STORAGE_KEY, [entry, ...history].slice(0, MAX_HISTORY_ITEMS));
}

export function getAccountingDefaultMapping(format: AccountingFormat): AccountingFieldMapping[] {
  return getDefaultMapping(format).map((mapping) => ({ ...mapping }));
}

export function buildAccountingExportCsv(
  subscriptions: Subscription[],
  merchantId: MerchantId,
  format: AccountingFormat,
  options: Pick<ExportOptions, 'fieldMappings' | 'customFields' | 'includeInactive'> = {}
): string {
  const selectedSubscriptions = options.includeInactive
    ? subscriptions
    : subscriptions.filter((subscription) => subscription.isActive);
  const mappings = options.fieldMappings?.length
    ? options.fieldMappings
    : getDefaultMapping(format);
  const headers = mappings.map((mapping) => mapping.targetField);
  const rows = buildRows(selectedSubscriptions, merchantId, mappings, options.customFields ?? {});
  return buildCsv(headers, rows);
}

export async function export_to_accounting(
  merchant_id: MerchantId,
  format: AccountingFormat,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const now = options.now ?? Date.now();
  const subscriptions = options.subscriptions ?? [];

  try {
    const content = buildAccountingExportCsv(subscriptions, merchant_id, format, options);
    const selectedCount = options.includeInactive
      ? subscriptions.length
      : subscriptions.filter((subscription) => subscription.isActive).length;
    const exportId = generateId('accounting_export', now);
    const fileName = buildFileName(merchant_id, format, now);
    const contentChecksum = checksum(content);
    const historyEntry: ExportHistoryEntry = {
      id: exportId,
      merchantId: merchant_id,
      format,
      status: 'success',
      itemCount: selectedCount,
      fileName,
      checksum: contentChecksum,
      scheduleId: options.scheduleId,
      createdAt: now,
    };

    await recordHistory(historyEntry);

    return {
      exportId,
      merchantId: merchant_id,
      format,
      status: 'success',
      fileName,
      mimeType: 'text/csv',
      content,
      itemCount: selectedCount,
      checksum: contentChecksum,
      historyEntry,
    };
  } catch (error) {
    const exportId = generateId('accounting_export_failed', now);
    const historyEntry: ExportHistoryEntry = {
      id: exportId,
      merchantId: merchant_id,
      format,
      status: 'failed',
      itemCount: 0,
      scheduleId: options.scheduleId,
      error: error instanceof Error ? error.message : String(error),
      createdAt: now,
    };
    await recordHistory(historyEntry);
    throw error;
  }
}

export async function schedule_export(config: ExportScheduleInput): Promise<ExportSchedule> {
  const now = Date.now();
  const schedule: ExportSchedule = {
    id: generateId('accounting_schedule', now),
    merchantId: config.merchantId,
    format: config.format,
    frequency: config.frequency,
    destination: config.destination ?? 'download',
    enabled: config.enabled ?? true,
    includeInactive: config.includeInactive ?? false,
    fieldMappings: config.fieldMappings?.length
      ? config.fieldMappings
      : getDefaultMapping(config.format),
    customFields: config.customFields ?? {},
    nextRunAt: config.nextRunAt ?? nextRunAtForFrequency(config.frequency, now),
    createdAt: now,
    updatedAt: now,
  };

  const schedules = await readJsonArray<ExportSchedule>(SCHEDULE_STORAGE_KEY);
  await writeJsonArray(SCHEDULE_STORAGE_KEY, [schedule, ...schedules]);
  return schedule;
}

export async function get_export_schedules(): Promise<ExportSchedule[]> {
  return readJsonArray<ExportSchedule>(SCHEDULE_STORAGE_KEY);
}

export async function update_export_schedule(schedule: ExportSchedule): Promise<ExportSchedule> {
  const schedules = await readJsonArray<ExportSchedule>(SCHEDULE_STORAGE_KEY);
  const updated = { ...schedule, updatedAt: Date.now() };
  const nextSchedules = schedules.map((item) => (item.id === schedule.id ? updated : item));
  await writeJsonArray(SCHEDULE_STORAGE_KEY, nextSchedules);
  return updated;
}

export async function get_export_history(merchantId?: MerchantId): Promise<ExportHistoryEntry[]> {
  const history = await readJsonArray<ExportHistoryEntry>(HISTORY_STORAGE_KEY);
  return merchantId ? history.filter((entry) => entry.merchantId === merchantId) : history;
}

export async function run_due_exports(
  subscriptions: Subscription[],
  now = Date.now()
): Promise<ScheduledExportRun[]> {
  const schedules = await readJsonArray<ExportSchedule>(SCHEDULE_STORAGE_KEY);
  const dueSchedules = schedules.filter(
    (schedule) => schedule.enabled && schedule.nextRunAt <= now
  );
  const runs: ScheduledExportRun[] = [];
  const updatedSchedules = [...schedules];

  for (const schedule of dueSchedules) {
    const result = await export_to_accounting(schedule.merchantId, schedule.format, {
      subscriptions,
      includeInactive: schedule.includeInactive,
      fieldMappings: schedule.fieldMappings,
      customFields: schedule.customFields,
      scheduleId: schedule.id,
      now,
    });

    runs.push({ schedule, result });

    const index = updatedSchedules.findIndex((item) => item.id === schedule.id);
    if (index >= 0) {
      updatedSchedules[index] = {
        ...updatedSchedules[index],
        lastRunAt: now,
        nextRunAt: nextRunAtForFrequency(schedule.frequency, now),
        updatedAt: now,
      };
    }
  }

  if (dueSchedules.length > 0) {
    await writeJsonArray(SCHEDULE_STORAGE_KEY, updatedSchedules);
  }

  return runs;
}

export async function clear_accounting_export_data(): Promise<void> {
  await AsyncStorage.multiRemove([HISTORY_STORAGE_KEY, SCHEDULE_STORAGE_KEY]);
}

export const AccountingExport = {
  exportToAccounting: export_to_accounting,
  export_to_accounting,
  scheduleExport: schedule_export,
  schedule_export,
  getSchedules: get_export_schedules,
  getHistory: get_export_history,
  runDueExports: run_due_exports,
  getDefaultMapping: getAccountingDefaultMapping,
};
