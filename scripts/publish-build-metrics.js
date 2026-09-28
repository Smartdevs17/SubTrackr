#!/usr/bin/env node
/**
 * scripts/publish-build-metrics.js
 *
 * Builds a SubTrackr build-report payload from the current GitHub Actions run
 * and POSTs it to the backend's build metrics ingest endpoint
 * (`POST /build/metrics`, issue #1285), so `GET /metrics/build` reflects real CI
 * duration, success rate and per-stage timings.
 *
 * Job timings come from the GitHub REST API, which is why each job in the
 * pipeline becomes a `stages[]` entry with a real duration instead of a guess.
 *
 * Usage:
 *   node scripts/publish-build-metrics.js            # build + POST
 *   node scripts/publish-build-metrics.js --dry-run  # print the report only
 *   node scripts/publish-build-metrics.js --strict   # exit 1 if publishing fails
 *
 * Environment:
 *   BUILD_METRICS_URL     Base URL of the backend (e.g. https://api.subtrackr.app)
 *   BUILD_METRICS_INGEST_TOKEN  Shared secret expected by the ingest endpoint
 *   BUILD_METRICS_PIPELINE     Pipeline label, defaults to "ci"
 *   BUILD_METRICS_REASON       Failure reason override (e.g. failed gate names)
 *   BUILD_METRICS_STARTED_AT   ISO run start; falls back to the job span
 *   GITHUB_TOKEN          Token used to read job timings (needs actions:read)
 *   GITHUB_REPOSITORY     owner/repo, defaults to ${{ github.repository }}
 *
 * Publishing is skipped (exit 0) when the URL or token is missing so forks and
 * PRs from forks — which cannot read repository secrets — do not fail CI.
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const GITHUB_API = 'https://api.github.com';

/** Map a GitHub Actions job/run conclusion onto the exporter's status set. */
function mapConclusion(conclusion) {
  switch (conclusion) {
    case 'success':
    case 'neutral':
      return 'success';
    case 'cancelled':
    case 'skipped':
      return 'cancelled';
    default:
      return 'failure';
  }
}

/** Milliseconds between two ISO timestamps, or null when either is unusable. */
function toMs(fromIso, toIso) {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return to - from;
}

/**
 * Fetch job timings for a workflow run. Returns [] when the API is
 * unreachable so the caller still publishes a pipeline-level run.
 */
function fetchJobs(env) {
  const runId = env.GITHUB_RUN_ID;
  const token = env.GITHUB_TOKEN;
  const repository = env.GITHUB_REPOSITORY;
  if (!runId || !token || !repository) return Promise.resolve([]);

  const url = `${GITHUB_API}/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`;

  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'subtrackr-build-metrics',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            console.warn(
              `[build-metrics] job API returned ${res.statusCode}; continuing without stages`
            );
            resolve([]);
            return;
          }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(Array.isArray(parsed.jobs) ? parsed.jobs : []);
          } catch (err) {
            console.warn(`[build-metrics] could not parse job API response: ${err.message}`);
            resolve([]);
          }
        });
      }
    );
    req.on('error', (err) => {
      console.warn(
        `[build-metrics] job API unavailable (${err.message}); continuing without stages`
      );
      resolve([]);
    });
    req.setTimeout(15_000, () => {
      req.destroy(new Error('job API request timed out'));
    });
  });
}

/** Turn job records into stage entries, dropping jobs with no usable timing. */
function toStages(jobs) {
  const stages = [];
  for (const job of jobs) {
    if (!job || typeof job.name !== 'string' || !job.name) continue;
    const durationMs =
      job.started_at && job.completed_at ? toMs(job.started_at, job.completed_at) : null;
    // A job with no timing is still worth counting; report it as zero-length
    // rather than dropping the failure signal entirely.
    stages.push({
      stage: job.name,
      durationMs: durationMs === null ? 0 : durationMs,
      status: mapConclusion(job.conclusion),
    });
  }
  return stages;
}

/**
 * Wall-clock duration of the run: the step-provided start time when present,
 * otherwise the span from the earliest job start to the latest job completion.
 */
function runDurationMs(env, jobs, now) {
  const startedAt = Date.parse(env.BUILD_METRICS_STARTED_AT || '');
  if (Number.isFinite(startedAt)) return Math.max(0, now - startedAt);

  const starts = jobs.map((j) => Date.parse((j && j.started_at) || '')).filter(Number.isFinite);
  const ends = jobs.map((j) => Date.parse((j && j.completed_at) || '')).filter(Number.isFinite);
  if (!starts.length || !ends.length) return 0;
  return Math.max(0, Math.max(...ends) - Math.min(...starts));
}

/**
 * Assemble the build report for the current run.
 *
 * @param env - Process environment (injected for tests).
 * @param jobs - Job records from the GitHub API.
 * @param durationMs - Run duration from `runDurationMs`.
 */
function buildReport(env, jobs, durationMs) {
  const stages = toStages(jobs);
  // The workflow can name the failed gates directly; otherwise derive the
  // reason from the stages the job API reported as failures.
  const failureReason =
    env.BUILD_METRICS_REASON ||
    stages
      .filter((s) => s.status === 'failure')
      .map((s) => s.stage)
      .join(', ');

  const report = {
    pipeline: env.BUILD_METRICS_PIPELINE || 'ci',
    // `status` is spelled the GitHub way, which the exporter folds onto its
    // own status set (see parseBuildRunInput).
    conclusion: mapConclusion(env.JOB_CONCLUSION || 'success'),
    runId: env.GITHUB_RUN_ID,
    commitSha: env.GITHUB_SHA,
    branch: env.GITHUB_REF_NAME,
    durationMs,
    stages,
  };
  if (failureReason) report.failureReason = failureReason.slice(0, 200);
  return report;
}

/** POST the report to the backend ingest endpoint. Resolves with the status. */
function publish(baseUrl, token, report) {
  const target = new URL('/build/metrics', baseUrl);
  // Self-hosted deployments terminate TLS elsewhere, so honour the scheme.
  const transport = target.protocol === 'http:' ? http : https;
  const payload = Buffer.from(JSON.stringify({ runs: [report] }), 'utf8');

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, body });
            return;
          }
          reject(new Error(`ingest endpoint returned ${res.statusCode}: ${body.slice(0, 300)}`));
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15_000, () => req.destroy(new Error('ingest request timed out')));
    req.write(payload);
    req.end();
  });
}

async function main(argv, env) {
  const dryRun = argv.includes('--dry-run');
  const strict = argv.includes('--strict');

  const jobs = await fetchJobs(env);
  const report = buildReport(env, jobs, runDurationMs(env, jobs, Date.now()));

  if (dryRun) {
    console.log(JSON.stringify({ runs: [report] }, null, 2));
    return 0;
  }

  const baseUrl = env.BUILD_METRICS_URL;
  const token = env.BUILD_METRICS_INGEST_TOKEN;
  if (!baseUrl || !token) {
    console.log('[build-metrics] BUILD_METRICS_URL / BUILD_METRICS_INGEST_TOKEN not set; skipping');
    return 0;
  }

  try {
    const res = await publish(baseUrl, token, report);
    console.log(`[build-metrics] published ${report.pipeline} run (HTTP ${res.status})`);
    return 0;
  } catch (err) {
    // Never fail a green pipeline because the metrics backend is unreachable.
    console.warn(`[build-metrics] publish failed: ${err.message}`);
    if (strict) return 1;
    return 0;
  }
}

module.exports = {
  mapConclusion,
  toMs,
  toStages,
  runDurationMs,
  buildReport,
  publish,
  main,
};

if (require.main === module) {
  main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code;
  });
}
