import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  SubscriptionPlan,
  PlanComparison,
  PlanSwitchRequest,
  PlanSwitchResponse,
  PlanSwitchHistory,
  PlanAnalytics,
  ComparisonRow,
  PlanRecommendation,
  PlanTier,
  BillingCycle,
} from '../types/plan';

const STORAGE_KEYS = {
  PLANS: '@SubTrackr:plans',
  SWITCH_HISTORY: '@SubTrackr:planSwitchHistory',
} as const;

// Plan Management
export async function getAllPlans(billingCycle?: BillingCycle): Promise<SubscriptionPlan[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.PLANS);
    if (!data) return getDefaultPlans();

    let plans: SubscriptionPlan[] = JSON.parse(data);
    plans = plans.map((p: any) => ({
      ...p,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
      discount: p.discount
        ? {
            ...p.discount,
            validUntil: p.discount.validUntil ? new Date(p.discount.validUntil) : undefined,
          }
        : undefined,
    }));

    if (billingCycle) {
      return plans.filter((p) => p.billingCycle === billingCycle);
    }

    return plans;
  } catch (error) {
    console.error('Failed to load plans:', error);
    return getDefaultPlans();
  }
}

export async function getPlanById(id: string): Promise<SubscriptionPlan | null> {
  const plans = await getAllPlans();
  return plans.find((p) => p.id === id) || null;
}

export async function getPlansByTier(tier: PlanTier): Promise<SubscriptionPlan[]> {
  const plans = await getAllPlans();
  return plans.filter((p) => p.tier === tier);
}

// Plan Comparison
export async function comparePlans(planIds: string[]): Promise<PlanComparison> {
  const allPlans = await getAllPlans();
  const plans = allPlans.filter((p) => planIds.includes(p.id));

  if (plans.length < 2) {
    throw new Error('At least 2 plans required for comparison');
  }

  // Build comparison matrix
  const comparisonMatrix = buildComparisonMatrix(plans);

  // Generate recommendations
  const recommendations = generateRecommendations(plans);

  return {
    plans,
    comparisonMatrix,
    recommendations,
  };
}

function buildComparisonMatrix(plans: SubscriptionPlan[]): ComparisonRow[] {
  const categories = [
    {
      category: 'Pricing',
      features: [
        {
          name: 'Monthly Price',
          values: Object.fromEntries(
            plans.map((p) => [p.id, `${p.currency} ${p.price.toFixed(2)}`])
          ),
        },
        {
          name: 'Billing Cycle',
          values: Object.fromEntries(plans.map((p) => [p.id, p.billingCycle])),
        },
        {
          name: 'Trial Period',
          values: Object.fromEntries(
            plans.map((p) => [p.id, p.trialDays ? `${p.trialDays} days` : 'None'])
          ),
        },
      ],
    },
    {
      category: 'Limits',
      features: [
        {
          name: 'Subscriptions',
          values: Object.fromEntries(
            plans.map((p) => [
              p.id,
              p.limits.subscriptions === -1 ? 'Unlimited' : p.limits.subscriptions,
            ])
          ),
        },
        {
          name: 'Users',
          values: Object.fromEntries(
            plans.map((p) => [p.id, p.limits.users === -1 ? 'Unlimited' : p.limits.users || 1])
          ),
        },
        {
          name: 'API Calls',
          values: Object.fromEntries(
            plans.map((p) => [
              p.id,
              p.limits.apiCalls === -1 ? 'Unlimited' : p.limits.apiCalls || 'N/A',
            ])
          ),
        },
      ],
    },
    {
      category: 'Features',
      features: getUniqueFeatures(plans).map((featureName) => ({
        name: featureName,
        values: Object.fromEntries(
          plans.map((p) => {
            const feature = p.features.find((f) => f.name === featureName);
            return [p.id, feature ? (feature.included ? '✓' : '✗') : '✗'];
          })
        ),
      })),
    },
  ];

  return categories;
}

function getUniqueFeatures(plans: SubscriptionPlan[]): string[] {
  const allFeatures = new Set<string>();
  plans.forEach((plan) => {
    plan.features.forEach((feature) => allFeatures.add(feature.name));
  });
  return Array.from(allFeatures);
}

