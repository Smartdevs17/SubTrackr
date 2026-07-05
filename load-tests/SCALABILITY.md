# Scalability & Bottleneck Identification

How to read a load-test run and find the scaling limit.

## Where the numbers come from

Every run writes `load-tests/reports/summary.{json,md,html}` and prints a stdout
summary. The report contains:

- **Overall latency** (avg / p95 / p99 / max) and **error rate**.
- **Per-endpoint latency** (`endpoint_latency`, tagged by `endpoint`), sorted
  slowest-first. The top row is the primary bottleneck for that load profile.
- **Threshold pass/fail** — each budget in `config/options.js`.
- **Baseline comparison** — measured vs `baseline.json` with a Δ% and regression
  flag.

## Identifying the bottleneck

1. **Find the saturation point.** Run the ramping profile (`subscription`/
   default). Watch where p95 latency starts climbing faster than the request
   rate and where `http_req_failed` first becomes non-zero. That VU level is the
   approximate capacity ceiling.
2. **Attribute it to an endpoint.** Open the per-endpoint table. The endpoint
   with the highest p95 under load — and the first to breach its budget — is the
   bottleneck. Contract endpoints (`contract_*`) are expected to be slower; only
   compare them against their own (higher) budgets.
3. **Classify the limit:**
   - latency rises but errors stay ~0 → compute / DB / dependency saturation.
   - errors spike (timeouts, 5xx) at a VU threshold → connection pool, rate
     limiter, or downstream capacity.
   - latency flat but throughput plateaus → a hard concurrency cap upstream.
4. **Confirm with the burst profile** (`billing`) to see behaviour under a sudden
   spike, and the **sustained profile** (`user`) for soak/leak behaviour over
   5 minutes.

## Load profiles

| Profile (`SCENARIO`) | Shape | Purpose |
|---|---|---|
| `subscription` (default) | ramp 0→50→0 | Capacity / saturation point of the full flow |
| `billing` | burst spike to 200 | Resilience to traffic spikes (automated billing) |
| `user` | sustained 100 VUs / 5m | Soak test, memory/connection leaks |
| `contract` | ramp | On-chain (Soroban-simulated) call latency in isolation |

## Acting on findings

- Record the saturation VU level and the limiting endpoint in the PR.
- If a fix improves things, re-run and update `baseline.json` deliberately
  (see README). If it regresses, the baseline check fails and the report shows
  the Δ%.
- File follow-ups for any endpoint that breaches its budget at the target load.
