/**
 * #668 – PII Classification & Automated Redaction Pipeline
 */

export type ClassificationLevel = 'strict' | 'standard' | 'permissive';

export interface PiiPattern {
  name: string;
  fieldPattern?: RegExp;
  valuePattern?: RegExp;
  replacement: string;
  minLevel: ClassificationLevel;
}

// level order: strict is most restrictive (0), permissive is least (2)
const LEVEL_ORDER: Record<ClassificationLevel, number> = {
  strict: 0,
  standard: 1,
  permissive: 2,
};

/** Returns true when the pattern should be active at the current level. */
function isActive(patternMinLevel: ClassificationLevel, currentLevel: ClassificationLevel): boolean {
  // A pattern is active when the current level is at least as restrictive as the pattern's min level.
  // strict(0) <= standard(1) <= permissive(2)
  return LEVEL_ORDER[currentLevel] <= LEVEL_ORDER[patternMinLevel];
}

export const DEFAULT_PATTERNS: PiiPattern[] = [
  // ── Always-on (permissive+) ───────────────────────────────────────────────
  {
    name: 'password',
    fieldPattern: /^(password|passwd|pass|secret|apikey|api_key|access_token|refresh_token|private_key)$/i,
    replacement: '[REDACTED]',
    minLevel: 'permissive',
  },
  // ── Standard+ ────────────────────────────────────────────────────────────
  {
    name: 'email',
    valuePattern: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,
    replacement: '[REDACTED_EMAIL]',
    minLevel: 'standard',
  },
  {
    name: 'email_field',
    fieldPattern: /\bemail\b/i,
    replacement: '[REDACTED_EMAIL]',
    minLevel: 'standard',
  },
  {
    name: 'phone',
    valuePattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    replacement: '[REDACTED_PHONE]',
    minLevel: 'standard',
  },
  {
    name: 'phone_field',
    fieldPattern: /\b(phone|mobile|cell|tel)\b/i,
    replacement: '[REDACTED_PHONE]',
    minLevel: 'standard',
  },
  {
    name: 'crypto_address',
    valuePattern: /\bG[A-Z2-7]{55}\b|\b0x[0-9a-fA-F]{40}\b|\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g,
    replacement: '[REDACTED_CRYPTO_ADDR]',
    minLevel: 'standard',
  },
  {
    name: 'dob_field',
    fieldPattern: /\b(dob|date_of_birth|birthdate|birth_date)\b/i,
    replacement: '[REDACTED_DOB]',
    minLevel: 'standard',
  },
  // ── Strict-only ───────────────────────────────────────────────────────────
  {
    name: 'ip_address',
    valuePattern: /\b(\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[REDACTED_IP]',
    minLevel: 'strict',
  },
  {
    name: 'address_field',
    fieldPattern: /\b(address|street|city|zipcode|postal_code|postcode)\b/i,
    replacement: '[REDACTED_ADDR]',
    minLevel: 'strict',
  },
  {
    name: 'name_field',
    fieldPattern: /\b(full_name|first_name|last_name|given_name|family_name|surname)\b/i,
    replacement: '[REDACTED_NAME]',
    minLevel: 'strict',
  },
];

// ─── SSN and credit-card use level-aware replacements in redactString ────────

function redactSSN(value: string, level: ClassificationLevel): string {
  if (level === 'strict') {
    return value.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');
  }
  // standard: keep last 4
  return value.replace(/\b(\d{3})-(\d{2})-(\d{4})\b/g, 'XXX-XX-$3');
}

function redactCard(value: string, level: ClassificationLevel): string {
  if (level === 'strict') {
    return value.replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '[REDACTED_CARD]');
  }
  // standard: keep last 4
  return value.replace(/\b(\d{4})[- ]?(\d{4})[- ]?(\d{4})[- ]?(\d{4})\b/g, 'XXXX-XXXX-XXXX-$4');
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ClassifyResult {
  field: string;
  patternName: string;
  sensitive: boolean;
}

export interface RedactOptions {
  level?: ClassificationLevel;
  customPatterns?: PiiPattern[];
  allowList?: string[];
}

export class PiiClassifier {
  private patterns: PiiPattern[];

  constructor(customPatterns: PiiPattern[] = []) {
    this.patterns = [...customPatterns, ...DEFAULT_PATTERNS];
  }

  classify(field: string, value: unknown, level: ClassificationLevel = 'standard'): ClassifyResult[] {
    const results: ClassifyResult[] = [];
    for (const p of this.patterns) {
      if (!isActive(p.minLevel, level)) continue;
      if (p.fieldPattern?.test(field)) {
        results.push({ field, patternName: p.name, sensitive: true });
      } else if (p.valuePattern && typeof value === 'string' && p.valuePattern.test(value)) {
        p.valuePattern.lastIndex = 0;
        results.push({ field, patternName: p.name, sensitive: true });
      }
    }
    // SSN / card value detection
    if (typeof value === 'string') {
      if (level !== 'permissive') {
        if (/\b\d{3}-\d{2}-\d{4}\b/.test(value)) results.push({ field, patternName: 'ssn', sensitive: true });
        if (/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/.test(value)) results.push({ field, patternName: 'credit_card', sensitive: true });
      }
    }
    return results;
  }

  redactString(value: string, level: ClassificationLevel = 'standard', field?: string): string {
    // Field-name match → entire value replaced
    if (field) {
      for (const p of this.patterns) {
        if (!isActive(p.minLevel, level)) continue;
        if (p.fieldPattern?.test(field)) return p.replacement;
      }
    }

    let result = value;

    // Level-aware SSN and card (handled before generic patterns)
    if (level !== 'permissive') {
      result = redactSSN(result, level);
      result = redactCard(result, level);
    }

    // Generic value patterns
    for (const p of this.patterns) {
      if (!isActive(p.minLevel, level)) continue;
      if (p.valuePattern) {
        p.valuePattern.lastIndex = 0;
        result = result.replace(p.valuePattern, p.replacement);
        p.valuePattern.lastIndex = 0;
      }
    }

    return result;
  }

  redact<T>(data: T, opts: RedactOptions = {}): T {
    const level = opts.level ?? 'standard';
    const allowList = new Set(opts.allowList ?? []);
    const savedPatterns = this.patterns;
    if (opts.customPatterns?.length) {
      this.patterns = [...opts.customPatterns, ...savedPatterns];
    }
    const result = this._walk(data, level, allowList) as T;
    this.patterns = savedPatterns;
    return result;
  }

  private _walk(node: unknown, level: ClassificationLevel, allow: Set<string>, fieldName?: string): unknown {
    if (node === null || node === undefined) return node;

    if (Array.isArray(node)) {
      return node.map((item) => this._walk(item, level, allow, fieldName));
    }

    if (typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        if (allow.has(key)) { out[key] = val; continue; }

        const triggeringPattern = this.patterns.find(
          (p) => isActive(p.minLevel, level) && p.fieldPattern?.test(key)
        );

        if (triggeringPattern) {
          // Only redact string values; leave null/undefined/non-string as-is
          out[key] = typeof val === 'string' ? triggeringPattern.replacement : val;
        } else {
          out[key] = this._walk(val, level, allow, key);
        }
      }
      return out;
    }

    if (typeof node === 'string') {
      return this.redactString(node, level, fieldName);
    }

    return node;
  }
}

export const piiClassifier = new PiiClassifier();

export function redact<T>(data: T, opts: RedactOptions = {}): T {
  return piiClassifier.redact(data, opts);
}

export function isPiiField(fieldName: string, level: ClassificationLevel = 'standard'): boolean {
  return DEFAULT_PATTERNS.some(
    (p) => isActive(p.minLevel, level) && p.fieldPattern?.test(fieldName)
  );
}
