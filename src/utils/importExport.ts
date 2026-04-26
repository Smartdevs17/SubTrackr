/**
 * Import/Export Utilities for Subscriptions
 * Supports CSV import with column mapping and JSON export
 */

import { Subscription, SubscriptionCategory, BillingCycle } from '../types/subscription';

// ============================================
// Types
// ============================================

export interface ImportData {
  subscriptions: SubscriptionInput[];
  mode: ImportMode;
}

export interface SubscriptionInput {
  id?: string;
  name: string;
  description?: string;
  category: string;
  price: number;
  currency: string;
  billingCycle: string;
  nextBillingDate: string;
  isActive?: boolean;
  notificationsEnabled?: boolean;
  isCryptoEnabled?: boolean;
  cryptoToken?: string;
  cryptoAmount?: number;
}

export type ImportMode = 'create' | 'upsert' | 'replace';

export interface ImportResult {
  success: boolean;
  imported: number;
  updated: number;
  failed: number;
  errors: ImportError[];
  warnings: ImportWarning[];
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
  value?: string;
}

export interface ImportWarning {
  row: number;
  field: string;
  message: string;
  value?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ImportError[];
  warnings: ImportWarning[];
  validRows: SubscriptionInput[];
}

export interface ExportData {
  version: string;
  exportedAt: string;
  subscriptionCount: number;
  subscriptions: Subscription[];
}

export interface ColumnMapping {
  csvColumn: string;
  fieldName: keyof SubscriptionInput;
  required: boolean;
  transform?: (value: string) => unknown;
}

export interface ImportHistoryEntry {
  id: string;
  timestamp: string;
  fileName: string;
  mode: ImportMode;
  totalRows: number;
  imported: number;
  updated: number;
  failed: number;
  status: 'success' | 'partial' | 'failed';
}

// ============================================
// Constants
// ============================================

export const CSV_COLUMN_MAPPING: ColumnMapping[] = [
  { csvColumn: 'name', fieldName: 'name', required: true },
  { csvColumn: 'description', fieldName: 'description', required: false },
  { csvColumn: 'category', fieldName: 'category', required: true },
  { csvColumn: 'price', fieldName: 'price', required: true, transform: parseFloat },
  { csvColumn: 'currency', fieldName: 'currency', required: false },
  { csvColumn: 'billingCycle', fieldName: 'billingCycle', required: true },
  { csvColumn: 'nextBillingDate', fieldName: 'nextBillingDate', required: true },
  { csvColumn: 'isActive', fieldName: 'isActive', required: false, transform: parseBoolean },
  { csvColumn: 'notificationsEnabled', fieldName: 'notificationsEnabled', required: false, transform: parseBoolean },
  { csvColumn: 'isCryptoEnabled', fieldName: 'isCryptoEnabled', required: false, transform: parseBoolean },
  { csvColumn: 'cryptoToken', fieldName: 'cryptoToken', required: false },
  { csvColumn: 'cryptoAmount', fieldName: 'cryptoAmount', required: false, transform: parseFloat },
];

export const VALID_CATEGORIES = Object.values(SubscriptionCategory);
export const VALID_BILLING_CYCLES = Object.values(BillingCycle);
export const VALID_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'XLM'];

const EXPORT_VERSION = '1.0.0';
const HISTORY_KEY = 'subtrackr-import-history';
const MAX_HISTORY_ENTRIES = 50;

// ============================================
// Helper Functions
// ============================================

function parseBoolean(value: string): boolean {
  const lower = value.toLowerCase().trim();
  return lower === 'true' || lower === '1' || lower === 'yes';
}

function generateUniqueId(): string {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomComponent}`;
}

function generateHistoryId(): string {
  return `import-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function normalizeCategory(value: string): SubscriptionCategory {
  const normalized = value.toLowerCase().trim() as SubscriptionCategory;
  if (VALID_CATEGORIES.includes(normalized)) {
    return normalized;
  }
  // Try to match by partial string
  for (const cat of VALID_CATEGORIES) {
    if (cat.includes(normalized) || normalized.includes(cat)) {
      return cat;
    }
  }
  return SubscriptionCategory.OTHER;
}

function normalizeBillingCycle(value: string): BillingCycle {
  const normalized = value.toLowerCase().trim() as BillingCycle;
  if (VALID_BILLING_CYCLES.includes(normalized)) {
    return normalized;
  }
  // Try common variations
  const cycleMap: Record<string, BillingCycle> = {
    'month': BillingCycle.MONTHLY,
    'year': BillingCycle.YEARLY,
    'week': BillingCycle.WEEKLY,
    'custom': BillingCycle.CUSTOM,
  };
  for (const [key, cycle] of Object.entries(cycleMap)) {
    if (normalized.includes(key)) {
      return cycle;
    }
  }
  return BillingCycle.MONTHLY;
}

