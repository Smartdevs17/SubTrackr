import type { Notification } from '../types/notification.js';
import { RuleSetSchema, type Condition, type Rule, type RuleInput } from './schema.js';

export type Channel = Notification['channel'];

export interface Decision {
  /** One notification per channel to deliver; empty when suppressed. */
  deliveries: Notification[];
  /** Set when a `suppress` action matched. */
  suppressedBy?: { ruleId: string; reason: string };
  /** Ids of rules whose condition matched, in evaluation order. */
  matchedRules: string[];
}

function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function evaluateCondition(condition: Condition, notification: Notification): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluateCondition(c, notification));
  if ('any' in condition) return condition.any.some((c) => evaluateCondition(c, notification));
  if ('not' in condition) return !evaluateCondition(condition.not, notification);

  const value = readPath(notification, condition.field);
  if ('exists' in condition) return (value !== undefined && value !== null) === condition.exists;
  if ('eq' in condition) return value === condition.eq;
  if ('in' in condition) return condition.in.some((candidate) => candidate === value);
  return typeof value === 'string' && new RegExp(condition.matches).test(value);
}

/**
 * Evaluates a validated rule set against notifications. Pure and synchronous:
 * delivery and logging are the caller's job.
 */
export class RuleEngine {
  private readonly rules: Rule[];

  constructor(rules: RuleInput[] = []) {
    this.rules = RuleSetSchema.parse(rules)
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => rule.enabled)
      .sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index)
      .map(({ rule }) => rule);
  }

  get size(): number {
    return this.rules.length;
  }

  evaluate(notification: Notification): Decision {
    let channels: Channel[] = [notification.channel];
    let priority = notification.priority;
    const matchedRules: string[] = [];

    for (const rule of this.rules) {
      if (!evaluateCondition(rule.when, notification)) continue;
      matchedRules.push(rule.id);

      for (const action of rule.then) {
        if (action.type === 'suppress') {
          return { deliveries: [], suppressedBy: { ruleId: rule.id, reason: action.reason }, matchedRules };
        }
        if (action.type === 'route') channels = [...new Set(action.channels)];
        if (action.type === 'setPriority') priority = action.priority;
      }
      if (rule.stop) break;
    }

    return {
      deliveries: channels.map((channel) => ({ ...notification, channel, priority })),
      matchedRules,
    };
  }
}
