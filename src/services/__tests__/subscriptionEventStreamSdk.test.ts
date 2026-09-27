import {
  SubscriptionEventStreamClient,
  SubscriptionStreamEvent,
} from '../subscriptionEventStreamSdk';

describe('SubscriptionEventStreamClient', () => {
  let client: SubscriptionEventStreamClient;

  beforeEach(() => {
    client = new SubscriptionEventStreamClient({
      apiKey: 'test_api_key_123',
      endpoint: 'wss://stream.subtrackr.io/v1/events',
      autoReconnect: false,
    });
  });

  afterEach(() => {
    client.disconnect();
  });

  it('connects successfully and updates status to CONNECTED', async () => {
    const statusChanges: string[] = [];
    client.onStatusChange((status) => statusChanges.push(status));

    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(client.getStatus()).toBe('CONNECTED');
    expect(statusChanges).toEqual(['CONNECTING', 'CONNECTED']);
  });

  it('receives and processes typed subscription events', async () => {
    await client.connect();

    const receivedEvents: SubscriptionStreamEvent[] = [];
    const unsubscribe = client.on('subscription.created', (event) => {
      receivedEvents.push(event);
    });

    const mockEvent: SubscriptionStreamEvent = {
      id: 'evt_1001',
      type: 'subscription.created',
      timestamp: Date.now(),
      customerId: 'cust_abc',
      subscriptionId: 'sub_xyz',
      data: { plan: 'pro_monthly', amount: 2999 },
    };

    client.emitMockEvent(mockEvent);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].subscriptionId).toBe('sub_xyz');

    unsubscribe();
  });

  it('receives events via wildcard listener', async () => {
    await client.connect();

    const wildcardEvents: SubscriptionStreamEvent[] = [];
    client.on('*', (event) => wildcardEvents.push(event));

    const evt1: SubscriptionStreamEvent = {
      id: 'evt_1002',
      type: 'payment.succeeded',
      timestamp: Date.now(),
      customerId: 'cust_abc',
      subscriptionId: 'sub_xyz',
      data: { amount: 2999 },
    };

    const evt2: SubscriptionStreamEvent = {
      id: 'evt_1003',
      type: 'subscription.canceled',
      timestamp: Date.now(),
      customerId: 'cust_def',
      subscriptionId: 'sub_123',
      data: { reason: 'user_requested' },
    };

    client.emitMockEvent(evt1);
    client.emitMockEvent(evt2);

    expect(wildcardEvents).toHaveLength(2);
  });

  it('cleans up listeners when returned unsubscribe function is called', async () => {
    await client.connect();

    let count = 0;
    const unsubscribe = client.on('payment.failed', () => count++);

    client.emitMockEvent({
      id: 'evt_1004',
      type: 'payment.failed',
      timestamp: Date.now(),
      customerId: 'cust_1',
      subscriptionId: 'sub_1',
      data: { errorCode: 'card_declined' },
    });

    expect(count).toBe(1);

    unsubscribe();

    client.emitMockEvent({
      id: 'evt_1005',
      type: 'payment.failed',
      timestamp: Date.now(),
      customerId: 'cust_1',
      subscriptionId: 'sub_1',
      data: { errorCode: 'insufficient_funds' },
    });

    expect(count).toBe(1);
  });

  it('handles explicit disconnect', async () => {
    await client.connect();
    expect(client.isConnected()).toBe(true);

    client.disconnect();
    expect(client.isConnected()).toBe(false);
    expect(client.getStatus()).toBe('DISCONNECTED');
  });

  it('fails connect when API key or endpoint is missing', async () => {
    const invalidClient = new SubscriptionEventStreamClient({
      apiKey: '',
      endpoint: '',
      autoReconnect: false,
    });

    const errors: Error[] = [];
    invalidClient.onError((err) => errors.push(err));

    await invalidClient.connect();

    expect(invalidClient.getStatus()).toBe('ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('required');
  });
});
