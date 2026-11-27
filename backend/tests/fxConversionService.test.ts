import {
  FXConversionService,
  FXRateUnavailableError,
  FXProviderError,
  FXSnapshotUnavailableError,
  FrankfurterRateSource,
  InvalidCurrencyCodeError,
  InvalidFXAmountError,
  fxConversionService,
} from '../src/fx';
import type { FXRateSnapshot, FXRateSource } from '../src/fx';
import { CurrencyController } from '../billing/controller/currencyController';
import { CurrencyConversionService } from '../billing/domain/currencyConversionService';
import type { Request, Response } from 'express';

afterEach(() => {
  jest.restoreAllMocks();
});

const snapshot = (baseCurrency = 'USD', rates: Record<string, number> = { EUR: 0.92, GBP: 0.79 }): FXRateSnapshot => ({
  baseCurrency,
  rates,
  snapshotDate: '2026-11-20',
  source: 'test',
});

describe('FXConversionService', () => {
  let now: number;

  beforeEach(() => {
    now = Date.parse('2026-11-21T12:00:00.000Z');
  });

  it('converts from a daily snapshot and returns snapshot provenance', async () => {
    const source: FXRateSource = { fetchLatestSnapshot: jest.fn().mockResolvedValue(snapshot()) };
    const service = new FXConversionService({ source, now: () => now });

    await expect(service.convert(100, 'USD', 'EUR')).resolves.toEqual({
      originalAmount: 100,
      originalCurrency: 'USD',
      convertedAmount: 92,
      targetCurrency: 'EUR',
      exchangeRate: 0.92,
      snapshotDate: '2026-11-20',
      source: 'test',
      stale: false,
    });
  });

  it('loads one snapshot per base currency per UTC day and refreshes on the next day', async () => {
    const source: FXRateSource = { fetchLatestSnapshot: jest.fn().mockResolvedValue(snapshot()) };
    const service = new FXConversionService({ source, now: () => now });

    await service.convert(1, 'USD', 'EUR');
    await service.convert(2, 'USD', 'GBP');
    expect(source.fetchLatestSnapshot).toHaveBeenCalledTimes(1);

    now += 24 * 60 * 60 * 1000;
    await service.convert(1, 'USD', 'EUR');
    expect(source.fetchLatestSnapshot).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent snapshot requests', async () => {
    let resolveSnapshot!: (value: FXRateSnapshot) => void;
    const source: FXRateSource = {
      fetchLatestSnapshot: jest.fn(
        () => new Promise<FXRateSnapshot>((resolve) => { resolveSnapshot = resolve; }),
      ),
    };
    const service = new FXConversionService({ source, now: () => now });

    const first = service.convert(1, 'USD', 'EUR');
    const second = service.convert(1, 'USD', 'GBP');
    resolveSnapshot(snapshot());

    await Promise.all([first, second]);
    expect(source.fetchLatestSnapshot).toHaveBeenCalledTimes(1);
  });

  it('uses the last known daily snapshot on provider failure and marks it stale', async () => {
    const fetchLatestSnapshot = jest.fn()
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce(new Error('offline'));
    const service = new FXConversionService({
      source: { fetchLatestSnapshot },
      now: () => now,
    });

    await service.convert(100, 'USD', 'EUR');
    now += 24 * 60 * 60 * 1000;
    await expect(service.convert(100, 'USD', 'EUR')).resolves.toMatchObject({
      convertedAmount: 92,
      snapshotDate: '2026-11-20',
      stale: true,
    });
    await expect(service.convert(100, 'USD', 'EUR')).resolves.toMatchObject({ stale: true });
    expect(fetchLatestSnapshot).toHaveBeenCalledTimes(2);
  });

  it('fails explicitly when no snapshot is available', async () => {
    const service = new FXConversionService({
      source: { fetchLatestSnapshot: jest.fn().mockRejectedValue(new Error('offline')) },
      now: () => now,
    });

    await expect(service.convert(10, 'USD', 'EUR')).rejects.toBeInstanceOf(FXSnapshotUnavailableError);
  });

  it('rejects future-dated snapshots', async () => {
    const service = new FXConversionService({
      source: {
        fetchLatestSnapshot: jest.fn().mockResolvedValue({
          ...snapshot(),
          snapshotDate: '2026-11-22',
        }),
      },
      now: () => now,
    });

    await expect(service.convert(10, 'USD', 'EUR')).rejects.toBeInstanceOf(FXSnapshotUnavailableError);
  });

  it('does not use a cached snapshot beyond the configured stale-age limit', async () => {
    const service = new FXConversionService({
      source: {
        fetchLatestSnapshot: jest.fn()
          .mockResolvedValueOnce(snapshot())
          .mockRejectedValueOnce(new Error('offline')),
      },
      maxStaleSnapshotAgeMs: 24 * 60 * 60 * 1000,
      now: () => now,
    });

    await service.convert(10, 'USD', 'EUR');
    now += 24 * 60 * 60 * 1000;
    await expect(service.convert(10, 'USD', 'EUR')).rejects.toBeInstanceOf(FXSnapshotUnavailableError);
  });

  it('rejects invalid amounts and currency codes and reports missing pairs', async () => {
    const service = new FXConversionService({
      source: { fetchLatestSnapshot: jest.fn().mockResolvedValue(snapshot()) },
      now: () => now,
    });

    await expect(service.convert(Number.NaN, 'USD', 'EUR')).rejects.toBeInstanceOf(InvalidFXAmountError);
    await expect(service.convert(Number.MAX_VALUE, 'USD', 'USD')).rejects.toBeInstanceOf(InvalidFXAmountError);
    await expect(service.convert(10, 'usd', 'EUR')).rejects.toBeInstanceOf(InvalidCurrencyCodeError);
    await expect(service.convert(10, 'USD', 'JPY')).rejects.toBeInstanceOf(FXRateUnavailableError);
  });

  it('preserves same-currency amounts without making a provider request', async () => {
    const fetchLatestSnapshot = jest.fn();
    const service = new FXConversionService({
      source: { fetchLatestSnapshot },
      now: () => now,
    });

    await expect(service.convert(-12.345, 'USD', 'USD')).resolves.toMatchObject({
      convertedAmount: -12.35,
      exchangeRate: 1,
      source: 'identity',
      stale: false,
    });
    expect(fetchLatestSnapshot).not.toHaveBeenCalled();
  });
});

