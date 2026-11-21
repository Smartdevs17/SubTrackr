/**
 * Tests for QRPaymentService and helpers (Issue #1714).
 *
 * Unit tests simulate the QR encoding path without any real Stellar network
 * calls or external QR libraries.
 */

import {
  QRPaymentService,
  InMemoryQRPaymentStore,
  buildSep007Uri,
  buildQrDataUri,
  STELLAR_NETWORK_PASSPHRASES,
  type QRPaymentRequest,
  type Clock,
  type IdGenerator,
} from '../qrPaymentService';

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Deterministic clock that always returns the same timestamp. */
class FixedClock implements Clock {
  constructor(private readonly ts: number = 1_700_000_000_000) {}
  now(): number {
    return this.ts;
  }
}

/** Deterministic ID generator that returns sequential IDs. */
class SequentialIdGenerator implements IdGenerator {
  private counter = 0;
  generate(): string {
    return `qr_test_${++this.counter}`;
  }
}

function makeService(clockTs?: number): {
  service: QRPaymentService;
  store: InMemoryQRPaymentStore;
  clock: FixedClock;
  idGen: SequentialIdGenerator;
} {
  const store = new InMemoryQRPaymentStore();
  const clock = new FixedClock(clockTs);
  const idGen = new SequentialIdGenerator();
  const service = new QRPaymentService(store, clock, idGen);
  return { service, store, clock, idGen };
}

const VALID_ADDRESS = 'GBVHA6BLNPGMWNMWQMNCQUQNKGWZWL4RPXKC4MZQDOOFICMCF5I6HET';
const VALID_ISSUER = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZ4ONFAKK41VPK43CTJEW';

