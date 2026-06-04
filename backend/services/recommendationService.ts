const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

export interface Recommendation {
  id: string;
  name: string;
  category: string;
  price: number;
  confidenceScore: number;
}

export interface RecommendationContext {
  activeSubscriptions: string[];
  userProfile: {
    interests: string[];
  };
}

export class RecommendationService {
  static async getRecommendations(
    subscriberAddress: string,
    context?: RecommendationContext
  ): Promise<Recommendation[]> {
    const res = await fetch(`${ML_SERVICE_URL}/v1/recommendations/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriber: subscriberAddress,
        context: context
          ? {
              active_subscriptions: context.activeSubscriptions,
              user_profile: { interests: context.userProfile.interests },
            }
          : null,
      }),
    });

    if (!res.ok) throw new Error(`ML service error: ${res.status}`);

    const data = await res.json();
    return data.recommendations.map((r: any) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      price: r.price,
      confidenceScore: r.confidence_score,
    }));
  }

  static async getRecommendationsBatch(
    items: Array<{ subscriberAddress: string; context?: RecommendationContext }>
  ): Promise<Array<{ subscriberAddress: string; recommendations: Recommendation[] }>> {
    const res = await fetch(`${ML_SERVICE_URL}/v1/recommendations/predict/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((i) => ({
          subscriber: i.subscriberAddress,
          context: i.context
            ? {
                active_subscriptions: i.context.activeSubscriptions,
                user_profile: { interests: i.context.userProfile.interests },
              }
            : null,
        })),
      }),
    });

    if (!res.ok) throw new Error(`ML service error: ${res.status}`);

    const data = await res.json();
    return data.results
      .filter((r: any) => r.ok)
      .map((r: any) => ({
        subscriberAddress: r.subscriber,
        recommendations: r.recommendations.map((rec: any) => ({
          id: rec.id,
          name: rec.name,
          category: rec.category,
          price: rec.price,
          confidenceScore: rec.confidence_score,
        })),
      }));
  }

  /**
   * Record whether a recommendation was accepted.
   * Feeds back into accuracy tracking and drift detection on the ML service.
   */
  static async recordFeedback(
    subscriberAddress: string,
    recommendationId: string,
    accepted: boolean
  ): Promise<{ driftDetected: boolean; recentAccuracy: number | null }> {
    const res = await fetch(`${ML_SERVICE_URL}/v1/recommendations/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriber: subscriberAddress,
        recommendation_id: recommendationId,
        accepted,
      }),
    });

    if (!res.ok) return { driftDetected: false, recentAccuracy: null };

    const data = await res.json();
    return {
      driftDetected: data.drift_detected,
      recentAccuracy: data.recent_accuracy,
    };
  }
}
