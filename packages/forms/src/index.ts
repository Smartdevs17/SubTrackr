/**
 * @subtrackr/forms
 *
 * Framework-agnostic typed form primitive with schema-driven validation.
 * Zero React dependency — usable from React Native, Node, or any JS runtime.
 */

export type FieldType = 'string' | 'number' | 'email' | 'password';

export interface BaseFieldDescriptor<T extends FieldType = FieldType> {
  /** Unique field key used for values and errors. */
  name: string;
  /** Human-readable label for accessibility and error messages. */
  label: string;
  /** Field data type — drives default validation and coercion. */
  type: T;
  /** Whether the field is required. */
  required?: boolean;
  /** Custom validation predicate. Receives the coerced value. */
  validate?: (value: unknown) => string | undefined;
}

export interface StringFieldDescriptor extends BaseFieldDescriptor<'string'> {
  type: 'string';
  /** Minimum string length (after trim if string). */
  minLength?: number;
  /** Maximum string length. */
  maxLength?: number;
  /** Regex pattern the value must match. */
  pattern?: RegExp;
  /** If true, trim whitespace before validation. */
  trim?: boolean;
  /** Custom error message for pattern mismatch. */
  patternMessage?: string;
}

export interface NumberFieldDescriptor extends BaseFieldDescriptor<'number'> {
  type: 'number';
  /** Minimum numeric value (inclusive). */
  min?: number;
  /** Maximum numeric value (inclusive). */
  max?: number;
  /** If true, value must be an integer. */
  integer?: boolean;
  /** Custom error message for range violation. */
  rangeMessage?: string;
}

export interface EmailFieldDescriptor extends BaseFieldDescriptor<'email'> {
  type: 'email';
  /** If true, also allow empty string (handled by required). */
  allowEmpty?: boolean;
}

export interface PasswordFieldDescriptor extends BaseFieldDescriptor<'password'> {
  type: 'password';
  /** Minimum password length. */
  minLength?: number;
  /** Require at least one uppercase letter. */
  requireUppercase?: boolean;
  /** Require at least one lowercase letter. */
  requireLowercase?: boolean;
  /** Require at least one digit. */
  requireDigit?: boolean;
  /** Require at least one special character. */
  requireSpecial?: boolean;
}

export type FieldDescriptor =
  | StringFieldDescriptor
  | NumberFieldDescriptor
  | EmailFieldDescriptor
  | PasswordFieldDescriptor;

export type FormSchema = ReadonlyArray<FieldDescriptor>;

export type FormValues<T extends FormSchema = FormSchema> = {
  [K in T[number]['name']]: T[number] extends { type: 'number' } ? number : string;
};

export interface FieldError {
  /** Field name this error belongs to. */
  field: string;
  /** Machine-readable error code. */
  code: string;
  /** Human-readable message. */
  message: string;
  /** The invalid value that triggered the error (for debugging). */
  received?: unknown;
}

export interface ValidationResult<T extends FormSchema = FormSchema> {
  /** True if all fields passed validation. */
  ok: boolean;
  /** Coerced and validated values keyed by field name. */
  values: Partial<FormValues<T>>;
  /** Per-field errors. Empty array when ok === true. */
  errors: FieldError[];
}

/** Coerce a raw input to the field's expected type. */
function coerceValue(descriptor: FieldDescriptor, raw: unknown): unknown {
  switch (descriptor.type) {
    case 'number': {
      if (raw === '' || raw === null || raw === undefined) return { __empty: true };
      const num = Number(raw);
      return Number.isNaN(num) ? { __invalidNumber: true, raw } : num;
    }
    case 'email':
    case 'string':
    case 'password': {
      if (raw === null || raw === undefined) return '';
      const str = String(raw);
      // Apply trim during coercion for string types when trim option is set
      if (descriptor.type === 'string' && descriptor.trim) {
        return str.trim();
      }
      return str;
    }
    default:
      return raw;
  }
}