describe('FrankfurterRateSource', () => {
  const response = (body: unknown, ok = true): Response => ({
    ok,
    status: ok ? 200 : 503,
    json: async () => body,
  }) as Response;

  it('requests a full latest snapshot for the requested base and validates it', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({
      amount: 1,
      base: 'USD',
      date: '2026-11-20',
      rates: { EUR: 0.92, GBP: 0.79 },
    }));
    const source = new FrankfurterRateSource({ fetchImpl });

    await expect(source.fetchLatestSnapshot('USD')).resolves.toEqual({
      baseCurrency: 'USD',
      rates: { EUR: 0.92, GBP: 0.79 },
      snapshotDate: '2026-11-20',
      source: 'frankfurter',
    });
    expect(fetchImpl.mock.calls[0][0].toString()).toBe(
      'https://api.frankfurter.app/latest?from=USD',
    );
  });

  it('rejects malformed, mismatched, and failed provider responses', async () => {
    const invalidPayloads = [
      { base: 'EUR', date: '2026-11-20', rates: { USD: 1.08 } },
      { base: 'USD', date: '2026-02-30', rates: { EUR: 0.92 } },
      { base: 'USD', date: '2026-11-20', rates: { EUR: 0 } },
    ];
    for (const payload of invalidPayloads) {
      const source = new FrankfurterRateSource({
        fetchImpl: jest.fn().mockResolvedValue(response(payload)),
      });
      await expect(source.fetchLatestSnapshot('USD')).rejects.toBeInstanceOf(FXProviderError);
    }

    const failedSource = new FrankfurterRateSource({
      fetchImpl: jest.fn().mockResolvedValue(response({}, false)),
    });
    await expect(failedSource.fetchLatestSnapshot('USD')).rejects.toBeInstanceOf(FXProviderError);
  });

  it('rejects malformed currency codes before making a request', async () => {
    const fetchImpl = jest.fn();
    const source = new FrankfurterRateSource({ fetchImpl });
    await expect(source.fetchLatestSnapshot('usd')).rejects.toBeInstanceOf(InvalidCurrencyCodeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('currency rate refresh endpoint integration', () => {
  it('updates the billing rate service with snapshot provenance', async () => {
    const snapshotDate = new Date().toISOString().slice(0, 10);
    const getSnapshot = jest.spyOn(fxConversionService, 'getSnapshot').mockResolvedValue({
      ...snapshot('USD', { EUR: 0.92, GBP: 0.79 }),
      snapshotDate,
      stale: false,
    });
    const service = new CurrencyConversionService();
    const controller = new CurrencyController(service);
    const req = { headers: {}, body: {} } as Request;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;

    await controller.refreshRates(req, res);

    expect(getSnapshot).toHaveBeenCalledWith('USD');
    expect(service.getAllRates()).toEqual(expect.arrayContaining([
      expect.objectContaining({ base: 'USD', quote: 'EUR', rate: 0.92, source: 'test' }),
      expect.objectContaining({ base: 'USD', quote: 'GBP', rate: 0.79, source: 'test' }),
    ]));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ refreshed: 2, snapshotDate, source: 'test', stale: false }),
    }));
  });

  it('does not refresh billing rates from a stale snapshot', async () => {
    const snapshotDate = new Date().toISOString().slice(0, 10);
    jest.spyOn(fxConversionService, 'getSnapshot').mockResolvedValue({
      ...snapshot('USD', { EUR: 0.92 }),
      snapshotDate,
      stale: true,
    });
    const service = new CurrencyConversionService();
    const controller = new CurrencyController(service);
    const req = { headers: {}, body: {} } as Request;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;

    await controller.refreshRates(req, res);

    expect(service.getAllRates().find((rate) => rate.base === 'USD' && rate.quote === 'EUR'))
      .toMatchObject({ rate: 0.92, source: 'fallback' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ refreshed: 0, snapshotDate, source: 'test', stale: true }),
    }));
  });
});
