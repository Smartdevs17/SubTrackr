/** End-to-end test of `subtrackr subscriptions import` against a local fake API. */
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const CLI = path.resolve(__dirname, '../../../../bin/subtrackr.js');

interface Fake {
  url: string;
  posted: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

async function startFakeApi(existing: unknown[], rejectName?: string): Promise<Fake> {
  const posted: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET') return res.end(JSON.stringify({ data: existing }));
      const body = JSON.parse(raw);
      if (body.name === rejectName) {
        res.statusCode = 422;
        return res.end(JSON.stringify({ error: 'rejected by server' }));
      }
      posted.push(body);
      res.statusCode = 201;
      res.end(JSON.stringify({ id: posted.length }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    posted,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

function runCli(args: string[], baseUrl: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [CLI, ...args, '--api-key', 'sk_test', '--base-url', baseUrl, '--no-summary', '--format', 'json'],
      { env: { ...process.env, HOME: os.tmpdir(), NO_COLOR: '1' } },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function csvFile(content: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'import-')), 'subs.csv');
  fs.writeFileSync(file, content);
  return file;
}

const CSV = [
  'name,price,currency,billing_cycle',
  'Netflix,15.49,USD,monthly',
  'Existing,5,USD,monthly',
  'Netflix,15.49,usd,monthly',
  'Broken,abc,USD,monthly',
  'ServerNo,3,USD,monthly',
].join('\n');

describe('subtrackr subscriptions import', () => {
  it('imports, skips duplicates, reports per-row errors and exits non-zero on failures', async () => {
    const api = await startFakeApi([{ name: 'Existing', currency: 'USD', billing_cycle: 'monthly' }], 'ServerNo');
    try {
      const { code, stdout } = await runCli(['subscriptions', 'import', csvFile(CSV)], api.url);
      const summary = JSON.parse(stdout);
      expect(code).toBe(1);
      expect(summary).toMatchObject({ total: 5, created: 1, duplicates: 2, failed: 2, dryRun: false });
      expect(api.posted).toHaveLength(1);
      expect(api.posted[0]).toMatchObject({ name: 'Netflix', price: 15.49, currency: 'USD', billing_cycle: 'monthly' });
      expect(summary.rows[3].errors[0]).toMatch(/price/);
      expect(summary.rows[4].errors[0]).toMatch(/422/);
    } finally {
      await api.close();
    }
  });

  it('--dry-run (before or after the file) posts nothing', async () => {
    const api = await startFakeApi([]);
    try {
      const file = csvFile('name,price,currency,billing_cycle\nA,1,USD,monthly\nB,2,USD,yearly\n');
      for (const args of [
        ['subscriptions', 'import', '--dry-run', file],
        ['subscriptions', 'import', file, '--dry-run'],
      ]) {
        const { code, stdout } = await runCli(args, api.url);
        expect(code).toBe(0);
        expect(JSON.parse(stdout)).toMatchObject({ dryRun: true, created: 2, failed: 0 });
      }
      expect(api.posted).toHaveLength(0);
    } finally {
      await api.close();
    }
  });

  it('fails fast on missing columns and unreadable files', async () => {
    const api = await startFakeApi([]);
    try {
      const bad = await runCli(['subscriptions', 'import', csvFile('name,price\nA,1\n')], api.url);
      expect(bad.code).toBe(1);
      expect(bad.stderr).toMatch(/Missing required column/);
      const none = await runCli(['subscriptions', 'import', '/nonexistent/file.csv'], api.url);
      expect(none.code).toBe(1);
      expect(none.stderr).toMatch(/Cannot read/);
      expect(api.posted).toHaveLength(0);
    } finally {
      await api.close();
    }
  });
});
