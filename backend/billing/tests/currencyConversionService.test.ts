/**
 * Currency Conversion Service Tests
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1121
 */

import { CurrencyConversionService } from '../domain/currencyConversionService';

describe('CurrencyConversionService', () => {
  let service: CurrencyConversionService;

  beforeEach(() => {
    service = new CurrencyConversionService();
  });

  describe('constructor & config', () => {
    it('should initialize with default supported currencies', () => {
      expect(service.getSupportedCurrencies()).toContain('USD');
      expect(service.getSupportedCurrencies()).toContain('EUR');
      expect(service.getSupportedCurrencies()).toContain('GBP');
      expect(service.getBaseCurrency()).toBe('USD');
    });

    it('should accept custom config', () => {
      const svc = new CurrencyConversionService({
        baseCurrency: 'EUR',
        supportedCurrencies: ['EUR', 'USD', 'GBP'],
      });
      expect(svc.getBaseCurrency()).toBe('EUR');
      expect(svc.getSupportedCurrencies()).toHaveLength(3);
    });
  });

  describe('setRate & getRate', () => {
    it('should set and retrieve a rate', () => {
      service.setRate('USD', 'EUR', 0.92);
      const rate = service.getRate('USD', 'EUR');

      expect(rate).toBeDefined();
      expect(rate!.rate).toBe(0.92);
      expect(rate!.base).toBe('USD');
      expect(rate!.quote).toBe('EUR');
    });

    it('should set the inverse rate automatically', () => {
      service.setRate('USD', 'EUR', 0.92);
      const inverse = service.getRate('EUR', 'USD');

      expect(inverse).toBeDefined();
      expect(inverse!.rate).toBeCloseTo(1 / 0.92, 5);
    });

    it('should return identity rate for same currency', () => {
      const rate = service.getRate('USD', 'USD');
      expect(rate).toBeDefined();
      expect(rate!.rate).toBe(1);
    });

    it('should throw for non-positive rate', () => {
      expect(() => service.setRate('USD', 'EUR', 0)).toThrow('must be positive');
      expect(() => service.setRate('USD', 'EUR', -1)).toThrow('must be positive');
    });
  });

  describe('convert', () => {
    it('should convert between currencies', () => {
      service.setRate('USD', 'EUR', 0.92);
      const result = service.convert(100, 'USD', 'EUR');

      expect(result.originalAmount).toBe(100);
      expect(result.originalCurrency).toBe('USD');
      expect(result.convertedAmount).toBe(92);
      expect(result.targetCurrency).toBe('EUR');
      expect(result.rate).toBe(0.92);
    });

    it('should return same amount for same currency', () => {
      const result = service.convert(100, 'USD', 'USD');
      expect(result.convertedAmount).toBe(100);
      expect(result.rate).toBe(1);
    });

    it('should throw for unavailable rate', () => {
      expect(() => service.convert(100, 'USD', 'XYZ')).toThrow('No exchange rate available');
    });

    it('should throw for non-finite amount', () => {
      expect(() => service.convert(Infinity, 'USD', 'EUR')).toThrow('finite number');
    });

    it('should round to configured decimal places', () => {
      const svc = new CurrencyConversionService({ decimalPlaces: 2 });
      svc.setRate('USD', 'JPY', 149.5);
      const result = svc.convert(10, 'USD', 'JPY');
      expect(result.convertedAmount).toBe(1495);
    });
  });

  describe('convertSafe', () => {
    it('should fall back to original amount on error', () => {
      const result = service.convertSafe(100, 'USD', 'XYZ');
      expect(result.convertedAmount).toBe(100);
      expect(result.targetCurrency).toBe('XYZ');
    });
  });

  describe('subscription currency preferences', () => {
    it('should set and get subscription currency', () => {
      service.setSubscriptionCurrency('sub_001', 'EUR');
      expect(service.getSubscriptionCurrency('sub_001')).toBe('EUR');
    });

    it('should default to base currency when no preference set', () => {
      expect(service.getSubscriptionCurrency('sub_001')).toBe('USD');
    });

    it('should throw for unsupported currency', () => {
      expect(() => service.setSubscriptionCurrency('sub_001', 'XYZ')).toThrow('not supported');
    });

    it('should remove a subscription currency preference', () => {
      service.setSubscriptionCurrency('sub_001', 'EUR');
      const removed = service.removeSubscriptionCurrency('sub_001');
      expect(removed).toBe(true);
      expect(service.getSubscriptionCurrency('sub_001')).toBe('USD');
    });
  });

  describe('convertSubscriptionPrice', () => {
    it('should convert price to the subscriber preferred currency', () => {
      service.setRate('USD', 'EUR', 0.92);
      service.setSubscriptionCurrency('sub_001', 'EUR');

      const result = service.convertSubscriptionPrice(29.99, 'USD', 'sub_001');

      expect(result.targetCurrency).toBe('EUR');
      expect(result.originalCurrency).toBe('USD');
      expect(result.convertedAmount).toBeGreaterThan(0);
    });
  });

  describe('batchConvert', () => {
    it('should convert multiple items', () => {
      service.setRate('USD', 'EUR', 0.92);
      service.setRate('USD', 'GBP', 0.79);

      const results = service.batchConvert([
        { amount: 100, from: 'USD', to: 'EUR' },
        { amount: 50, from: 'USD', to: 'GBP' },
        { amount: 200, from: 'USD', to: 'XYZ' }, // will fall back
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].convertedAmount).toBe(92);
      expect(results[1].convertedAmount).toBe(39.5);
      expect(results[2].convertedAmount).toBe(200); // fallback
    });
  });

  describe('addSupportedCurrency', () => {
    it('should add a new supported currency', () => {
      service.addSupportedCurrency('CHF');
      expect(service.isCurrencySupported('CHF')).toBe(true);
      expect(service.getSupportedCurrencies()).toContain('CHF');
    });
  });

  describe('refreshRates', () => {
    it('should refresh rates from a fetcher function', async () => {
      const count = await service.refreshRates(async () => ({
        EUR: 0.93,
        GBP: 0.78,
        JPY: 150,
      }));

      expect(count).toBe(3);
      const rate = service.getRate('USD', 'EUR');
      expect(rate!.rate).toBe(0.93);
      expect(rate!.source).toBe('api');
    });
  });

  describe('getAnalytics', () => {
    it('should track conversion analytics', () => {
      service.setRate('USD', 'EUR', 0.92);
      service.setRate('USD', 'GBP', 0.79);

      service.convert(100, 'USD', 'EUR');
      service.convert(50, 'USD', 'GBP');
      service.convert(200, 'USD', 'EUR');

      const analytics = service.getAnalytics();

      expect(analytics.totalConversions).toBe(3);
      expect(analytics.conversionsByCurrency['USD_EUR']).toBe(2);
      expect(analytics.conversionsByCurrency['USD_GBP']).toBe(1);
      expect(analytics.supportedCurrencies.length).toBeGreaterThan(0);
      expect(analytics.baseCurrency).toBe('USD');
    });
  });

  describe('fallback rates', () => {
    it('should have fallback rates seeded on init', () => {
      const rate = service.getRate('USD', 'EUR');
      expect(rate).toBeDefined();
      expect(rate!.rate).toBeGreaterThan(0);
      expect(rate!.source).toBe('fallback');
    });
  });
});
