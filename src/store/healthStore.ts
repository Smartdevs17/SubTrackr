import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { debouncedAsyncStorageAdapter } from '../utils/storage';
import {
  HealthScore,
  HealthScoreHistory,
  Intervention,
  HealthScoreStatus,
  HealthScoreWeights,
  DEFAULT_WEIGHTS,
  SCORE_THRESHOLDS,
  HealthScoreBreakdown,
} from '../types/health';
import { errorHandler, AppError } from '../services/errorHandler';
import { useSettingsStore } from './settingsStore';

const STORAGE_KEY = 'subtrackr-health-scores';
const HISTORY_STORAGE_KEY = 'subtrackr-health-score-history';
const INTERVENTION_STORAGE_KEY = 'subtrackr-interventions';

const generateId = (): string => `hs-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

interface HealthState {
  healthScores: HealthScore[];
  history: HealthScoreHistory[];
  interventions: Intervention[];
  isLoading: boolean;
  error: AppError | null;

  calculateScore: (
    subscriptionId: string,
    userId: string,
    factors: Partial<HealthScoreBreakdown>,
    weights?: HealthScoreWeights
  ) => HealthScore;

  getScore: (subscriptionId: string) => HealthScore | undefined;
  getScoresByUser: (userId: string) => HealthScore[];

  overrideScore: (
    subscriptionId: string,
    newScore: number,
    reason: string,
    overriddenBy: string
  ) => HealthScore | undefined;

  recordIntervention: (healthScoreId: string, type: Intervention['type']) => Intervention;

  getHistory: (healthScoreId: string) => HealthScoreHistory[];
  getInterventions: (healthScoreId: string) => Intervention[];

  updateWeights: (weights: HealthScoreWeights) => void;
  getWeights: () => HealthScoreWeights;
}

export const useHealthStore = create<HealthState>()(
  persist(
    (set, get) => ({
      healthScores: [],
      history: [],
      interventions: [],
      isLoading: false,
      error: null,

      calculateScore: (subscriptionId, userId, factors, weights = DEFAULT_WEIGHTS) => {
        const state = get();
        const existing = state.healthScores.find(
          (h) => h.subscriptionId === subscriptionId && h.userId === userId
        );

        const loginScore = factors.loginFrequency ?? 0;
        const featureScore = factors.featureUsage ?? 0;
        const paymentScore = factors.paymentSuccessRate ?? 0;
        const supportScore = Math.max(0, 100 - (factors.supportTickets ?? 0));
        const npsScore = factors.npsResponse ?? 50;

        const overall =
          loginScore * weights.loginFrequency +
          featureScore * weights.featureUsage +
          paymentScore * weights.paymentSuccessRate +
          supportScore * weights.supportTickets +
          npsScore * weights.npsResponse;

        const clampedOverall = Math.round(Math.min(100, Math.max(0, overall)));

        let status: HealthScoreStatus;
        if (clampedOverall >= SCORE_THRESHOLDS.GREEN_MIN) status = HealthScoreStatus.GREEN;
        else if (clampedOverall >= SCORE_THRESHOLDS.YELLOW_MIN) status = HealthScoreStatus.YELLOW;
        else status = HealthScoreStatus.RED;

        const now = new Date();
        const score: HealthScore = {
          id: existing?.id ?? generateId(),
          subscriptionId,
          userId,
          score: clampedOverall,
          status,
          breakdown: {
            overall: clampedOverall,
            loginFrequency: Math.round(loginScore),
            featureUsage: Math.round(featureScore),
            paymentSuccessRate: Math.round(paymentScore),
            supportTickets: Math.round(supportScore),
            npsResponse: Math.round(npsScore),
          },
          weights: { ...weights },
          calculatedAt: now,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };

        const historyEntry: HealthScoreHistory = {
          id: `hsh-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          healthScoreId: score.id,
          score: clampedOverall,
          status,
          calculatedAt: now,
        };

        set((state) => ({
          healthScores: state.healthScores.some((h) => h.id === score.id)
            ? state.healthScores.map((h) => (h.id === score.id ? score : h))
            : [...state.healthScores, score],
          history: [...state.history, historyEntry],
        }));

        if (status === HealthScoreStatus.RED && (!existing || existing.status !== HealthScoreStatus.RED)) {
          get().recordIntervention(score.id, InterventionType.PRIORITY_EMAIL);
          get().recordIntervention(score.id, InterventionType.ACCOUNT_MANAGER_ALERT);
        }

        return score;
      },

      getScore: (subscriptionId) => {
        return get().healthScores.find((h) => h.subscriptionId === subscriptionId);
      },

      getScoresByUser: (userId) => {
        return get().healthScores.filter((h) => h.userId === userId);
      },

      overrideScore: (subscriptionId, newScore, reason, overriddenBy) => {
        const state = get();
        const existing = state.healthScores.find((h) => h.subscriptionId === subscriptionId);
        if (!existing) return undefined;

        const now = new Date();
        const updated: HealthScore = {
          ...existing,
          score: Math.round(Math.min(100, Math.max(0, newScore))),
          status:
            existing.score >= SCORE_THRESHOLDS.GREEN_MIN
              ? HealthScoreStatus.GREEN
              : existing.score >= SCORE_THRESHOLDS.YELLOW_MIN
                ? HealthScoreStatus.YELLOW
                : HealthScoreStatus.RED,
          manualOverride: newScore,
          manualOverrideReason: reason,
          manualOverrideBy: overriddenBy,
          manualOverrideAt: now,
          updatedAt: now,
        };

        set((state) => ({
          healthScores: state.healthScores.map((h) => (h.id === existing.id ? updated : h)),
        }));

        return updated;
      },

      recordIntervention: (healthScoreId, type) => {
        const intervention: Intervention = {
          id: `int-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          healthScoreId,
          type,
          triggeredAt: new Date(),
        };

        set((state) => ({
          interventions: [...state.interventions, intervention],
        }));

        return intervention;
      },

      getHistory: (healthScoreId) => {
        return get().history.filter((h) => h.healthScoreId === healthScoreId);
      },

      getInterventions: (healthScoreId) => {
        return get().interventions.filter((i) => i.healthScoreId === healthScoreId);
      },

      updateWeights: (weights) => {
        useSettingsStore.setState({ healthScoreWeights: weights });
      },

      getWeights: () => {
        const settings = useSettingsStore.getState();
        return (settings.healthScoreWeights as HealthScoreWeights) ?? DEFAULT_WEIGHTS;
      },
    }),
    {
      name: STORAGE_KEY,
      storage: debouncedAsyncStorageAdapter,
      version: 0,
    }
  )
);
