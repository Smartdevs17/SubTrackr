// Report generation for k6 runs.
//
// Exported `handleSummary` is picked up by k6 at the end of a test and writes:
//   - load-tests/reports/summary.json  (raw metrics, for tooling / trend tracking)
//   - load-tests/reports/summary.md    (human-readable report + baseline diff)
//   - load-tests/reports/summary.html  (rich report for CI artifacts)
// plus a concise text summary to stdout.
//
// Self-contained (no remote jslib import) so it works in offline / CI sandboxes.

import { checkBaseline } from './baseline.js';

function fmt(n, digits = 2) {
  if (n === undefined || n === null || Number.isNaN(n)) return 'n/a';
  return Number(n).toFixed(digits);
}

function metric(data, key) {
  const m = data.metrics[key];
  return m ? m.values : {};
}

function thresholdStatus(data) {
  const rows = [];
  for (const [name, m] of Object.entries(data.metrics)) {
    if (m.thresholds) {
      for (const [expr, res] of Object.entries(m.thresholds)) {
        const ok = res && res.ok !== false;
        rows.push({ name: `${name}: ${expr}`, ok });
      }
    }
  }
  return rows;
}

function endpointBreakdown(data) {
  const rows = [];
  for (const [key, m] of Object.entries(data.metrics)) {
    if (key.startsWith('endpoint_latency{')) {
      const endpoint = key.slice('endpoint_latency{endpoint:'.length, -1);
      rows.push({
        endpoint,
        avg: m.values.avg,
        p95: m.values['p(95)'],
        max: m.values.max,
        count: m.values.count,
      });
    }
  }
  rows.sort((a, b) => (b.p95 || 0) - (a.p95 || 0));
  return rows;
}

function textReport(data, baseline) {
  const dur = metric(data, 'http_req_duration');
  const failed = metric(data, 'http_req_failed');
  const reqs = metric(data, 'http_reqs');
  const thresholds = thresholdStatus(data);
  const failedThresholds = thresholds.filter((t) => !t.ok);

  let out = '\n========== SubTrackr Load Test Summary ==========\n';
  out += `Total requests:   ${reqs.count ?? 0} (${fmt(reqs.rate)}/s)\n`;
  out += `Latency avg/p95/p99/max: ${fmt(dur.avg)} / ${fmt(dur['p(95)'])} / ${fmt(dur['p(99)'])} / ${fmt(dur.max)} ms\n`;
  out += `Error rate:       ${fmt((failed.rate ?? 0) * 100)}%\n`;
  out += `Thresholds:       ${thresholds.length - failedThresholds.length}/${thresholds.length} passed\n`;

  const eps = endpointBreakdown(data);
  if (eps.length) {
    out += '\nPer-endpoint p95 (slowest first — likely bottleneck at top):\n';
    for (const e of eps) {
      out += `  ${e.endpoint.padEnd(30)} p95=${fmt(e.p95)}ms avg=${fmt(e.avg)}ms n=${e.count ?? 0}\n`;
    }
  }
  out += baseline.text;
  if (failedThresholds.length) {
    out += `\nFAILED THRESHOLDS:\n`;
    for (const t of failedThresholds) out += `  - ${t.name}\n`;
  }
  out += '=================================================\n';
  return out;
}

function mdReport(data, baseline) {
  const dur = metric(data, 'http_req_duration');
  const failed = metric(data, 'http_req_failed');
  const reqs = metric(data, 'http_reqs');
  const eps = endpointBreakdown(data);
  const thresholds = thresholdStatus(data);

  let md = `# SubTrackr Load Test Report\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Total requests | ${reqs.count ?? 0} (${fmt(reqs.rate)}/s) |\n`;
  md += `| Latency avg | ${fmt(dur.avg)} ms |\n`;
  md += `| Latency p95 | ${fmt(dur['p(95)'])} ms |\n`;
  md += `| Latency p99 | ${fmt(dur['p(99)'])} ms |\n`;
  md += `| Latency max | ${fmt(dur.max)} ms |\n`;
  md += `| Error rate | ${fmt((failed.rate ?? 0) * 100)}% |\n\n`;

  md += `## Thresholds\n\n`;
  if (thresholds.length === 0) md += `_No thresholds configured._\n\n`;
  else {
    md += `| Threshold | Status |\n|---|---|\n`;
    for (const t of thresholds) md += `| ${t.name} | ${t.ok ? '✅ pass' : '❌ FAIL'} |\n`;
    md += `\n`;
  }

  if (eps.length) {
    md += `## Per-endpoint latency (slowest first)\n\n`;
    md += `| Endpoint | p95 (ms) | avg (ms) | max (ms) | requests |\n|---|---|---|---|---|\n`;
    for (const e of eps) {
      md += `| ${e.endpoint} | ${fmt(e.p95)} | ${fmt(e.avg)} | ${fmt(e.max)} | ${e.count ?? 0} |\n`;
    }
    md += `\n> The endpoint at the top of this table is the primary scalability bottleneck under this load profile. See [SCALABILITY.md](../SCALABILITY.md).\n\n`;
  }

  md += `## Baseline comparison\n\n`;
  if (baseline.comparisons.length === 0) md += `_No comparable baseline metrics._\n\n`;
  else {
    md += `| Metric | Measured | Baseline | Δ% | Status |\n|---|---|---|---|---|\n`;
    for (const c of baseline.comparisons) {
      md += `| ${c.name} | ${c.measured}${c.unit} | ${c.baseline}${c.unit} | ${c.deltaPct >= 0 ? '+' : ''}${c.deltaPct}% | ${c.regressed ? '❌ regression' : '✅ ok'} |\n`;
    }
    md += `\n`;
  }
  if (baseline.regressions.length > 0) {
    md += `> ⚠️ **${baseline.regressions.length} regression(s)** detected against the performance baseline.\n`;
  }
  return md;
}

function htmlReport(data, baseline) {
  const md = mdReport(data, baseline)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>SubTrackr Load Test Report</title>
<style>body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
pre{white-space:pre-wrap;background:#f6f8fa;padding:1rem;border-radius:8px}</style></head>
<body><pre>${md}</pre></body></html>`;
}

export function handleSummary(data) {
  const baseline = checkBaseline(data);
  return {
    stdout: textReport(data, baseline),
    'load-tests/reports/summary.json': JSON.stringify(data, null, 2),
    'load-tests/reports/summary.md': mdReport(data, baseline),
    'load-tests/reports/summary.html': htmlReport(data, baseline),
  };
}
