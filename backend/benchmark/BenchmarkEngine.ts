const EPSILON = 1.0;
const MIN_COHORT_SIZE = 10;

export interface MerchantMetrics {
  merchantId: string;
  mrrGrowth: number;
  churnRate: number;
  conversionRate: number;
  arpa: number;
}

export interface BenchmarkMetric {
  merchantValue: number;
  p25: number;
  p50: number;
  p75: number;
  unit: string;
  cohortSize: number;
}

export interface BenchmarkReport {
  merchantId: string;
  vertical: string;
  region: string;
  companySize: string;
  generatedAt: Date;
  metrics: {
    mrrGrowth: BenchmarkMetric;
    churnRate: BenchmarkMetric;
    conversionRate: BenchmarkMetric;
    arpa: BenchmarkMetric;
  };
  trend: 'improving' | 'declining' | 'stable';
}

function addLaplaceNoise(value: number, epsilon: number, sensitivity: number): number {
  const scale = sensitivity / epsilon;
  const u = Math.random() - 0.5;
  return value + scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

export class BenchmarkEngine {
  generateReport(
    merchant: MerchantMetrics,
    peers: MerchantMetrics[],
    vertical: string,
    region: string,
    companySize: string,
  ): BenchmarkReport | null {
    if (peers.length < MIN_COHORT_SIZE) {
      return null;
    }

    const computeMetric = (
      merchantVal: number,
      values: number[],
      unit: string,
    ): BenchmarkMetric => {
      const sorted = [...values].sort((a, b) => a - b);
      const len = sorted.length;
      const p25 = sorted[Math.floor(len * 0.25)];
      const p50 = sorted[Math.floor(len * 0.5)];
      const p75 = sorted[Math.floor(len * 0.75)];

      return {
        merchantValue: addLaplaceNoise(merchantVal, EPSILON, 0.1),
        p25: addLaplaceNoise(p25, EPSILON, 0.1),
        p50: addLaplaceNoise(p50, EPSILON, 0.1),
        p75: addLaplaceNoise(p75, EPSILON, 0.1),
        unit,
        cohortSize: len,
      };
    };

    const peerValues = peers.map((p) => p);

    return {
      merchantId: merchant.merchantId,
      vertical,
      region,
      companySize,
      generatedAt: new Date(),
      metrics: {
        mrrGrowth: computeMetric(
          merchant.mrrGrowth,
          peerValues.map((p) => p.mrrGrowth),
          '%',
        ),
        churnRate: computeMetric(
          merchant.churnRate,
          peerValues.map((p) => p.churnRate),
          '%',
        ),
        conversionRate: computeMetric(
          merchant.conversionRate,
          peerValues.map((p) => p.conversionRate),
          '%',
        ),
        arpa: computeMetric(
          merchant.arpa,
          peerValues.map((p) => p.arpa),
          'USD',
        ),
      },
      trend: this.determineTrend(merchant, peerValues),
    };
  }

  private determineTrend(
    merchant: MerchantMetrics,
    peers: MerchantMetrics[],
  ): 'improving' | 'declining' | 'stable' {
    const avgChurn = peers.reduce((s, p) => s + p.churnRate, 0) / peers.length;
    const avgMrrGrowth = peers.reduce((s, p) => s + p.mrrGrowth, 0) / peers.length;

    const churnBetter = merchant.churnRate < avgChurn * 0.9;
    const growthBetter = merchant.mrrGrowth > avgMrrGrowth * 1.1;

    if (churnBetter && growthBetter) return 'improving';
    if (!churnBetter && !growthBetter) return 'declining';
    return 'stable';
  }
}
