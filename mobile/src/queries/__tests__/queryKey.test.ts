import { describeQueryKey, isQueryKeyPrefix, serializeQueryKey } from '../queryKey';

describe('query keys', () => {
  it('serialises keys in a stable, order-sensitive form', () => {
    expect(serializeQueryKey(['subscriptions', 'list', 'active', null])).toBe(
      '["subscriptions","list","active",null]',
    );
    expect(serializeQueryKey(['subscriptions', 'list'])).not.toBe(
      serializeQueryKey(['list', 'subscriptions']),
    );
  });

  it('rejects empty keys and non-primitive parts', () => {
    expect(() => serializeQueryKey([])).toThrow('non-empty');
    expect(() => serializeQueryKey(['subscriptions', { id: 1 } as never])).toThrow(
      'Query key parts',
    );
  });

  it('matches prefixes without matching unrelated keys', () => {
    expect(isQueryKeyPrefix(['subscriptions', 'list', 1], ['subscriptions'])).toBe(true);
    expect(isQueryKeyPrefix(['subscriptions', 'list'], ['subscriptions', 'list'])).toBe(true);
    expect(isQueryKeyPrefix(['subscriptions'], ['subscriptions', 'list'])).toBe(false);
    expect(isQueryKeyPrefix(['subscription', 'list'], ['subscriptions'])).toBe(false);
  });

  it('describes null parts as wildcards for logs', () => {
    expect(describeQueryKey(['subscriptions', 'list', null, 'active'])).toBe(
      'subscriptions/list/*/active',
    );
  });
});
