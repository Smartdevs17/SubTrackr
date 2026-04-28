import {
  Segment,
  SegmentRule,
  SubscriberData,
  CriteriaOperator,
  SegmentOverlap,
  SegmentPricingRule,
} from '../types/segment';
import { Subscription } from '../types/subscription';
import { UserProfile } from '../types/api';

export class SegmentService {
  /**
   * Maps raw user and subscription data to the SubscriberData format used for evaluation.
   */
  mapSubscriberData(user: UserProfile, subscriptions: Subscription[]): SubscriberData {
    const activeSubs = subscriptions.filter((s) => s.isActive);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      totalMonthlySpend: activeSubs.reduce(
        (acc, s) => acc + (s.billingCycle === 'monthly' ? s.price : s.price / 12),
        0
      ),
      totalYearlySpend: activeSubs.reduce(
        (acc, s) => acc + (s.billingCycle === 'yearly' ? s.price : s.price * 12),
        0
      ),
      activeSubscriptionCount: activeSubs.length,
      categories: Array.from(new Set(activeSubs.map((s) => s.category))),
      billingCycles: Array.from(new Set(activeSubs.map((s) => s.billingCycle))),
      currencies: Array.from(new Set(activeSubs.map((s) => s.currency))),
      daysSinceLastActive: Math.floor(
        (Date.now() - new Date(user.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
      ),
    };
  }

  /**
   * Evaluates if a subscriber belongs to a segment.
   */
  isSubscriberInSegment(subscriber: SubscriberData, segment: Segment): boolean {
    if (segment.criteria.length === 0) return true;

    const results = segment.criteria.map((rule) => this.evaluateRule(subscriber, rule));

    if (segment.logic === 'OR') {
      return results.some((r) => r);
    }
    return results.every((r) => r);
  }

  /**
   * Evaluates a single rule against subscriber data.
   */
  evaluateRule(subscriber: SubscriberData, rule: SegmentRule): boolean {
    const fieldValue = subscriber[rule.field as keyof SubscriberData];
    const targetValue = rule.value;

    switch (rule.operator) {
      case CriteriaOperator.EQUALS:
        return fieldValue === targetValue;
      case CriteriaOperator.NOT_EQUALS:
        return fieldValue !== targetValue;
      case CriteriaOperator.GREATER_THAN:
        return fieldValue > targetValue;
      case CriteriaOperator.LESS_THAN:
        return fieldValue < targetValue;
      case CriteriaOperator.CONTAINS:
        if (Array.isArray(fieldValue)) {
          return (fieldValue as unknown[]).includes(targetValue as never);
        }
        if (typeof fieldValue === 'string') {
          return fieldValue.toLowerCase().includes(String(targetValue).toLowerCase());
        }
        return false;
      case CriteriaOperator.IN:
        if (Array.isArray(targetValue)) {
          return (targetValue as unknown[]).includes(fieldValue as never);
        }
        return false;
      case CriteriaOperator.STARTS_WITH:
        return String(fieldValue).toLowerCase().startsWith(String(targetValue).toLowerCase());
      case CriteriaOperator.ENDS_WITH:
        return String(fieldValue).toLowerCase().endsWith(String(targetValue).toLowerCase());
      default:
        return false;
    }
  }

  /**
   * Calculates overlap between multiple segments.
   */
  calculateOverlap(segments: Segment[], subscribers: SubscriberData[]): SegmentOverlap[] {
    const overlaps: SegmentOverlap[] = [];

    // Simple version: only calculate 2-way overlaps for now
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const segA = segments[i];
        const segB = segments[j];

        const intersection = subscribers.filter(
          (sub) => this.isSubscriberInSegment(sub, segA) && this.isSubscriberInSegment(sub, segB)
        );

        overlaps.push({
          segmentIds: [segA.id, segB.id],
          subscriberCount: intersection.length,
          percentage: subscribers.length > 0 ? (intersection.length / subscribers.length) * 100 : 0,
        });
      }
    }

    return overlaps;
  }

  /**
   * Applies pricing rules to a subscription price.
   */
  applyPricingRule(basePrice: number, rule?: SegmentPricingRule): number {
    if (!rule) return basePrice;

    let price = basePrice;

    if (rule.overridePrice !== undefined) {
      return rule.overridePrice;
    }

    if (rule.discountPercentage !== undefined) {
      price = price * (1 - rule.discountPercentage / 100);
    }

    if (rule.fixedDiscount !== undefined) {
      price = Math.max(0, price - rule.fixedDiscount);
    }

    return price;
  }
}

export const segmentService = new SegmentService();
