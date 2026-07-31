/*
Security considerations:
- Parameter injection: all params from deep links are untrusted user input. Always validate type, format, and length before use.
- XSS via name param: strip HTML tags from any string param that will be rendered.
- ID enumeration: validating ID format does not prevent guessing valid IDs. Access control must be enforced server-side or in the store.
- Open redirect: the NotFound handler navigates to Home and must never navigate to a URL derived from link params.
- Universal link domain verification: apple-app-site-association and assetlinks.json must be hosted at the root of the domain for universal links to work.
*/

import { BillingCycle } from '../types/subscription';

export interface DeepLinkValidationResult {
  isValid: boolean;
  error?: string;
}

export function validateSubscriptionId(id: unknown): DeepLinkValidationResult {
  if (!id || typeof id !== 'string') {
    return { isValid: false, error: 'Missing subscription ID' };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return { isValid: false, error: 'Invalid subscription ID format' };
  }

  return { isValid: true };
}

export interface AddSubscriptionPrefill {
  name?: string;
  amount?: number;
  cycle?: BillingCycle;
}

export function validateAddSubscriptionParams(params: Record<string, unknown>): {
  isValid: boolean;
  sanitised: AddSubscriptionPrefill;
  errors: string[];
} {
  const errors: string[] = [];
  const sanitised: AddSubscriptionPrefill = {};

  if (params.name !== undefined) {
    if (typeof params.name !== 'string' || params.name.trim().length === 0) {
      errors.push('Invalid name parameter');
    } else {
      const stripped = params.name
        .trim()
        .replace(/<[^>]*>/g, '')
        .slice(0, 100);

      if (stripped.length === 0) {
        errors.push('Invalid name parameter');
      } else {
        sanitised.name = stripped;
      }
    }
  }

  if (params.amount !== undefined) {
    const amount = Number(params.amount);

    if (Number.isNaN(amount) || amount < 0 || amount > 100_000) {
      errors.push('Invalid amount parameter');
    } else {
      sanitised.amount = amount;
    }
  }

  if (params.cycle !== undefined) {
    const validCycles = Object.values(BillingCycle) as string[];

    if (typeof params.cycle !== 'string' || !validCycles.includes(params.cycle)) {
      errors.push('Invalid cycle parameter');
    } else {
      sanitised.cycle = params.cycle as BillingCycle;
    }
  }

  return { isValid: errors.length === 0, sanitised, errors };
}
