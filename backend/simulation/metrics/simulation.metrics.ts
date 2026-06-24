import { logger } from '../../services/shared/logging';

export class SimulationMetrics {
  private requestsTotal = 0;
  private successTotal = 0;
  private failureTotal = 0;
  private durationMsTotal = 0;
  private actualGasEstimatesCount = 0;
  private gasAccuracySum = 0; // sum of 1 - abs(actualGas - estimatedGas) / actualGas
  private predictionsTotal = 0;
  private correctPredictionsTotal = 0;

  recordRequest(): void {
    this.requestsTotal++;
  }

  recordSuccess(durationMs: number): void {
    this.successTotal++;
    this.durationMsTotal += durationMs;
  }

  recordFailure(durationMs: number): void {
    this.failureTotal++;
    this.durationMsTotal += durationMs;
  }

  recordGasAccuracy(estimatedGas: number, actualGas: number): void {
    if (actualGas > 0) {
      const accuracy = 1 - Math.abs(actualGas - estimatedGas) / actualGas;
      this.gasAccuracySum += accuracy;
      this.actualGasEstimatesCount++;
    }
  }

  recordPredictionAccuracy(isCorrect: boolean): void {
    this.predictionsTotal++;
    if (isCorrect) {
      this.correctPredictionsTotal++;
    }
  }

  getMetrics() {
    return {
      simulation_requests_total: this.requestsTotal,
      simulation_success_total: this.successTotal,
      simulation_failure_total: this.failureTotal,
      simulation_duration_ms: this.durationMsTotal / (this.requestsTotal || 1),
      simulation_gas_accuracy_percent: this.actualGasEstimatesCount > 0
        ? (this.gasAccuracySum / this.actualGasEstimatesCount) * 100
        : 0,
      simulation_prediction_accuracy_percent: this.predictionsTotal > 0
        ? (this.correctPredictionsTotal / this.predictionsTotal) * 100
        : 0,
    };
  }

  logMetrics(): void {
    logger.info('Simulation metrics summary', this.getMetrics());
  }
}

export const simulationMetrics = new SimulationMetrics();