function generateRecommendations(plans: SubscriptionPlan[]): PlanRecommendation[] {
  const recommendations: PlanRecommendation[] = [];

  // Find most popular
  const popularPlan = plans.find((p) => p.isPopular);
  if (popularPlan) {
    recommendations.push({
      planId: popularPlan.id,
      reason: 'Most popular choice among users',
      confidence: 0.8,
    });
  }

  // Find best value
  const yearlyPlans = plans.filter((p) => p.billingCycle === 'yearly');
  if (yearlyPlans.length > 0) {
    const bestValue = yearlyPlans.reduce((best, current) =>
      (current.discount?.percentage || 0) > (best.discount?.percentage || 0) ? current : best
    );
    if (bestValue.discount) {
      recommendations.push({
        planId: bestValue.id,
        reason: `Save ${bestValue.discount.percentage}% with yearly billing`,
        savings: bestValue.price * 12 * (bestValue.discount.percentage / 100),
        confidence: 0.9,
      });
    }
  }

  // Find recommended
  const recommended = plans.find((p) => p.isRecommended);
  if (recommended) {
    recommendations.push({
      planId: recommended.id,
      reason: 'Recommended based on your usage',
      confidence: 0.85,
    });
  }

  return recommendations;
}

// Plan Switching
export async function switchPlan(request: PlanSwitchRequest): Promise<PlanSwitchResponse> {
  const currentPlan = await getPlanById(request.currentPlanId);
  const newPlan = await getPlanById(request.targetPlanId);

  if (!currentPlan || !newPlan) {
    throw new Error('Plan not found');
  }

  // Calculate proration
  let prorationCredit = 0;
  let prorationCharge = 0;

  if (request.prorated) {
    const now = new Date();
    const effectiveDate = request.effectiveDate || now;

    if (newPlan.price > currentPlan.price) {
      prorationCharge = calculateProration(currentPlan, newPlan, effectiveDate);
    } else {
      prorationCredit = calculateProration(currentPlan, newPlan, effectiveDate);
    }
  }

  // Create switch record
  const switchId = generateId();
  const history: PlanSwitchHistory = {
    id: switchId,
    userId: request.userId,
    fromPlanId: request.currentPlanId,
    toPlanId: request.targetPlanId,
    fromPlanName: currentPlan.name,
    toPlanName: newPlan.name,
    effectiveDate: request.effectiveDate || new Date(),
    prorationAmount: prorationCharge || prorationCredit,
    status: 'completed',
    createdAt: new Date(),
  };

  await saveSwitchHistory(history);

  return {
    success: true,
    switchId,
    currentPlan,
    newPlan,
    effectiveDate: request.effectiveDate || new Date(),
    prorationCredit: prorationCredit > 0 ? prorationCredit : undefined,
    prorationCharge: prorationCharge > 0 ? prorationCharge : undefined,
    message: `Successfully switched from ${currentPlan.name} to ${newPlan.name}`,
  };
}

function calculateProration(
  oldPlan: SubscriptionPlan,
  newPlan: SubscriptionPlan,
  effectiveDate: Date
): number {
  // Simple proration calculation (days remaining in billing cycle)
  const daysInMonth = 30;
  const today = new Date();
  const daysRemaining = Math.max(0, daysInMonth - today.getDate());
  const unusedAmount = (oldPlan.price / daysInMonth) * daysRemaining;
  const newAmount = (newPlan.price / daysInMonth) * daysRemaining;

  return Math.abs(newAmount - unusedAmount);
}

async function saveSwitchHistory(history: PlanSwitchHistory): Promise<void> {
  const existing = await getSwitchHistory();
  existing.push(history);
  await AsyncStorage.setItem(STORAGE_KEYS.SWITCH_HISTORY, JSON.stringify(existing));
}

export async function getSwitchHistory(userId?: string): Promise<PlanSwitchHistory[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.SWITCH_HISTORY);
    if (!data) return [];

    let history: PlanSwitchHistory[] = JSON.parse(data);
    history = history.map((h: any) => ({
      ...h,
      effectiveDate: new Date(h.effectiveDate),
      createdAt: new Date(h.createdAt),
    }));

    if (userId) {
      return history.filter((h) => h.userId === userId);
    }

    return history;
  } catch (error) {
    console.error('Failed to load switch history:', error);
    return [];
  }
}

// Plan Analytics
export async function getPlanAnalytics(): Promise<PlanAnalytics> {
  const plans = await getAllPlans();
  const history = await getSwitchHistory();

  const totalPlans = plans.length;

  // Mock active subscriptions
  const activeSubscriptionsByPlan: Record<string, number> = {};
  plans.forEach((p) => {
    activeSubscriptionsByPlan[p.name] = Math.floor(Math.random() * 100);
  });

  // Mock revenue
  const revenueByPlan: Record<string, number> = {};
  plans.forEach((p) => {
    revenueByPlan[p.name] = activeSubscriptionsByPlan[p.name] * p.price;
  });

  // Switches last month
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const switchesLastMonth = history.filter((h) => h.createdAt >= lastMonth).length;

  // Popular plan
  const popularPlan = plans.find((p) => p.isPopular)?.name || plans[0]?.name || 'None';

  // Mock conversion and churn rates
  const conversionRate = 15.5;
  const churnRate = 3.2;

  return {
    totalPlans,
    activeSubscriptionsByPlan,
    revenueByPlan,
    switchesLastMonth,
    popularPlan,
    conversionRate,
    churnRate,
  };
}

