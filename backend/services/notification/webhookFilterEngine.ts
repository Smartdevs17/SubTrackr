/**
 * Subscription Webhook Event Filtering Engine — Issue #955
 * 
 * Provides robust attribute-based and topic-pattern filtering for webhook endpoints,
 * allowing developers to subscribe only to relevant event subsets, filter by transaction
 * thresholds, currency, plan tier, subscriber metadata, and test filter criteria in the developer portal.
 */

import type { WebhookEventPayload, WebhookEventType } from '../../../src/types/webhook';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'regex'
  | 'exists';

export interface AttributeRule {
  field: string; // e.g. "data.plan.price", "data.subscription.status", "type"
  operator: FilterOperator;
  value: any;
}

export interface WebhookFilterConfig {
  id?: string;
  name?: string;
  enabled?: boolean;
  eventPatterns?: string[]; // e.g. ["subscription.*", "payment.succeeded", "invoice.*"]
  excludePatterns?: string[]; // e.g. ["*.test", "subscription.cancelled"]
  attributeRules?: AttributeRule[];
  ruleCombination?: 'AND' | 'OR';
  fieldProjections?: string[]; // If specified, only include these top-level/nested fields
}

export interface FilterEvaluationResult {
  isMatch: boolean;
  matchedPattern?: string;
  failedRule?: AttributeRule;
  reason: string;
  processedPayload?: Record<string, any>;
}

/**
 * Safely extracts a nested property value using dot notation
 */
export function getNestedProperty(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object' || !path) return undefined;
  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

/**
 * Evaluates wildcard and glob patterns for event types
 * Examples:
 * - "subscription.*" matches "subscription.created", "subscription.updated"
 * - "payment.*" matches "payment.succeeded"
 * - "*" matches all events
 */
export function matchEventPattern(pattern: string, eventType: string): boolean {
  if (!pattern || !eventType) return false;
  if (pattern === '*' || pattern === eventType) return true;

  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return eventType.startsWith(prefix + '.') || eventType === prefix;
  }

  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return eventType.endsWith('.' + suffix);
  }

  // Regex fallback for advanced glob patterns
  try {
    const regexPattern = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
    return new RegExp(regexPattern).test(eventType);
  } catch {
    return pattern === eventType;
  }
}

/**
 * Evaluates a single attribute condition against a payload
 */
export function evaluateAttributeRule(payload: Record<string, any>, rule: AttributeRule): boolean {
  const actualValue = getNestedProperty(payload, rule.field);

  switch (rule.operator) {
    case 'eq':
      return actualValue === rule.value;
    case 'neq':
      return actualValue !== rule.value;
    case 'gt':
      return typeof actualValue === 'number' && actualValue > Number(rule.value);
    case 'gte':
      return typeof actualValue === 'number' && actualValue >= Number(rule.value);
    case 'lt':
      return typeof actualValue === 'number' && actualValue < Number(rule.value);
    case 'lte':
      return typeof actualValue === 'number' && actualValue <= Number(rule.value);
    case 'in':
      return Array.isArray(rule.value) && rule.value.includes(actualValue);
    case 'nin':
      return Array.isArray(rule.value) && !rule.value.includes(actualValue);
    case 'contains':
      if (typeof actualValue === 'string') {
        return actualValue.includes(String(rule.value));
      }
      if (Array.isArray(actualValue)) {
        return actualValue.includes(rule.value);
      }
      return false;
    case 'regex':
      try {
        const re = new RegExp(rule.value);
        return re.test(String(actualValue));
      } catch {
        return false;
      }
    case 'exists':
      return rule.value ? actualValue !== undefined && actualValue !== null : actualValue === undefined || actualValue === null;
    default:
      return false;
  }
}

/**
 * Core Webhook Event Filter Engine
 */
export class WebhookEventFilterEngine {
  /**
   * Evaluates if a given webhook event matches the filter configuration
   */
  public evaluate(
    payload: WebhookEventPayload | Record<string, any>,
    filter?: WebhookFilterConfig
  ): FilterEvaluationResult {
    // If no filter or filter is disabled, accept all events
    if (!filter || filter.enabled === false) {
      return {
        isMatch: true,
        reason: 'No filter applied or filter disabled (accepted all)',
        processedPayload: payload,
      };
    }

    const eventType = (payload as any).eventType || (payload as any).type || '';

    // 1. Check excluded patterns first
    if (filter.excludePatterns && filter.excludePatterns.length > 0) {
      for (const pattern of filter.excludePatterns) {
        if (matchEventPattern(pattern, eventType)) {
          return {
            isMatch: false,
            matchedPattern: pattern,
            reason: `Event matched exclusion pattern "${pattern}"`,
          };
        }
      }
    }

    // 2. Check event type inclusion patterns
    let eventTypeMatched = false;
    let matchedPattern: string | undefined;

    if (!filter.eventPatterns || filter.eventPatterns.length === 0 || filter.eventPatterns.includes('*')) {
      eventTypeMatched = true;
    } else {
      for (const pattern of filter.eventPatterns) {
        if (matchEventPattern(pattern, eventType)) {
          eventTypeMatched = true;
          matchedPattern = pattern;
          break;
        }
      }
    }

    if (!eventTypeMatched) {
      return {
        isMatch: false,
        reason: `Event type "${eventType}" did not match any of the subscribed patterns`,
      };
    }

    // 3. Evaluate attribute rules
    const rules = filter.attributeRules || [];
    if (rules.length > 0) {
      const combination = filter.ruleCombination || 'AND';

      if (combination === 'AND') {
        for (const rule of rules) {
          const rulePassed = evaluateAttributeRule(payload, rule);
          if (!rulePassed) {
            return {
              isMatch: false,
              failedRule: rule,
              reason: `Attribute rule failed for field "${rule.field}" with operator "${rule.operator}"`,
            };
          }
        }
      } else {
        // OR combination: at least one rule must pass
        const anyPassed = rules.some((rule) => evaluateAttributeRule(payload, rule));
        if (!anyPassed) {
          return {
            isMatch: false,
            reason: 'None of the OR-combined attribute rules matched',
          };
        }
      }
    }

    // 4. Apply optional field projections
    let processedPayload = payload;
    if (filter.fieldProjections && filter.fieldProjections.length > 0) {
      processedPayload = {};
      for (const field of filter.fieldProjections) {
        const val = getNestedProperty(payload, field);
        if (val !== undefined) {
          processedPayload[field] = val;
        }
      }
    }

    return {
      isMatch: true,
      matchedPattern,
      reason: 'Event satisfied all topic and attribute filter requirements',
      processedPayload,
    };
  }

  /**
   * Simulation utility for Developer Portal tester
   */
  public simulate(
    sampleEvent: Record<string, any>,
    filterConfig: WebhookFilterConfig
  ): {
    passed: boolean;
    result: FilterEvaluationResult;
    executionTimeMs: number;
  } {
    const start = performance?.now ? performance.now() : Date.now();
    const result = this.evaluate(sampleEvent, filterConfig);
    const end = performance?.now ? performance.now() : Date.now();

    return {
      passed: result.isMatch,
      result,
      executionTimeMs: Number((end - start).toFixed(3)),
    };
  }
}

export const webhookFilterEngine = new WebhookEventFilterEngine();