function parseDate(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  // Try common formats
  const formats = [
    /^(\d{4})-(\d{2})-(\d{2})$/, // YYYY-MM-DD
    /^(\d{2})\/(\d{2})\/(\d{4})$/, // MM/DD/YYYY
    /^(\d{2})-(\d{2})-(\d{4})$/, // DD-MM-YYYY
  ];
  
  for (const format of formats) {
    const match = value.match(format);
    if (match) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }
  
  return new Date(); // Default to current date
}

// ============================================
// CSV Parsing
// ============================================

/**
 * Parse CSV string into array of subscription objects
 */
export function parseCSV(csvContent: string): SubscriptionInput[] {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim());
  
  if (lines.length < 2) {
    throw new Error('CSV must contain at least a header row and one data row');
  }

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);
  
  // Create header to field mapping
  const headerMap = new Map<string, number>();
  headers.forEach((header, index) => {
    headerMap.set(header.toLowerCase().trim(), index);
  });

  const subscriptions: SubscriptionInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || values.every(v => !v.trim())) {
      continue; // Skip empty rows
    }

    const subscription: Partial<SubscriptionInput> = {};
    
    for (const mapping of CSV_COLUMN_MAPPING) {
      const columnIndex = headerMap.get(mapping.csvColumn.toLowerCase());
      if (columnIndex !== undefined && values[columnIndex]) {
        const rawValue = values[columnIndex];
        const value = mapping.transform ? 
          String(mapping.transform(rawValue)) : 
          rawValue;
        
        (subscription as Record<string, unknown>)[mapping.fieldName] = value;
      }
    }

    if (subscription.name) {
      subscriptions.push(subscription as SubscriptionInput);
    }
  }

  return subscriptions;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Generate CSV from subscriptions
 */
