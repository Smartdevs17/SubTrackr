/**
 * Pricing Analytics Service
 *
 * Tracks pricing performance, conversion rates, and revenue metrics
 * across different pricing strategies.
 */

import { PricingAnalytics, PricingResult } from './pricingStrategy';

export interface PricingEvent {
  strategyName: string;
  planType: string;
  price: number;
  converted: boolean;
  timestamp: string;
  subscriberAddress: string;
}

export interface RevenueMetrics {
  totalRevenue: number;
  averageOrderValue: number;
  conversionRate: number;
  revenuePerStrategy: Record<string, number>;
  revenuePerPlanType: Record<string, number>;
  periodStart: string;
  periodEnd: string;
}

export class PricingAnalyticsService {
  private events: PricingEvent[] = [];

  trackPricingEvent(
    result: PricingResult,
    planType: string,
    subscriberAddress: string,
    converted: boolean = true
  ): void {
    this.events.push({
      strategyName: result.strategyName,
      planType,
      price: result.price,
      converted,
      timestamp: new Date().toISOString(),
      subscriberAddress,
    });
  }

  getRevenueMetrics(periodDays: number = 30): RevenueMetrics {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays);

    const periodEvents = this.events.filter(
      (e) => new Date(e.timestamp) >= cutoff
    );

    const convertedEvents = periodEvents.filter((e) => e.converted);

    const totalRevenue = convertedEvents.reduce((sum, e) => sum + e.price, 0);
    const averageOrderValue =
      convertedEvents.length > 0 ? totalRevenue / convertedEvents.length : 0;
    const conversionRate =
      periodEvents.length > 0 ? convertedEvents.length / periodEvents.length : 0;

    const revenuePerStrategy: Record<string, number> = {};
    for (const event of convertedEvents) {
      revenuePerStrategy[event.strategyName] =
        (revenuePerStrategy[event.strategyName] || 0) + event.price;
    }

    const revenuePerPlanType: Record<string, number> = {};
    for (const event of convertedEvents) {
      revenuePerPlanType[event.planType] =
        (revenuePerPlanType[event.planType] || 0) + event.price;
    }

    return {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
      conversionRate: Math.round(conversionRate * 10000) / 100,
      revenuePerStrategy,
      revenuePerPlanType,
      periodStart: cutoff.toISOString(),
      periodEnd: new Date().toISOString(),
    };
  }

  getStrategyPerformance(): Record<string, { events: number; revenue: number; avgPrice: number }> {
    const performance: Record<string, { events: number; revenue: number; avgPrice: number }> = {};

    for (const event of this.events) {
      if (!performance[event.strategyName]) {
        performance[event.strategyName] = { events: 0, revenue: 0, avgPrice: 0 };
      }
      const perf = performance[event.strategyName];
      perf.events++;
      if (event.converted) {
        perf.revenue += event.price;
      }
      perf.avgPrice = perf.events > 0 ? perf.revenue / perf.events : 0;
    }

    return performance;
  }
}
