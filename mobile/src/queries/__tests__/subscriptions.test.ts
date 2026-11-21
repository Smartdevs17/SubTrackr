import { QueryClient } from '../queryClient';
import {
  createHttpSubscriptionApi,
  createSubscriptionQueries,
  QueryHttpError,
  subscriptionKeys,
} from '../subscriptions';
import type {
  QueryFetchLike,
  QueryHttpResponse,
  SubscriptionListItem,
} from '../subscriptions';

const item: SubscriptionListItem = {
  id: 'sub-1',
  name: 'Netflix',
  status: 'active',
  price: 15.99,
  currency: 'USD',
};

function response(body: unknown, status = 200, ok = true): QueryHttpResponse {
  return { ok, status, json: async () => body };
}

describe('subscription query keys', () => {
  it('are stable for equivalent filters and distinct otherwise', () => {
    expect(subscriptionKeys.list({ status: 'active' })).toEqual(
      subscriptionKeys.list({ status: 'active' }),
    );
    expect(subscriptionKeys.list({ status: 'active' })).not.toEqual(
      subscriptionKeys.list({ status: 'canceled' }),
    );
    expect(subscriptionKeys.detail('sub-1')).toEqual(['subscriptions', 'detail', 'sub-1']);
  });
});

describe('createSubscriptionQueries', () => {
  it('uses dedicated keys, tags and TTLs for list/detail/counts', async () => {
    const api = {
      listSubscriptions: jest.fn(async () => [item]),
      getSubscription: jest.fn(async () => item),
      getCounts: jest.fn(async () => ({ total: 1, active: 1, canceled: 0, pastDue: 0 })),
    };
    const client = new QueryClient({ sleep: async () => undefined });
    const queries = createSubscriptionQueries(api, client);

    const list = await queries.list({ status: 'active' });
    const detail = await queries.detail('sub-1');
    const counts = await queries.counts();

    expect(list.data).toHaveLength(1);
    expect(detail.data?.name).toBe('Netflix');
    expect(counts.data?.total).toBe(1);
    expect(client.getSnapshot(subscriptionKeys.counts())?.fromCache).toBe(false);
    expect(queries.invalidateAll()).toContain(JSON.stringify(subscriptionKeys.counts()));
    expect(client.getSnapshot(subscriptionKeys.list({ status: 'active' }))).toBeUndefined();
  });

  it('passes the abort signal to the API', async () => {
    const api = {
      listSubscriptions: jest.fn(async (_filters: unknown, _signal: AbortSignal) => []),
      getSubscription: jest.fn(async () => item),
      getCounts: jest.fn(async () => ({ total: 0, active: 0, canceled: 0, pastDue: 0 })),
    };
    const queries = createSubscriptionQueries(api, new QueryClient());
    await queries.list({ limit: 5 });
    const signal = api.listSubscriptions.mock.calls[0][1];
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe('createHttpSubscriptionApi', () => {
  it('builds query strings, unwraps envelopes and forwards headers/signals', async () => {
    const calls: Array<{ url: string; init?: Parameters<QueryFetchLike>[1] }> = [];
    const fetchImpl: QueryFetchLike = async (url, init) => {
      calls.push({ url, init });
      return response({ success: true, data: [{ id: 'sub-1' }] });
    };
    const api = createHttpSubscriptionApi({
      baseUrl: 'https://api.example.test/',
      fetchImpl,
      headers: { Authorization: 'Bearer token' },
    });
    const result = await api.listSubscriptions(
      { status: 'active', search: 'netflix', limit: 10 },
      new AbortController().signal,
    );

    expect(result).toEqual([{ id: 'sub-1' }]);
    expect(calls[0].url).toBe(
      'https://api.example.test/api/subscriptions?status=active&search=netflix&limit=10',
    );
    expect(calls[0].init?.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer token',
    });
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('loads detail and counts from their own endpoints', async () => {
    const urls: string[] = [];
    const fetchImpl: QueryFetchLike = async (url) => {
      urls.push(url);
      return response({ data: { id: 'sub/1' } });
    };
    const api = createHttpSubscriptionApi({ baseUrl: 'https://api.example.test', fetchImpl });
    const signal = new AbortController().signal;
    await api.getSubscription('sub/1', signal);
    await api.getCounts(signal);

    expect(urls).toEqual([
      'https://api.example.test/api/subscriptions/sub%2F1',
      'https://api.example.test/api/subscriptions/counts',
    ]);
  });

  it('throws typed errors for HTTP and envelope failures', async () => {
    const fetchImpl: QueryFetchLike = async (url) =>
      url.includes('missing')
        ? response({ error: 'not found' }, 404, false)
        : response({ success: false, error: 'invalid status' });
    const api = createHttpSubscriptionApi({ baseUrl: 'https://api.example.test', fetchImpl });
    const signal = new AbortController().signal;

    await expect(api.getSubscription('missing', signal)).rejects.toMatchObject({
      name: 'QueryHttpError',
      status: 404,
    });
    await expect(api.getCounts(signal)).rejects.toBeInstanceOf(QueryHttpError);
  });
});