export function generateCSV(subscriptions: Subscription[]): string {
  const headers = CSV_COLUMN_MAPPING.map(m => m.csvColumn);
  const rows = subscriptions.map(sub => {
    return CSV_COLUMN_MAPPING.map(mapping => {
      const value = sub[mapping.fieldName as keyof Subscription];
      if (value === undefined || value === null) {
        return '';
      }
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      if (value instanceof Date) {
        return value.toISOString().split('T')[0];
      }
      return String(value);
    }).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

// ============================================
// JSON Export
// ============================================

/**
 * Export subscriptions to JSON format
 */
export function exportToJSON(subscriptions: Subscription[]): string {
  const exportData: ExportData = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    subscriptionCount: subscriptions.length,
    subscriptions: subscriptions.map(sub => ({
      ...sub,
      nextBillingDate: sub.nextBillingDate instanceof Date ? 
        sub.nextBillingDate : 
        new Date(sub.nextBillingDate as unknown as string),
      createdAt: sub.createdAt instanceof Date ? 
        sub.createdAt : 
        new Date(sub.createdAt as unknown as string),
      updatedAt: sub.updatedAt instanceof Date ? 
        sub.updatedAt : 
        new Date(sub.updatedAt as unknown as string),
    })),
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Parse JSON import data
 */
export function parseJSON(jsonContent: string): SubscriptionInput[] {
  const data = JSON.parse(jsonContent);
  
  // Handle both direct array and wrapped export format
  let subscriptions: Subscription[] | SubscriptionInput[];
  
  if (Array.isArray(data)) {
    subscriptions = data;
  } else if (data.subscriptions && Array.isArray(data.subscriptions)) {
    subscriptions = data.subscriptions;
  } else {
    throw new Error('Invalid JSON format: expected array or export object');
  }

  return subscriptions.map(sub => ({
    id: sub.id,
    name: sub.name,
    description: sub.description,
    category: typeof sub.category === 'string' ? sub.category : SubscriptionCategory.OTHER,
    price: Number(sub.price) || 0,
    currency: sub.currency || 'USD',
    billingCycle: typeof sub.billingCycle === 'string' ? sub.billingCycle : BillingCycle.MONTHLY,
    nextBillingDate: sub.nextBillingDate ? new Date(sub.nextBillingDate).toISOString() : new Date().toISOString(),
    isActive: sub.isActive,
    notificationsEnabled: sub.notificationsEnabled,
    isCryptoEnabled: sub.isCryptoEnabled,
    cryptoToken: sub.cryptoToken,
    cryptoAmount: sub.cryptoAmount,
  }));
}

// ============================================
// Validation
// ============================================

/**
 * Validate import data
 */
export function validateImport(data: ImportData): ValidationResult {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const validRows: SubscriptionInput[] = [];

  data.subscriptions.forEach((subscription, index) => {
    const rowNum = index + 1;

    // Required field validation
    if (!subscription.name || subscription.name.trim() === '') {
      errors.push({
        row: rowNum,
        field: 'name',
        message: 'Name is required',
        value: subscription.name,
      });
      return;
    }

    // Category validation
    if (!subscription.category) {
      errors.push({
        row: rowNum,
        field: 'category',
        message: 'Category is required',
        value: subscription.category,
      });
    } else if (!VALID_CATEGORIES.includes(subscription.category.toLowerCase() as SubscriptionCategory)) {
      warnings.push({
        row: rowNum,
        field: 'category',
        message: `Invalid category "${subscription.category}", defaulting to "other"`,
        value: subscription.category,
      });
    }

    // Price validation
    if (subscription.price === undefined || subscription.price === null) {
      errors.push({
        row: rowNum,
        field: 'price',
        message: 'Price is required',
        value: String(subscription.price),
      });
      return;
    }

    if (isNaN(subscription.price) || subscription.price < 0) {
      errors.push({
        row: rowNum,
        field: 'price',
        message: 'Price must be a valid positive number',
        value: String(subscription.price),
      });
      return;
    }

    // Billing cycle validation
    if (!subscription.billingCycle) {
      errors.push({
        row: rowNum,
        field: 'billingCycle',
        message: 'Billing cycle is required',
        value: subscription.billingCycle,
      });
    } else if (!VALID_BILLING_CYCLES.includes(subscription.billingCycle.toLowerCase() as BillingCycle)) {
      warnings.push({
        row: rowNum,
        field: 'billingCycle',
        message: `Invalid billing cycle "${subscription.billingCycle}", defaulting to "monthly"`,
        value: subscription.billingCycle,
      });
    }

    // Currency validation
    if (subscription.currency && !VALID_CURRENCIES.includes(subscription.currency.toUpperCase())) {
      warnings.push({
        row: rowNum,
        field: 'currency',
        message: `Non-standard currency "${subscription.currency}"`,
        value: subscription.currency,
      });
    }

    // Date validation
    if (subscription.nextBillingDate) {
      const date = new Date(subscription.nextBillingDate);
      if (Number.isNaN(date.getTime())) {
        errors.push({
          row: rowNum,
          field: 'nextBillingDate',
          message: 'Invalid date format',
          value: subscription.nextBillingDate,
        });
        return;
      }
    }

    // Crypto validation
    if (subscription.isCryptoEnabled && !subscription.cryptoToken) {
      warnings.push({
        row: rowNum,
        field: 'cryptoToken',
        message: 'Crypto enabled but no token specified',
        value: subscription.cryptoToken,
      });
    }

    validRows.push(subscription);
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    validRows,
  };
}

// ============================================
// Import Processing
// ============================================

/**
 * Process import with validation
 */
export function processImport(
  data: ImportData,
  existingSubscriptions: Subscription[]
): ImportResult {
  const validation = validateImport(data);
  
  if (validation.validRows.length === 0 && validation.errors.length > 0) {
    return {
      success: false,
      imported: 0,
      updated: 0,
      failed: data.subscriptions.length,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  let imported = 0;
  let updated = 0;
  const errors: ImportError[] = [...validation.errors];
  const warnings: ImportWarning[] = [...validation.warnings];

  // Create lookup for existing subscriptions
  const existingByName = new Map<string, Subscription>();
  const existingById = new Map<string, Subscription>();
  
  existingSubscriptions.forEach(sub => {
    existingByName.set(sub.name.toLowerCase(), sub);
    if (sub.id) {
      existingById.set(sub.id, sub);
    }
  });

  const processedSubscriptions: Subscription[] = [];

  validation.validRows.forEach((input, index) => {
    const rowNum = index + 1;
    const now = new Date();

    try {
      // Check for duplicates
      const existingByNameMatch = existingByName.get(input.name.toLowerCase());
      const existingByIdMatch = input.id ? existingById.get(input.id) : null;
      const isUpdate = (existingByNameMatch || existingByIdMatch) && data.mode === 'upsert';
      const isReplace = data.mode === 'replace';

      if (isUpdate || isReplace) {
        // Update existing
        const existing = existingByIdMatch || existingByNameMatch;
        if (existing) {
          const updated: Subscription = {
            ...existing,
            name: input.name,
            description: input.description,
            category: normalizeCategory(input.category),
            price: input.price,
            currency: input.currency?.toUpperCase() || 'USD',
            billingCycle: normalizeBillingCycle(input.billingCycle),
            nextBillingDate: parseDate(input.nextBillingDate),
            isActive: input.isActive ?? existing.isActive,
            notificationsEnabled: input.notificationsEnabled ?? existing.notificationsEnabled,
            isCryptoEnabled: input.isCryptoEnabled ?? existing.isCryptoEnabled,
            cryptoToken: input.cryptoToken ?? existing.cryptoToken,
            cryptoAmount: input.cryptoAmount ?? existing.cryptoAmount,
            updatedAt: now,
          };
          processedSubscriptions.push(updated);
          updated++;
        }
      } else {
        // Create new
        const newSubscription: Subscription = {
          id: input.id || generateUniqueId(),
          name: input.name,
          description: input.description,
          category: normalizeCategory(input.category),
          price: input.price,
          currency: input.currency?.toUpperCase() || 'USD',
          billingCycle: normalizeBillingCycle(input.billingCycle),
          nextBillingDate: parseDate(input.nextBillingDate),
          isActive: input.isActive ?? true,
          notificationsEnabled: input.notificationsEnabled ?? true,
          isCryptoEnabled: input.isCryptoEnabled ?? false,
          cryptoToken: input.cryptoToken,
          cryptoAmount: input.cryptoAmount,
          createdAt: now,
          updatedAt: now,
        };
        processedSubscriptions.push(newSubscription);
        imported++;
      }
    } catch (err) {
      errors.push({
        row: rowNum,
        field: 'general',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  return {
    success: errors.length === 0,
    imported,
    updated,
    failed: data.subscriptions.length - imported - updated,
    errors,
    warnings,
  };
}

// ============================================
// Import History
// ============================================

/**
 * Get import history from storage
 */
export async function getImportHistory(): Promise<ImportHistoryEntry[]> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const historyJson = await AsyncStorage.getItem(HISTORY_KEY);
    if (historyJson) {
      return JSON.parse(historyJson);
    }
  } catch (error) {
    console.error('Failed to get import history:', error);
  }
  return [];
}

/**
 * Save import history entry
 */
export async function saveImportHistory(entry: ImportHistoryEntry): Promise<void> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const history = await getImportHistory();
    
    history.unshift(entry);
    
    // Keep only last N entries
    const trimmedHistory = history.slice(0, MAX_HISTORY_ENTRIES);
    
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(trimmedHistory));
  } catch (error) {
    console.error('Failed to save import history:', error);
  }
}

/**
 * Create and save import history entry
 */
export async function recordImport(
  fileName: string,
  mode: ImportMode,
  totalRows: number,
  result: ImportResult
): Promise<void> {
  const entry: ImportHistoryEntry = {
    id: generateHistoryId(),
    timestamp: new Date().toISOString(),
    fileName,
    mode,
    totalRows,
    imported: result.imported,
    updated: result.updated,
    failed: result.failed,
    status: result.success ? 'success' : result.failed === totalRows ? 'failed' : 'partial',
  };

  await saveImportHistory(entry);
}

/**
 * Clear import history
 */
export async function clearImportHistory(): Promise<void> {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    await AsyncStorage.removeItem(HISTORY_KEY);
  } catch (error) {
    console.error('Failed to clear import history:', error);
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Detect file format from content
 */
export function detectFormat(content: string): 'csv' | 'json' | 'unknown' {
  const trimmed = content.trim();
  
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Not valid JSON
    }
  }
  
  // Check for CSV indicators
  if (trimmed.includes(',') && trimmed.split('\n')[0].split(',').length > 1) {
    return 'csv';
  }
  
  return 'unknown';
}

/**
 * Get sample CSV template
 */
export function getCSVTemplate(): string {
  return `name,description,category,price,currency,billingCycle,nextBillingDate,isActive,notificationsEnabled,isCryptoEnabled,cryptoToken,cryptoAmount
Netflix,Streaming service,streaming,15.99,USD,monthly,2026-05-01,true,true,false,,
Spotify,Music streaming,streaming,9.99,USD,monthly,2026-05-15,true,true,false,,
Adobe Creative Cloud,Design software,software,54.99,USD,monthly,2026-05-20,true,true,true,XLM,0.5`;
}

/**
 * Get sample JSON template
 */
export function getJSONTemplate(): string {
  const template: ExportData = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    subscriptionCount: 2,
    subscriptions: [
      {
        id: 'sample-1',
        name: 'Netflix',
        description: 'Streaming service',
        category: SubscriptionCategory.STREAMING,
        price: 15.99,
        currency: 'USD',
        billingCycle: BillingCycle.MONTHLY,
        nextBillingDate: new Date('2026-05-01'),
        isActive: true,
        notificationsEnabled: true,
        isCryptoEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'sample-2',
        name: 'Spotify',
        description: 'Music streaming',
        category: SubscriptionCategory.STREAMING,
        price: 9.99,
        currency: 'USD',
        billingCycle: BillingCycle.MONTHLY,
        nextBillingDate: new Date('2026-05-15'),
        isActive: true,
        notificationsEnabled: true,
        isCryptoEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  };
  
  return JSON.stringify(template, null, 2);
}