/** Validate a single field against its descriptor. */
function validateField(
  descriptor: FieldDescriptor,
  value: unknown,
  allValues: Record<string, unknown>
): FieldError[] {
  const errors: FieldError[] = [];
  const coerced = coerceValue(descriptor, value);

  // Check for special coercion results
  const isEmptyMarker = coerced && typeof coerced === 'object' && '__empty' in coerced;
  const isInvalidNumber = coerced && typeof coerced === 'object' && '__invalidNumber' in coerced;

  // Required check
  if (descriptor.required) {
    const isEmpty =
      isEmptyMarker ||
      coerced === null ||
      (typeof coerced === 'string' && coerced.trim() === '') ||
      (typeof coerced === 'number' && Number.isNaN(coerced));
    if (isEmpty) {
      errors.push({
        field: descriptor.name,
        code: 'REQUIRED',
        message: `${descriptor.label} is required.`,
        received: value,
      });
      return errors; // Stop on required failure
    }
  }

  // If not required and empty, skip further validation
  const isEmpty =
    isEmptyMarker ||
    coerced === null ||
    (typeof coerced === 'string' && coerced.trim() === '');
  if (!descriptor.required && isEmpty) {
    return errors;
  }

  // Handle invalid number before type-specific validation
  if (isInvalidNumber) {
    errors.push({
      field: descriptor.name,
      code: 'INVALID_NUMBER',
      message: `${descriptor.label} must be a valid number.`,
      received: (coerced as any).raw,
    });
    return errors;
  }

  // Type-specific validation
  switch (descriptor.type) {
    case 'string': {
      const str = String(coerced);
      // Trim already applied during coercion if descriptor.trim is true
      const checkStr = str;

      if (descriptor.minLength !== undefined && checkStr.length < descriptor.minLength) {
        errors.push({
          field: descriptor.name,
          code: 'MIN_LENGTH',
          message: `${descriptor.label} must be at least ${descriptor.minLength} characters.`,
          received: value,
        });
      }
      if (descriptor.maxLength !== undefined && checkStr.length > descriptor.maxLength) {
        errors.push({
          field: descriptor.name,
          code: 'MAX_LENGTH',
          message: `${descriptor.label} must not exceed ${descriptor.maxLength} characters.`,
          received: value,
        });
      }
      if (descriptor.pattern && !descriptor.pattern.test(checkStr)) {
        errors.push({
          field: descriptor.name,
          code: 'PATTERN_MISMATCH',
          message: descriptor.patternMessage || `${descriptor.label} format is invalid.`,
          received: value,
        });
      }
      break;
    }
    case 'number': {
      const num = Number(coerced);
      if (Number.isNaN(num)) {
        errors.push({
          field: descriptor.name,
          code: 'INVALID_NUMBER',
          message: `${descriptor.label} must be a valid number.`,
          received: value,
        });
      } else {
        if (descriptor.integer && !Number.isInteger(num)) {
          errors.push({
            field: descriptor.name,
            code: 'NOT_INTEGER',
            message: `${descriptor.label} must be an integer.`,
            received: value,
          });
        }
        if (descriptor.min !== undefined && num < descriptor.min) {
          errors.push({
            field: descriptor.name,
            code: 'MIN_VALUE',
            message: descriptor.rangeMessage || `${descriptor.label} must be at least ${descriptor.min}.`,
            received: value,
          });
        }
        if (descriptor.max !== undefined && num > descriptor.max) {
          errors.push({
            field: descriptor.name,
            code: 'MAX_VALUE',
            message: descriptor.rangeMessage || `${descriptor.label} must not exceed ${descriptor.max}.`,
            received: value,
          });
        }
      }
      break;
    }
    case 'email': {
      const email = String(coerced).trim();
      if (email && !EMAIL_REGEX.test(email)) {
        errors.push({
          field: descriptor.name,
          code: 'INVALID_EMAIL',
          message: `${descriptor.label} must be a valid email address.`,
          received: value,
        });
      }
      break;
    }
    case 'password': {
      const pwd = String(coerced);
      if (descriptor.minLength !== undefined && pwd.length < descriptor.minLength) {
        errors.push({
          field: descriptor.name,
          code: 'MIN_LENGTH',
          message: `${descriptor.label} must be at least ${descriptor.minLength} characters.`,
          received: value,
        });
      }
      if (descriptor.requireUppercase && !/[A-Z]/.test(pwd)) {
        errors.push({
          field: descriptor.name,
          code: 'REQUIRE_UPPERCASE',
          message: `${descriptor.label} must contain at least one uppercase letter.`,
          received: value,
        });
      }
      if (descriptor.requireLowercase && !/[a-z]/.test(pwd)) {
        errors.push({
          field: descriptor.name,
          code: 'REQUIRE_LOWERCASE',
          message: `${descriptor.label} must contain at least one lowercase letter.`,
          received: value,
        });
      }
      if (descriptor.requireDigit && !/\d/.test(pwd)) {
        errors.push({
          field: descriptor.name,
          code: 'REQUIRE_DIGIT',
          message: `${descriptor.label} must contain at least one number.`,
          received: value,
        });
      }
      if (descriptor.requireSpecial && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd)) {
        errors.push({
          field: descriptor.name,
          code: 'REQUIRE_SPECIAL',
          message: `${descriptor.label} must contain at least one special character.`,
          received: value,
        });
      }
      break;
    }
  }

  // Custom validator
  if (descriptor.validate) {
    const customError = descriptor.validate(coerced);
    if (customError) {
      errors.push({
        field: descriptor.name,
        code: 'CUSTOM_VALIDATION',
        message: customError,
        received: value,
      });
    }
  }

  return errors;
}

