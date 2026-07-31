/**
 * StrategyRegistry Tests
 *
 * Validates the registry's ability to register, retrieve, and manage
 * pricing strategies dynamically.
 */

import { StrategyRegistry, getStrategyRegistry, resetStrategyRegistry } from '../domain/strategy-registry';
import {
  FlatPricingStrategy,
  PerSeatPricingStrategy,
  UsageBasedPricingStrategy,
  TieredPricingStrategy,
  FallbackPricingStrategy,
  type PricingStrategy,
  type Plan,
  type Subscriber,
  type Usage,
} from '../domain/strategies';

describe('StrategyRegistry', () => {
  let registry: StrategyRegistry;

  const createMockStrategy = (name: string): PricingStrategy => ({
    getName: () => name,
    calculate: (usage: Usage, plan: Plan, subscriber: Subscriber) => ({
      value: 0,
      currency: 'USD',
    }),
  });

  beforeEach(() => {
    registry = new StrategyRegistry();
  });

  afterEach(() => {
    resetStrategyRegistry();
  });

  describe('initialization', () => {
    it('pre-registers all built-in strategies', () => {
      expect(registry.hasStrategy('flat')).toBe(true);
      expect(registry.hasStrategy('per-seat')).toBe(true);
      expect(registry.hasStrategy('usage-based')).toBe(true);
      expect(registry.hasStrategy('tiered')).toBe(true);
    });

    it('returns all built-in strategy types', () => {
      const types = registry.getRegisteredTypes();
      expect(types).toContain('flat');
      expect(types).toContain('per-seat');
      expect(types).toContain('usage-based');
      expect(types).toContain('tiered');
    });

    it('initializes with correct number of strategies', () => {
      const types = registry.getRegisteredTypes();
      expect(types.length).toBe(4);
    });
  });

  describe('registration', () => {
    it('registers a new strategy', () => {
      const strategy = createMockStrategy('custom');
      registry.register('custom-pricing', strategy);

      expect(registry.hasStrategy('custom-pricing')).toBe(true);
    });

    it('replaces existing strategy when registered again', () => {
      const strategy1 = createMockStrategy('strategy1');
      const strategy2 = createMockStrategy('strategy2');

      registry.register('test', strategy1);
      const retrieved1 = registry.getStrategy('test');
      expect(retrieved1.getName()).toBe('strategy1');

      registry.register('test', strategy2);
      const retrieved2 = registry.getStrategy('test');
      expect(retrieved2.getName()).toBe('strategy2');
    });

    it('normalizes plan type codes to lowercase', () => {
      const strategy = createMockStrategy('custom');
      registry.register('UPPERCASE', strategy);

      expect(registry.hasStrategy('uppercase')).toBe(true);
      expect(registry.hasStrategy('UPPERCASE')).toBe(true);
      expect(registry.hasStrategy('UpPerCase')).toBe(true);
    });

    it('throws error if plan type code is empty', () => {
      const strategy = createMockStrategy('test');
      expect(() => {
        registry.register('', strategy);
      }).toThrow('Plan type code must be a non-empty string');
    });

    it('throws error if plan type code is null', () => {
      const strategy = createMockStrategy('test');
      expect(() => {
        registry.register(null as any, strategy);
      }).toThrow('Plan type code must be a non-empty string');
    });

    it('throws error if strategy is null', () => {
      expect(() => {
        registry.register('test', null as any);
      }).toThrow('Strategy cannot be null');
    });

    it('throws error if strategy is undefined', () => {
      expect(() => {
        registry.register('test', undefined as any);
      }).toThrow('Strategy cannot be null');
    });
  });

  describe('retrieval', () => {
    it('retrieves registered strategy by type', () => {
      const strategy = createMockStrategy('custom');
      registry.register('custom-pricing', strategy);

      const retrieved = registry.getStrategy('custom-pricing');
      expect(retrieved.getName()).toBe('custom');
    });

    it('returns fallback for unknown plan type', () => {
      const retrieved = registry.getStrategy('unknown-type');
      expect(retrieved).toBeDefined();
      expect(retrieved.getName()).toContain('Fallback');
    });

    it('returns fallback for empty plan type', () => {
      const retrieved = registry.getStrategy('');
      expect(retrieved).toBeDefined();
      expect(retrieved.getName()).toContain('Fallback');
    });

    it('returns fallback for null plan type', () => {
      const retrieved = registry.getStrategy(null as any);
      expect(retrieved).toBeDefined();
      expect(retrieved.getName()).toContain('Fallback');
    });

    it('returns correct built-in strategy instances', () => {
      const flatStrategy = registry.getStrategy('flat');
      expect(flatStrategy).toBeInstanceOf(FlatPricingStrategy);

      const perSeatStrategy = registry.getStrategy('per-seat');
      expect(perSeatStrategy).toBeInstanceOf(PerSeatPricingStrategy);

      const usageBasedStrategy = registry.getStrategy('usage-based');
      expect(usageBasedStrategy).toBeInstanceOf(UsageBasedPricingStrategy);

      const tieredStrategy = registry.getStrategy('tiered');
      expect(tieredStrategy).toBeInstanceOf(TieredPricingStrategy);
    });
  });

  describe('fallback strategy', () => {
    it('uses FallbackPricingStrategy by default for unknown types', () => {
      const retrieved = registry.getStrategy('completely-unknown');
      expect(retrieved).toBeInstanceOf(FallbackPricingStrategy);
    });

    it('allows setting a custom fallback strategy', () => {
      const customFallback = createMockStrategy('custom-fallback');
      registry.setFallbackStrategy(customFallback);

      const retrieved = registry.getStrategy('unknown-type');
      expect(retrieved.getName()).toBe('custom-fallback');
    });

    it('throws error if fallback strategy is null', () => {
      expect(() => {
        registry.setFallbackStrategy(null as any);
      }).toThrow('Fallback strategy cannot be null');
    });

    it('throws error if fallback strategy is undefined', () => {
      expect(() => {
        registry.setFallbackStrategy(undefined as any);
      }).toThrow('Fallback strategy cannot be null');
    });
  });

  describe('discovery', () => {
    it('lists all registered strategy types', () => {
      registry.register('custom1', createMockStrategy('custom1'));
      registry.register('custom2', createMockStrategy('custom2'));

      const types = registry.getRegisteredTypes();
      expect(types).toContain('custom1');
      expect(types).toContain('custom2');
      expect(types).toContain('flat');
    });

    it('does not include fallback in registered types', () => {
      const types = registry.getRegisteredTypes();
      expect(types).not.toContain('fallback');
    });

    it('returns empty array after clearing', () => {
      registry.clear();
      const types = registry.getRegisteredTypes();
      expect(types).toEqual([]);
    });
  });

  describe('dynamic strategy registration', () => {
    it('allows registering a completely new strategy', () => {
      const newStrategy = createMockStrategy('enterprise-pricing');
      registry.register('enterprise', newStrategy);

      expect(registry.hasStrategy('enterprise')).toBe(true);
      expect(registry.getStrategy('enterprise').getName()).toBe('enterprise-pricing');
    });

    it('allows multiple custom strategies to coexist', () => {
      registry.register('custom-a', createMockStrategy('custom-a'));
      registry.register('custom-b', createMockStrategy('custom-b'));
      registry.register('custom-c', createMockStrategy('custom-c'));

      const typeA = registry.getStrategy('custom-a');
      const typeB = registry.getStrategy('custom-b');
      const typeC = registry.getStrategy('custom-c');

      expect(typeA.getName()).toBe('custom-a');
      expect(typeB.getName()).toBe('custom-b');
      expect(typeC.getName()).toBe('custom-c');
    });

    it('allows updating a strategy after registration', () => {
      const strategy1 = createMockStrategy('v1');
      registry.register('versioned', strategy1);
      expect(registry.getStrategy('versioned').getName()).toBe('v1');

      const strategy2 = createMockStrategy('v2');
      registry.register('versioned', strategy2);
      expect(registry.getStrategy('versioned').getName()).toBe('v2');
    });
  });

  describe('clear', () => {
    it('removes all registered strategies', () => {
      registry.register('custom1', createMockStrategy('custom1'));
      registry.register('custom2', createMockStrategy('custom2'));

      registry.clear();

      const types = registry.getRegisteredTypes();
      expect(types.length).toBe(0);
    });

    it('does not affect fallback strategy', () => {
      registry.clear();
      const retrieved = registry.getStrategy('unknown');
      expect(retrieved).toBeInstanceOf(FallbackPricingStrategy);
    });

    it('allows re-registering after clear', () => {
      registry.register('custom', createMockStrategy('custom'));
      registry.clear();

      expect(registry.hasStrategy('custom')).toBe(false);

      registry.register('custom', createMockStrategy('re-registered'));
      expect(registry.hasStrategy('custom')).toBe(true);
      expect(registry.getStrategy('custom').getName()).toBe('re-registered');
    });
  });

  describe('singleton pattern', () => {
    it('returns same instance from getStrategyRegistry()', () => {
      resetStrategyRegistry();
      const registry1 = getStrategyRegistry();
      const registry2 = getStrategyRegistry();

      expect(registry1).toBe(registry2);
    });

    it('persists registrations across multiple getStrategyRegistry() calls', () => {
      resetStrategyRegistry();
      const registry1 = getStrategyRegistry();
      registry1.register('persistent', createMockStrategy('persistent'));

      const registry2 = getStrategyRegistry();
      expect(registry2.hasStrategy('persistent')).toBe(true);
    });

    it('resets to new instance after resetStrategyRegistry()', () => {
      resetStrategyRegistry();
      const registry1 = getStrategyRegistry();
      registry1.register('test', createMockStrategy('test'));

      resetStrategyRegistry();
      const registry2 = getStrategyRegistry();

      // New instance should not have the custom registration
      expect(registry2.hasStrategy('test')).toBe(false);
      // But should have built-in strategies
      expect(registry2.hasStrategy('flat')).toBe(true);
    });
  });

  describe('case sensitivity', () => {
    it('treats plan type codes as case-insensitive', () => {
      registry.register('MyPricing', createMockStrategy('my-pricing'));

      expect(registry.hasStrategy('MYPRICING')).toBe(true);
      expect(registry.hasStrategy('mypricing')).toBe(true);
      expect(registry.hasStrategy('MyPricing')).toBe(true);
      expect(registry.hasStrategy('MYPRICING')).toBe(true);
    });

    it('returns same strategy regardless of case', () => {
      registry.register('TestCase', createMockStrategy('test-case'));

      const s1 = registry.getStrategy('TESTCASE');
      const s2 = registry.getStrategy('testcase');
      const s3 = registry.getStrategy('TestCase');

      expect(s1).toBe(s2);
      expect(s2).toBe(s3);
    });
  });

  describe('edge cases', () => {
    it('handles whitespace-only plan type code', () => {
      expect(() => {
        registry.register('   ', createMockStrategy('test'));
      }).toThrow('Plan type code must be a non-empty string');
    });

    it('handles strategy with complex calculate logic', () => {
      const complexStrategy: PricingStrategy = {
        getName: () => 'complex',
        calculate: (usage, plan, subscriber) => {
          const value = plan.basePrice * 2;
          return {
            value,
            currency: plan.currency,
            breakdown: { doubled: value },
          };
        },
      };

      registry.register('complex', complexStrategy);
      const retrieved = registry.getStrategy('complex');
      expect(retrieved).toBe(complexStrategy);
    });
  });
});
