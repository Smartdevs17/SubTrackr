import { z } from 'zod';

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[]
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function parseResponse<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context = 'API response'
): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues;
    const summary = issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new ValidationError(`${context} validation failed: ${summary}`, issues);
  }

  return result.data;
}

export function tryParseResponse<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context = 'API response'
): { success: true; data: T } | { success: false; error: ValidationError } {
  const result = schema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues;
    const summary = issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return {
      success: false,
      error: new ValidationError(`${context} validation failed: ${summary}`, issues),
    };
  }

  return { success: true, data: result.data };
}

export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function coerceDate(schema: z.ZodType<Date>): z.ZodType<Date> {
  return z.union([schema, z.string(), z.number()]).transform((val) => {
    const date = parseDate(val);
    if (!date) {
      throw new Error('Invalid date');
    }
    return date;
  }) as z.ZodType<Date>;
}
