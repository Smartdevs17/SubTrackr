/**
 * workers/src/lib/__tests__/httpEgress.test.ts
 *
 * Unit tests for the worker-specific HTTP egress allow-list module.
 */

import {
  WORKER_EGRESS_CONFIG,
  createWorkerEgressChecker,
  checkEgress,
  compileEgressConfig,
  patternToRegex,
  type EgressConfig,
} from '../httpEgress';

describe('WORKER_EGRESS_CONFIG', () => {
  it('includes all backend defaults', () => {
    const stripeRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'api.stripe.com'
    );
    expect(stripeRule).toBeDefined();

    const paypalRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'api.paypal.com'
    );
    expect(paypalRule).toBeDefined();

    const googleRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === '*.googleapis.com'
    );
    expect(googleRule).toBeDefined();

    const localhostRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'localhost'
    );
    expect(localhostRule).toBeDefined();
  });

  it('includes Soroban Mainnet RPC', () => {
    const rpcRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'rpc.soroban-mainnet.com'
    );
    expect(rpcRule).toBeDefined();
    expect(rpcRule?.methods).toContain('POST');
  });

  it('includes Soroban Testnet RPC', () => {
    const rpcRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'rpc.soroban-testnet.com'
    );
    expect(rpcRule).toBeDefined();
  });

  it('includes Soroban RPC wildcard', () => {
    const rpcRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === '*.soroban-rpc.com'
    );
    expect(rpcRule).toBeDefined();
  });

  it('includes Stellar Soroban Mainnet RPC', () => {
    const rpcRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'soroban-rpc.mainnet.stellar.org'
    );
    expect(rpcRule).toBeDefined();
  });

  it('includes Stellar Soroban Testnet RPC', () => {
    const rpcRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'soroban-rpc.testnet.stellar.org'
    );
    expect(rpcRule).toBeDefined();
  });

  it('includes Stellar Expert API', () => {
    const expertRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'api.stellar.expert'
    );
    expect(expertRule).toBeDefined();
  });

  it('includes Horizon Mainnet', () => {
    const horizonRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'horizon.stellar.org'
    );
    expect(horizonRule).toBeDefined();
  });

  it('includes Horizon Testnet', () => {
    const horizonRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === 'horizon-testnet.stellar.org'
    );
    expect(horizonRule).toBeDefined();
  });

  it('includes Ngrok tunnels for development', () => {
    const ngrokRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === '*.ngrok.io'
    );
    expect(ngrokRule).toBeDefined();

    const ngrokFreeRule = WORKER_EGRESS_CONFIG.allowList.find(
      (r) => r.hostPattern === '*.ngrok-free.app'
    );
    expect(ngrokFreeRule).toBeDefined();
  });

  it('has defaultDeny = true', () => {
    expect(WORKER_EGRESS_CONFIG.defaultDeny).toBe(true);
  });
});

describe('createWorkerEgressChecker', () => {
  it('creates a checker with worker defaults', () => {
    const checker = createWorkerEgressChecker();
    // Should allow Soroban RPC
    expect(checker.check('https://rpc.soroban-mainnet.com').allowed).toBe(true);
    expect(checker.check('https://rpc.soroban-testnet.com').allowed).toBe(true);
    // Should allow Horizon
    expect(checker.check('https://horizon.stellar.org/accounts/...').allowed).toBe(true);
    // Should allow Ngrok
    expect(checker.check('https://abc123.ngrok.io/webhook').allowed).toBe(true);
    // Should deny unknown
    expect(checker.check('https://evil.com/steal').allowed).toBe(false);
  });

  it('allows custom config override', () => {
    const customConfig: EgressConfig = {
      defaultDeny: true,
      allowList: [
        { hostPattern: 'custom.worker.api', description: 'Custom Worker API' },
      ],
    };
    const checker = createWorkerEgressChecker(customConfig);
    expect(checker.check('https://custom.worker.api/endpoint').allowed).toBe(true);
    expect(checker.check('https://rpc.soroban-mainnet.com').allowed).toBe(false); // overridden
  });
});

describe('Worker egress integration', () => {
  const config = compileEgressConfig(WORKER_EGRESS_CONFIG);

  it('allows Soroban RPC calls', () => {
    expect(checkEgress('https://rpc.soroban-mainnet.com', config, 'POST').allowed).toBe(true);
    expect(checkEgress('https://rpc.soroban-testnet.com', config, 'POST').allowed).toBe(true);
    expect(checkEgress('https://soroban-rpc.mainnet.stellar.org', config, 'POST').allowed).toBe(true);
    expect(checkEgress('https://soroban-rpc.testnet.stellar.org', config, 'POST').allowed).toBe(true);
  });

  it('allows wildcard Soroban RPC', () => {
    expect(checkEgress('https://us-east.soroban-rpc.com', config, 'POST').allowed).toBe(true);
    expect(checkEgress('https://eu-west.soroban-rpc.com', config, 'POST').allowed).toBe(true);
  });

  it('allows Horizon API', () => {
    expect(checkEgress('https://horizon.stellar.org/accounts/GABC...', config, 'GET').allowed).toBe(true);
    expect(checkEgress('https://horizon-testnet.stellar.org/transactions/...', config, 'POST').allowed).toBe(true);
  });

  it('allows Stellar Expert indexer', () => {
    expect(checkEgress('https://api.stellar.expert/explorer/public/...', config, 'GET').allowed).toBe(true);
  });

  it('allows Ngrok development tunnels', () => {
    expect(checkEgress('https://abc123.ngrok.io/webhook', config, 'POST').allowed).toBe(true);
    expect(checkEgress('https://xyz789.ngrok-free.app/callback', config, 'POST').allowed).toBe(true);
  });

  it('denies non-allowed hosts', () => {
    expect(checkEgress('https://evil.com/steal', config).allowed).toBe(false);
    expect(checkEgress('https://malicious.net/phish', config).allowed).toBe(false);
  });
});

describe('patternToRegex (worker-specific)', () => {
  it('handles Soroban RPC wildcard', () => {
    const regex = patternToRegex('*.soroban-rpc.com');
    expect(regex.test('us-east.soroban-rpc.com')).toBe(true);
    expect(regex.test('eu-west.soroban-rpc.com')).toBe(true);
    expect(regex.test('soroban-rpc.com')).toBe(false);
  });

  it('handles Ngrok wildcard', () => {
    const regex = patternToRegex('*.ngrok.io');
    expect(regex.test('abc123.ngrok.io')).toBe(true);
    expect(regex.test('xyz.ngrok.io')).toBe(true);
  });

  it('handles Ngrok free wildcard', () => {
    const regex = patternToRegex('*.ngrok-free.app');
    expect(regex.test('abc123.ngrok-free.app')).toBe(true);
  });
});