function makeBaseRequest(overrides: Partial<QRPaymentRequest> = {}): QRPaymentRequest {
  return {
    id: 'qr_base_1',
    merchantId: 'merchant_abc',
    destinationAddress: VALID_ADDRESS,
    amount: '10.50',
    asset: 'XLM',
    network: 'testnet',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ── buildSep007Uri ────────────────────────────────────────────────────────────

describe('buildSep007Uri', () => {
  it('builds correct SEP-0007 URI for XLM (native asset)', () => {
    const request = makeBaseRequest({ asset: 'XLM' });
    const uri = buildSep007Uri(request);

    expect(uri).toMatch(/^web\+stellar:pay\?/);
    expect(uri).toContain(`destination=${encodeURIComponent(VALID_ADDRESS)}`);
    expect(uri).toContain('amount=10.50');
    // native XLM: no asset_code or asset_issuer
    expect(uri).not.toContain('asset_code');
    expect(uri).not.toContain('asset_issuer');
  });

  it('builds correct SEP-0007 URI for non-native asset (USDC) with issuer', () => {
    const request = makeBaseRequest({
      asset: 'USDC',
      issuer: VALID_ISSUER,
    });
    const uri = buildSep007Uri(request);

    expect(uri).toContain(`asset_code=USDC`);
    expect(uri).toContain(`asset_issuer=${encodeURIComponent(VALID_ISSUER)}`);
    expect(uri).toContain(`destination=${encodeURIComponent(VALID_ADDRESS)}`);
  });

  it('includes correct network_passphrase for testnet', () => {
    const request = makeBaseRequest({ network: 'testnet' });
    const uri = buildSep007Uri(request);

    expect(uri).toContain(
      `network_passphrase=${encodeURIComponent(STELLAR_NETWORK_PASSPHRASES.testnet)}`,
    );
  });

  it('includes correct network_passphrase for mainnet', () => {
    const request = makeBaseRequest({ network: 'mainnet' });
    const uri = buildSep007Uri(request);

    expect(uri).toContain(
      `network_passphrase=${encodeURIComponent(STELLAR_NETWORK_PASSPHRASES.mainnet)}`,
    );
  });

  it('URL-encodes memo with spaces and special chars', () => {
    const memo = 'order 42 / test&check';
    const request = makeBaseRequest({ memo });
    const uri = buildSep007Uri(request);

    expect(uri).toContain(`memo=${encodeURIComponent(memo)}`);
    // raw spaces or & must not appear unencoded
    expect(uri).not.toMatch(/memo=order 42/);
  });

  it('omits memo from URI when memo is not provided', () => {
    const request = makeBaseRequest({ memo: undefined });
    const uri = buildSep007Uri(request);

    expect(uri).not.toContain('memo=');
  });

  it('omits asset_issuer when non-native asset has no issuer', () => {
    const request = makeBaseRequest({ asset: 'USDT', issuer: undefined });
    const uri = buildSep007Uri(request);

    expect(uri).toContain('asset_code=USDT');
    expect(uri).not.toContain('asset_issuer');
  });

  it('treats XLM case-insensitively as native (xlm lowercase)', () => {
    const request = makeBaseRequest({ asset: 'xlm' });
    const uri = buildSep007Uri(request);

    expect(uri).not.toContain('asset_code');
  });
});

// ── buildQrDataUri ────────────────────────────────────────────────────────────

describe('buildQrDataUri', () => {
  it('produces a valid base64 data URI', () => {
    const sep007Uri = 'web+stellar:pay?destination=GABCDE&amount=5';
    const dataUri = buildQrDataUri(sep007Uri);

    expect(dataUri).toMatch(/^data:text\/plain;base64,/);
    // base64 chars only after the prefix
    const b64 = dataUri.replace('data:text/plain;base64,', '');
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('decodes the base64 payload back to the original SEP-0007 URI', () => {
    const sep007Uri =
      'web+stellar:pay?destination=GABCDE&amount=10&network_passphrase=Test+SDF+Network+%3B+September+2015';
    const dataUri = buildQrDataUri(sep007Uri);
    const b64 = dataUri.replace('data:text/plain;base64,', '');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');

    expect(decoded).toBe(sep007Uri);
  });
});

// ── QRPaymentService.createPaymentRequest ────────────────────────────────────

describe('QRPaymentService.createPaymentRequest', () => {
  it('creates a request and returns a sep007Uri for XLM', async () => {
    const { service } = makeService();

    const result = await service.createPaymentRequest({
      merchantId: 'mch_1',
      destinationAddress: VALID_ADDRESS,
      amount: '25.00',
      asset: 'XLM',
      network: 'testnet',
    });

    expect(result.sep007Uri).toMatch(/^web\+stellar:pay\?/);
    expect(result.sep007Uri).toContain('amount=25.00');
    expect(result.sep007Uri).not.toContain('asset_code');
  });

  it('creates a request and returns a sep007Uri for USDC with issuer', async () => {
    const { service } = makeService();

    const result = await service.createPaymentRequest({
      merchantId: 'mch_1',
      destinationAddress: VALID_ADDRESS,
      amount: '100.00',
      asset: 'USDC',
      issuer: VALID_ISSUER,
      network: 'mainnet',
    });

    expect(result.sep007Uri).toContain('asset_code=USDC');
    expect(result.sep007Uri).toContain(
      `network_passphrase=${encodeURIComponent(STELLAR_NETWORK_PASSPHRASES.mainnet)}`,
    );
  });

  it('stores the request in the backing store', async () => {
    const { service, store } = makeService();

    const result = await service.createPaymentRequest({
      merchantId: 'mch_2',
      destinationAddress: VALID_ADDRESS,
      amount: '5.00',
      asset: 'XLM',
      network: 'testnet',
    });

    expect(store.size).toBe(1);
    const stored = await store.findById(result.request.id);
    expect(stored).not.toBeNull();
    expect(stored?.amount).toBe('5.00');
  });

  it('generates a unique ID for each request', async () => {
    const { service } = makeService();

    const r1 = await service.createPaymentRequest({
      merchantId: 'mch_1',
      destinationAddress: VALID_ADDRESS,
      amount: '1.00',
      asset: 'XLM',
      network: 'testnet',
    });
    const r2 = await service.createPaymentRequest({
      merchantId: 'mch_1',
      destinationAddress: VALID_ADDRESS,
      amount: '2.00',
      asset: 'XLM',
      network: 'testnet',
    });

    expect(r1.request.id).not.toBe(r2.request.id);
  });

  it('uses a caller-supplied ID when provided', async () => {
    const { service } = makeService();

    const result = await service.createPaymentRequest({
      id: 'custom_id_123',
      merchantId: 'mch_1',
      destinationAddress: VALID_ADDRESS,
      amount: '1.00',
      asset: 'XLM',
      network: 'testnet',
    });

    expect(result.request.id).toBe('custom_id_123');
  });

  it('sets expiresAt when ttlMs is given', async () => {
    const ts = 1_700_000_000_000;
    const { service } = makeService(ts);

    const result = await service.createPaymentRequest({
      merchantId: 'mch_1',
      destinationAddress: VALID_ADDRESS,
      amount: '1.00',
      asset: 'XLM',
      network: 'testnet',
      ttlMs: 60_000,
    });

    expect(result.request.expiresAt).toBe(ts + 60_000);
  });

  it('returns a qrDataUri that decodes to the sep007Uri', async () => {
    const { service } = makeService();

    const result = await service.createPaymentRequest({
      merchantId: 'mch_1',
      destinationAddress: VALID_ADDRESS,
      amount: '7.77',
      asset: 'XLM',
      network: 'testnet',
    });

    const b64 = result.qrDataUri.replace('data:text/plain;base64,', '');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    expect(decoded).toBe(result.sep007Uri);
  });

  it('includes memo in the URI when memo is provided', async () => {
    const { service } = makeService();

    const result = await service.createPaymentRequest({
      merchantId: 'mch_1',
      destinationAddress: VALID_ADDRESS,
      amount: '1.00',
      asset: 'XLM',
      memo: 'invoice-007',
      network: 'testnet',
    });

    expect(result.sep007Uri).toContain(`memo=${encodeURIComponent('invoice-007')}`);
  });
});

// ── QRPaymentService.validatePaymentRequest ───────────────────────────────────

describe('QRPaymentService.validatePaymentRequest', () => {
  it('returns valid=true for an active (non-expired) request', async () => {
    const ts = 1_700_000_000_000;
    const { service } = makeService(ts);

    const { request } = await service.createPaymentRequest({
      merchantId: 'mch_1',
      destinationAddress: VALID_ADDRESS,
      amount: '1.00',
      asset: 'XLM',
      network: 'testnet',
      ttlMs: 300_000,
    });

    const result = await service.validatePaymentRequest(request.id);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns valid=true for a request with no expiry', async () => {
    const { service } = makeService();

    const { request } = await service.createPaymentRequest({
      merchantId: 'mch_1',
      destinationAddress: VALID_ADDRESS,
      amount: '1.00',
      asset: 'XLM',
      network: 'testnet',
      // no ttlMs → no expiresAt
    });

    const result = await service.validatePaymentRequest(request.id);
    expect(result.valid).toBe(true);
  });

  it('returns valid=false with reason "expired" for an expired request', async () => {
    const ts = 1_700_000_000_000;
    const { service } = makeService(ts);

    // Create with a tiny TTL that has already passed.
    const { request } = await service.createPaymentRequest({
      merchantId: 'mch_1',
      destinationAddress: VALID_ADDRESS,
      amount: '1.00',
      asset: 'XLM',
      network: 'testnet',
      ttlMs: -1_000, // expiresAt will be in the past
    });

    const result = await service.validatePaymentRequest(request.id);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('returns valid=false with reason "not_found" for an unknown ID', async () => {
    const { service } = makeService();

    const result = await service.validatePaymentRequest('does_not_exist');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('not_found');
  });
});

// ── QRPaymentService.getPaymentRequest ───────────────────────────────────────

describe('QRPaymentService.getPaymentRequest', () => {
  it('returns null for an unknown ID', async () => {
    const { service } = makeService();
    const result = await service.getPaymentRequest('nonexistent');
    expect(result).toBeNull();
  });

  it('returns the correct request when it exists', async () => {
    const { service } = makeService();

    const { request } = await service.createPaymentRequest({
      merchantId: 'mch_5',
      destinationAddress: VALID_ADDRESS,
      amount: '99.99',
      asset: 'USDC',
      issuer: VALID_ISSUER,
      memo: 'ref-789',
      network: 'mainnet',
    });

    const fetched = await service.getPaymentRequest(request.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.merchantId).toBe('mch_5');
    expect(fetched?.amount).toBe('99.99');
    expect(fetched?.asset).toBe('USDC');
    expect(fetched?.memo).toBe('ref-789');
    expect(fetched?.network).toBe('mainnet');
  });
});

// ── InMemoryQRPaymentStore ────────────────────────────────────────────────────

describe('InMemoryQRPaymentStore', () => {
  it('saves and retrieves a request by ID', async () => {
    const store = new InMemoryQRPaymentStore();
    const req = makeBaseRequest({ id: 'store_test_1' });

    await store.save(req);
    const found = await store.findById('store_test_1');

    expect(found).toEqual(req);
  });

  it('returns null for an ID that was never saved', async () => {
    const store = new InMemoryQRPaymentStore();
    expect(await store.findById('missing')).toBeNull();
  });

  it('clears all records', async () => {
    const store = new InMemoryQRPaymentStore();
    await store.save(makeBaseRequest({ id: 'a' }));
    await store.save(makeBaseRequest({ id: 'b' }));

    store.clear();
    expect(store.size).toBe(0);
  });
});