// Helper Functions
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getDefaultPlans(): SubscriptionPlan[] {
  const now = new Date();

  return [
    {
      id: 'plan-free',
      name: 'Free',
      tier: 'free',
      description: 'Get started with basic features',
      price: 0,
      currency: 'USD',
      billingCycle: 'monthly',
      features: [
        {
          id: 'f1',
          name: 'Basic Dashboard',
          description: 'Access to basic dashboard',
          included: true,
        },
        { id: 'f2', name: 'Email Support', description: '48-hour response time', included: true },
        { id: 'f3', name: 'Mobile App', description: 'iOS and Android apps', included: true },
        { id: 'f4', name: 'Analytics', description: 'Basic analytics', included: false },
        { id: 'f5', name: 'API Access', description: 'REST API access', included: false },
        { id: 'f6', name: 'Priority Support', description: '24/7 support', included: false },
      ],
      limits: {
        subscriptions: 5,
        users: 1,
        apiCalls: 100,
      },
      isPopular: false,
      isRecommended: false,
      trialDays: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-basic',
      name: 'Basic',
      tier: 'basic',
      description: 'Perfect for individuals',
      price: 9.99,
      currency: 'USD',
      billingCycle: 'monthly',
      features: [
        {
          id: 'f1',
          name: 'Basic Dashboard',
          description: 'Access to basic dashboard',
          included: true,
        },
        { id: 'f2', name: 'Email Support', description: '24-hour response time', included: true },
        { id: 'f3', name: 'Mobile App', description: 'iOS and Android apps', included: true },
        { id: 'f4', name: 'Analytics', description: 'Basic analytics', included: true },
        { id: 'f5', name: 'API Access', description: 'REST API access', included: false },
        { id: 'f6', name: 'Priority Support', description: '24/7 support', included: false },
      ],
      limits: {
        subscriptions: 15,
        users: 1,
        apiCalls: 1000,
      },
      isPopular: false,
      isRecommended: false,
      trialDays: 14,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-standard',
      name: 'Standard',
      tier: 'standard',
      description: 'Most popular for small teams',
      price: 29.99,
      currency: 'USD',
      billingCycle: 'monthly',
      features: [
        {
          id: 'f1',
          name: 'Basic Dashboard',
          description: 'Access to basic dashboard',
          included: true,
        },
        { id: 'f2', name: 'Email Support', description: '12-hour response time', included: true },
        { id: 'f3', name: 'Mobile App', description: 'iOS and Android apps', included: true },
        { id: 'f4', name: 'Analytics', description: 'Advanced analytics', included: true },
        { id: 'f5', name: 'API Access', description: 'REST API access', included: true },
        {
          id: 'f6',
          name: 'Priority Support',
          description: 'Business hours support',
          included: true,
        },
        {
          id: 'f7',
          name: 'Custom Reports',
          description: 'Generate custom reports',
          included: true,
        },
      ],
      limits: {
        subscriptions: 50,
        users: 5,
        apiCalls: 10000,
      },
      isPopular: true,
      isRecommended: true,
      trialDays: 30,
      discount: {
        percentage: 20,
        validUntil: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'plan-premium',
      name: 'Premium',
      tier: 'premium',
      description: 'For growing businesses',
      price: 79.99,
      currency: 'USD',
      billingCycle: 'monthly',
      features: [
        {
          id: 'f1',
          name: 'Basic Dashboard',
          description: 'Access to basic dashboard',
          included: true,
        },
        { id: 'f2', name: 'Email Support', description: 'Priority email support', included: true },
        { id: 'f3', name: 'Mobile App', description: 'iOS and Android apps', included: true },
        {
          id: 'f4',
          name: 'Analytics',
          description: 'Advanced analytics with exports',
          included: true,
        },
        { id: 'f5', name: 'API Access', description: 'Full REST API access', included: true },
        {
          id: 'f6',
          name: 'Priority Support',
          description: '24/7 priority support',
          included: true,
        },
        {
          id: 'f7',
          name: 'Custom Reports',
          description: 'Unlimited custom reports',
          included: true,
        },
        { id: 'f8', name: 'White Label', description: 'Custom branding', included: true },
        { id: 'f9', name: 'Dedicated Manager', description: 'Account manager', included: true },
      ],
      limits: {
        subscriptions: -1, // Unlimited
        users: 20,
        apiCalls: -1, // Unlimited
      },
      isPopular: false,
      isRecommended: false,
      trialDays: 30,
      discount: {
        percentage: 25,
      },
      createdAt: now,
      updatedAt: now,
    },
  ];
}
