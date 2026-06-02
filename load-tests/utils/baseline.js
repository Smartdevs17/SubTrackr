// Baseline comparison for k6 results.
//
// Compares the end-of-test metric summary against load-tests/baseline.json and
// flags regressions (a measured value worse than baseline by more than the
// configured tolerance). Returned data is embedded in the generated report and
// printed to stdout so CI surfaces regressions even when raw thresholds pass.

import baseline from '../baseline.json';

function pct(measured, base) {
  if (base === 0) return measured === 0 ? 0 : 100;
  return ((measured - base) / base) * 100;
}

function metricValue(metric, stat) {
  if (!metric || !metric.values) return undefined;
  const v = metric.values;
  switch (stat) {
    case 'p95':
      return v['p(95)'];
    case 'p99':
      return v['p(99)'];
    case 'avg':
      return v.avg;
    case 'rate':
      return v.rate;
    default:
      return v[stat];
  }
}

/**
 * @param {object} data - k6 summary `data` object (data.metrics)
 * @returns {{ regressions: Array, comparisons: Array, text: string }}
 */
export function checkBaseline(data) {
  const tolerance = baseline.tolerancePct ?? 15;
  const comparisons = [];
  const regressions = [];

  const considerStat = (name, metricKey, stat, base, unit) => {
    const measured = metricValue(data.metrics[metricKey], stat);
    if (measured === undefined) return;
    const delta = pct(measured, base);
    const regressed = delta > tolerance;
    const row = {
      name: `${name} (${stat})`,
      measured: Math.round(measured * 100) / 100,
      baseline: base,
      deltaPct: Math.round(delta * 10) / 10,
      unit: unit || '',
      regressed,
    };
    comparisons.push(row);
    if (regressed) regressions.push(row);
  };

  // Top-level metrics.
  for (const [metricKey, spec] of Object.entries(baseline.metrics || {})) {
    for (const stat of ['p95', 'p99', 'avg', 'rate']) {
      if (spec[stat] !== undefined) {
        considerStat(metricKey, metricKey, stat, spec[stat], spec.unit);
      }
    }
  }

  // Per-endpoint sub-metrics (k6 exposes tagged submetrics as
  // "endpoint_latency{endpoint:create_subscription}").
  for (const [endpoint, spec] of Object.entries(baseline.endpoints || {})) {
    const subKey = `endpoint_latency{endpoint:${endpoint}}`;
    if (spec.p95 !== undefined) {
      considerStat(`endpoint:${endpoint}`, subKey, 'p95', spec.p95, spec.unit);
    }
  }

  let text = '\n=== Baseline comparison (tolerance ' + tolerance + '%) ===\n';
  if (comparisons.length === 0) {
    text += 'No comparable metrics found in this run.\n';
  } else {
    for (const c of comparisons) {
      const flag = c.regressed ? 'REGRESSION' : 'ok';
      const sign = c.deltaPct >= 0 ? '+' : '';
      text += `  [${flag}] ${c.name}: ${c.measured}${c.unit} vs baseline ${c.baseline}${c.unit} (${sign}${c.deltaPct}%)\n`;
    }
  }
  if (regressions.length > 0) {
    text += `\n${regressions.length} performance regression(s) detected against baseline.\n`;
  }

  return { regressions, comparisons, text };
}
