import { useHealthStore } from '../store/healthStore';
import { HealthScoreBreakdown, HealthScoreStatus, InterventionType } from '../types/health';

export class HealthScoreService {
  static calculate(
    subscriptionId: string,
    userId: string,
    factors: Partial<HealthScoreBreakdown>,
    weights?: Parameters<typeof useHealthStore.getState().calculateScore>[3]
  ) {
    return useHealthStore.getState().calculateScore(subscriptionId, userId, factors, weights);
  }

  static getScore(subscriptionId: string) {
    return useHealthStore.getState().getScore(subscriptionId);
  }

  static getScoresByUser(userId: string) {
    return useHealthStore.getState().getScoresByUser(userId);
  }

  static overrideScore(
    subscriptionId: string,
    newScore: number,
    reason: string,
    overriddenBy: string
  ) {
    return useHealthStore.getState().overrideScore(subscriptionId, newScore, reason, overriddenBy);
  }

  static triggerIntervention(healthScoreId: string, type: InterventionType) {
    return useHealthStore.getState().recordIntervention(healthScoreId, type);
  }

  static getHistory(healthScoreId: string) {
    return useHealthStore.getState().getHistory(healthScoreId);
  }

  static getInterventions(healthScoreId: string) {
    return useHealthStore.getState().getInterventions(healthScoreId);
  }

  static updateWeights(weights: Parameters<typeof useHealthStore.getState().updateWeights>[0]) {
    useHealthStore.getState().updateWeights(weights);
  }

  static getWeights() {
    return useHealthStore.getState().getWeights();
  }

  static getTrend(healthScoreId: string): 'improving' | 'stable' | 'declining' {
    const history = useHealthStore.getState().getHistory(healthScoreId);
    if (history.length < 2) return 'stable';
    const recent = history.slice(-3);
    const first = recent[0].score;
    const last = recent[recent.length - 1].score;
    if (last > first + 5) return 'improving';
    if (last < first - 5) return 'declining';
    return 'stable';
  }
}
