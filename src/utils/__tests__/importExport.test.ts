import {
  parseCSV,
  detectFormat,
  parseJSON,
  validateImport,
  processImport,
  ImportData,
  ImportMode,
} from '../importExport';

describe('importExport utilities', () => {
  test('detectFormat identifies csv and json', () => {
    const csv = 'name,price\nNetflix,9.99';
    const json = JSON.stringify([{ id: '1', name: 'Netflix' }]);
    expect(detectFormat(csv)).toBe('csv');
    expect(detectFormat(json)).toBe('json');
  });

  test('parseCSV parses CSV rows', () => {
    const csv = 'name,price,currency\nTest Service,12.5,USD\nOther,0,EUR';
    const parsed = parseCSV(csv);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('Test Service');
    expect(parsed[0].price).toBeCloseTo(12.5);
  });

  test('validateImport finds missing required fields', () => {
    const data: ImportData = {
      subscriptions: [
        { name: '', category: 'other', price: 10, currency: 'USD', billingCycle: 'monthly', nextBillingDate: '2026-01-01' },
        { name: 'Valid', category: 'other', price: -5, currency: 'USD', billingCycle: 'monthly', nextBillingDate: 'invalid-date' },
      ],
      mode: 'create' as ImportMode,
    };

    const validation = validateImport(data);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  test('processImport creates and updates subscriptions correctly', () => {
    const existing = [
      { id: 'a', name: 'Existing', description: '', category: 'other', price: 5, currency: 'USD', billingCycle: 'monthly', nextBillingDate: '2026-05-01', isActive: true, notificationsEnabled: true, isCryptoEnabled: false, createdAt: new Date(), updatedAt: new Date() },
    ];

    const data: ImportData = {
      subscriptions: [
        { id: 'a', name: 'Existing', category: 'other', price: 7, currency: 'USD', billingCycle: 'monthly', nextBillingDate: '2026-06-01' },
        { name: 'NewSub', category: 'other', price: 3.5, currency: 'USD', billingCycle: 'monthly', nextBillingDate: '2026-07-01' },
      ],
      mode: 'upsert' as ImportMode,
    };

    const result = processImport(data, existing as any);
    expect(result.imported + result.updated).toBeGreaterThanOrEqual(2);
  });
});
/**
 * Import/Export Tests
 */

import {
  parseCSV,
  parseJSON,
  generateCSV,
  exportToJSON,
  validateImport,
  processImport,
  detectFormat,
  getCSVTemplate,
  getJSONTemplate,
  ImportMode,
} from '../importExport';
import { Subscription, SubscriptionCategory, BillingCycle } from '../../types/subscription';

describe('Import/Export Utilities', () => {
  describe('CSV Parsing', () => {
    it('should parse valid CSV data', () => {
      const csv = `name,description,category,price,currency,billingCycle,nextBillingDate
Netflix,Streaming service,streaming,15.99,USD,monthly,2026-05-01
Spotify,Music streaming,streaming,9.99,USD,monthly,2026-05-15`;

      const result = parseCSV(csv);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Netflix');
      expect(result[0].price).toBe(15.99);
      expect(result[1].name).toBe('Spotify');
    });

    it('should handle quoted values with commas', () => {
      const csv = `name,description,category,price,currency,billingCycle,nextBillingDate
Netflix,"Premium, 4K",streaming,15.99,USD,monthly,2026-05-01`;

      const result = parseCSV(csv);
      expect(result).toHaveLength(1);
      expect(result[0].description).toBe('Premium, 4K');
    });

    it('should throw error for empty CSV', () => {
      expect(() => parseCSV('')).toThrow('CSV must contain at least a header row and one data row');
    });

    it('should skip empty rows', () => {
      const csv = `name,description,category,price,currency,billingCycle,nextBillingDate
Netflix,Streaming service,streaming,15.99,USD,monthly,2026-05-01

Spotify,Music streaming,streaming,9.99,USD,monthly,2026-05-15`;

      const result = parseCSV(csv);
      expect(result).toHaveLength(2);
    });
  });

  describe('JSON Parsing', () => {
    it('should parse JSON array', () => {
      const json = `[
        {
          "name": "Netflix",
          "category": "streaming",
          "price": 15.99,
          "currency": "USD",
          "billingCycle": "monthly",
          "nextBillingDate": "2026-05-01"
        }
      ]`;

      const result = parseJSON(json);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Netflix');
    });

    it('should parse export format with metadata', () => {
      const json = `{
        "version": "1.0.0",
        "exportedAt": "2026-04-26T00:00:00.000Z",
        "subscriptionCount": 1,
        "subscriptions": [
          {
            "name": "Netflix",
            "category": "streaming",
            "price": 15.99,
            "currency": "USD",
            "billingCycle": "monthly",
            "nextBillingDate": "2026-05-01"
          }
        ]
      }`;

      const result = parseJSON(json);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Netflix');
    });

    it('should throw error for invalid JSON', () => {
      expect(() => parseJSON('not valid json')).toThrow();
    });
  });

  describe('CSV Generation', () => {
    it('should generate valid CSV from subscriptions', () => {
      const subscriptions: Subscription[] = [
        {
          id: '1',
          name: 'Netflix',
          description: 'Streaming service',
          category: SubscriptionCategory.STREAMING,
          price: 15.99,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date('2026-05-01'),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const csv = generateCSV(subscriptions);
      expect(csv).toContain('Netflix');
      expect(csv).toContain('15.99');
      expect(csv).toContain('USD');
    });

    it('should handle special characters in CSV', () => {
      const subscriptions: Subscription[] = [
        {
          id: '1',
          name: 'Test "quoted" subscription',
          description: 'Description with, comma',
          category: SubscriptionCategory.OTHER,
          price: 10,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date('2026-05-01'),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const csv = generateCSV(subscriptions);
      expect(csv).toContain('"Test ""quoted"" subscription"');
    });
  });

  describe('JSON Export', () => {
    it('should export subscriptions to JSON', () => {
      const subscriptions: Subscription[] = [
        {
          id: '1',
          name: 'Netflix',
          category: SubscriptionCategory.STREAMING,
          price: 15.99,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date('2026-05-01'),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const json = exportToJSON(subscriptions);
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe('1.0.0');
      expect(parsed.subscriptionCount).toBe(1);
      expect(parsed.subscriptions[0].name).toBe('Netflix');
    });
  });

  describe('Validation', () => {
    it('should validate correct data', () => {
      const data = {
        subscriptions: [
          {
            name: 'Netflix',
            category: 'streaming',
            price: 15.99,
            currency: 'USD',
            billingCycle: 'monthly',
            nextBillingDate: '2026-05-01',
          },
        ],
        mode: 'create' as ImportMode,
      };

      const result = validateImport(data);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should catch missing required fields', () => {
      const data = {
        subscriptions: [
          {
            name: '',
            category: 'streaming',
            price: 15.99,
            currency: 'USD',
            billingCycle: 'monthly',
            nextBillingDate: '2026-05-01',
          },
        ],
        mode: 'create' as ImportMode,
      };

      const result = validateImport(data);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should catch invalid price', () => {
      const data = {
        subscriptions: [
          {
            name: 'Netflix',
            category: 'streaming',
            price: -10,
            currency: 'USD',
            billingCycle: 'monthly',
            nextBillingDate: '2026-05-01',
          },
        ],
        mode: 'create' as ImportMode,
      };

      const result = validateImport(data);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.field === 'price')).toBe(true);
    });

    it('should add warnings for invalid category', () => {
      const data = {
        subscriptions: [
          {
            name: 'Netflix',
            category: 'invalid-category',
            price: 15.99,
            currency: 'USD',
            billingCycle: 'monthly',
            nextBillingDate: '2026-05-01',
          },
        ],
        mode: 'create' as ImportMode,
      };

      const result = validateImport(data);
      expect(result.warnings.some((w) => w.field === 'category')).toBe(true);
    });
  });

  describe('Import Processing', () => {
    it('should create new subscriptions in create mode', () => {
      const data = {
        subscriptions: [
          {
            name: 'Netflix',
            category: 'streaming',
            price: 15.99,
            currency: 'USD',
            billingCycle: 'monthly',
            nextBillingDate: '2026-05-01',
          },
        ],
        mode: 'create' as ImportMode,
      };

      const result = processImport(data, []);
      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
      expect(result.updated).toBe(0);
    });

    it('should update existing subscriptions in upsert mode', () => {
      const existing: Subscription[] = [
        {
          id: '1',
          name: 'Netflix',
          category: SubscriptionCategory.STREAMING,
          price: 10,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date('2026-05-01'),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const data = {
        subscriptions: [
          {
            name: 'Netflix',
            category: 'streaming',
            price: 15.99,
            currency: 'USD',
            billingCycle: 'monthly',
            nextBillingDate: '2026-05-01',
          },
        ],
        mode: 'upsert' as ImportMode,
      };

      const result = processImport(data, existing);
      expect(result.success).toBe(true);
      expect(result.imported).toBe(0);
      expect(result.updated).toBe(1);
    });

    it('should handle duplicate detection', () => {
      const existing: Subscription[] = [
        {
          id: '1',
          name: 'Netflix',
          category: SubscriptionCategory.STREAMING,
          price: 10,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date('2026-05-01'),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const data = {
        subscriptions: [
          {
            name: 'Netflix',
            category: 'streaming',
            price: 15.99,
            currency: 'USD',
            billingCycle: 'monthly',
            nextBillingDate: '2026-05-01',
          },
        ],
        mode: 'create' as ImportMode,
      };

      const result = processImport(data, existing);
      expect(result.imported).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.actions).toHaveLength(0);
    });

    it('should preserve externalId during import', () => {
      const data = {
        subscriptions: [
          {
            name: 'Stripe Plan',
            externalId: 'stripe_123',
            externalSource: 'stripe',
            category: 'streaming',
            price: 15.99,
            currency: 'USD',
            billingCycle: 'monthly',
            nextBillingDate: '2026-05-01',
          },
        ],
        mode: 'create' as ImportMode,
      };

      const result = processImport(data, []);
      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
      expect(result.actions?.[0].subscription?.externalId).toBe('stripe_123');
      expect(result.actions?.[0].subscription?.externalSource).toBe('stripe');
    });

    it('should replace existing subscriptions when replace mode is selected', () => {
      const existing: Subscription[] = [
        {
          id: '1',
          name: 'Old Service',
          category: SubscriptionCategory.OTHER,
          price: 5,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date('2026-05-01'),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const data = {
        subscriptions: [
          {
            name: 'New Service',
            category: 'software',
            price: 20,
            currency: 'USD',
            billingCycle: 'monthly',
            nextBillingDate: '2026-06-01',
          },
        ],
        mode: 'replace' as ImportMode,
      };

      const result = processImport(data, existing);
      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.actions?.[0].type).toBe('create');
    });
  });

  describe('Format Detection', () => {
    it('should detect JSON format', () => {
      expect(detectFormat('[{"name": "test"}]')).toBe('json');
      expect(detectFormat('{"name": "test"}')).toBe('json');
    });

    it('should detect CSV format', () => {
      expect(detectFormat('name,description,price\nTest,Test desc,10')).toBe('csv');
    });

    it('should return unknown for invalid format', () => {
      expect(detectFormat('invalid data')).toBe('unknown');
    });
  });

  describe('Templates', () => {
    it('should generate valid CSV template', () => {
      const template = getCSVTemplate();
      const result = parseCSV(template);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBe('Netflix');
    });

    it('should generate valid JSON template', () => {
      const template = getJSONTemplate();
      const result = parseJSON(template);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBe('Netflix');
    });
  });
});
