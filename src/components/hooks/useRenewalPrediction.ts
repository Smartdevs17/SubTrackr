import { useEffect, useState } from 'react';
import { Subscription } from '../../types/subscription';
import {
  renewalPredictionService,
  ChurnRiskAssessment,
} from '../../services/renewalPredictionService';

interface UseRenewalPredictionOptions {
  subscriptions: Subscription[];
  onHighRiskDetected?: (assessment: ChurnRiskAssessment) => void;
  checkIntervalMs?: number;
}

export function useRenewalPrediction({
  subscriptions,
  onHighRiskDetected,
  checkIntervalMs = 24 * 60 * 60 * 1000, // 24 hours
}: UseRenewalPredictionOptions) {
  const [assessments, setAssessments] = useState<ChurnRiskAssessment[]>([]);
  const [highRiskCount, setHighRiskCount] = useState(0);

  useEffect(() => {
    if (subscriptions.length === 0) return;

    const checkRenewalRisks = () => {
      const newAssessments = renewalPredictionService.batchAssessChurnRisk(subscriptions);
      setAssessments(newAssessments);

      const highRisk = newAssessments.filter((a) => a.riskLevel === 'high');
      setHighRiskCount(highRisk.length);

      // Notify about new high-risk subscriptions
      highRisk.forEach((assessment) => {
        onHighRiskDetected?.(assessment);
      });
    };

    checkRenewalRisks();
    const interval = setInterval(checkRenewalRisks, checkIntervalMs);

    return () => clearInterval(interval);
  }, [subscriptions, onHighRiskDetected, checkIntervalMs]);

  return {
    assessments,
    highRiskCount,
    highRiskSubscriptions: assessments.filter((a) => a.riskLevel === 'high'),
  };
}