/** Email regex — RFC 5322 simplified. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a complete form payload against a schema.
 *
 * @param schema - Array of field descriptors defining the form contract.
 * @param input - Raw input values keyed by field name.
 * @returns ValidationResult with ok flag, coerced values, and field errors.
 */
export function validateForm<T extends FormSchema>(
  schema: T,
  input: Record<string, unknown>
): ValidationResult<T> {
  const values: Record<string, unknown> = {};
  const errors: FieldError[] = [];

  // First pass: coerce all values
  for (const descriptor of schema) {
    const raw = input[descriptor.name];
    values[descriptor.name] = coerceValue(descriptor, raw);
  }

  // Second pass: validate with access to all coerced values
  for (const descriptor of schema) {
    const fieldErrors = validateField(descriptor, input[descriptor.name], values);
    errors.push(...fieldErrors);
  }

  const ok = errors.length === 0;

  return {
    ok,
    values: values as Partial<FormValues<T>>,
    errors,
  };
}

/**
 * Create a typed form schema with inference.
 * Usage:
 *   const schema = formSchema([
 *     { name: 'email', label: 'Email', type: 'email', required: true },
 *     { name: 'age', label: 'Age', type: 'number', min: 18, max: 120 },
 *   ]);
 */
export function formSchema<T extends FormSchema>(schema: T): T {
  return schema;
}

/**
 * Convenience helpers for common field types.
 */
export const field = {
  string: (name: string, label: string, overrides: Partial<StringFieldDescriptor> = {}): StringFieldDescriptor => ({
    name,
    label,
    type: 'string',
    ...overrides,
  }),
  number: (name: string, label: string, overrides: Partial<NumberFieldDescriptor> = {}): NumberFieldDescriptor => ({
    name,
    label,
    type: 'number',
    ...overrides,
  }),
  email: (name: string, label: string, overrides: Partial<EmailFieldDescriptor> = {}): EmailFieldDescriptor => ({
    name,
    label,
    type: 'email',
    ...overrides,
  }),
  password: (name: string, label: string, overrides: Partial<PasswordFieldDescriptor> = {}): PasswordFieldDescriptor => ({
    name,
    label,
    type: 'password',
    ...overrides,
  }),
};

/**
 * Helper to extract just the error messages for a field.
 */
export function getFieldError(errors: FieldError[], fieldName: string): string | undefined {
  return errors.find((e) => e.field === fieldName)?.message;
}

/**
 * Helper to check if a specific field has errors.
 */
export function hasFieldError(errors: FieldError[], fieldName: string): boolean {
  return errors.some((e) => e.field === fieldName);
}