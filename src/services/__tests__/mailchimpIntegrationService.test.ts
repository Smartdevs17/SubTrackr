import {
  MailchimpIntegrationService,
  createMailchimpIntegrationService,
} from '../mailchimpIntegrationService';
import type {
  MailchimpConfig,
  SubscriptionEventPayload,
  MailchimpWebhookEvent,
} from '../../types/mailchimp';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const testConfig: MailchimpConfig = {
  apiKey: 'test-api-key-us6',
  datacenter: 'us6',
  defaultListId: 'list-abc123',
  fromName: 'SubTrackr Test',
  replyTo: 'test@subtrackr.app',
};

const activePayload: SubscriptionEventPayload = {
  type: 'subscription_created',
  subscriptionId: 'sub-001',
  subscriberEmail: 'user@example.com',
  subscriberName: 'Alice Smith',
  planName: 'Pro Monthly',
  amount: 29.99,
  currency: 'USD',
  nextBillingDate: new Date('2026-10-01'),
};

const renewalPayload: SubscriptionEventPayload = {
  type: 'renewal_reminder',
  subscriptionId: 'sub-002',
  subscriberEmail: 'bob@example.com',
  subscriberName: 'Bob Jones',
  planName: 'Pro Yearly',
  amount: 287.88,
  currency: 'USD',
  nextBillingDate: new Date('2027-01-01'),
};

const paymentFailedPayload: SubscriptionEventPayload = {
  type: 'payment_failed',
  subscriptionId: 'sub-003',
  subscriberEmail: 'carol@example.com',
  planName: 'Starter',
  amount: 9.99,
  currency: 'USD',
};

const trialEndingPayload: SubscriptionEventPayload = {
  type: 'trial_ending',
  subscriptionId: 'sub-004',
  subscriberEmail: 'dave@example.com',
  planName: 'Pro Monthly',
  amount: 29.99,
  currency: 'USD',
  trialEndDate: new Date('2026-09-30'),
};

const cancelledPayload: SubscriptionEventPayload = {
  type: 'subscription_cancelled',
  subscriptionId: 'sub-005',
  subscriberEmail: 'eve@example.com',
  planName: 'Pro Monthly',
  amount: 0,
  currency: 'USD',
  cancelledAt: new Date('2026-09-26'),
};

// ─── Mock fetch factory ───────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown = {}): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MailchimpIntegrationService', () => {
  let fetchMock: jest.Mock;
  let service: MailchimpIntegrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = mockFetch(200, { id: 'member-001', email_address: 'user@example.com' });
    service = createMailchimpIntegrationService(testConfig, fetchMock as unknown as typeof fetch);
  });

  // ─── upsertSubscriber ──────────────────────────────────────────────────────

  describe('upsertSubscriber()', () => {
    it('calls the correct Mailchimp members endpoint with PUT', async () => {
      const result = await service.upsertSubscriber({
        email_address: 'user@example.com',
        status: 'subscribed',
        merge_fields: { FNAME: 'Alice', PLAN: 'Pro Monthly' },
      });
      expect(result.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain('/lists/list-abc123/members/');
      expect(opts.method).toBe('PUT');
    });

    it('includes Authorization header', async () => {
      await service.upsertSubscriber({
        email_address: 'user@example.com',
        status: 'subscribed',
        merge_fields: {},
      });
      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.headers['Authorization']).toContain('Basic ');
    });

    it('returns error response on non-200 status', async () => {
      fetchMock = mockFetch(400, { detail: 'Invalid email' });
      service = createMailchimpIntegrationService(testConfig, fetchMock as unknown as typeof fetch);
      const result = await service.upsertSubscriber({
        email_address: 'bad',
        status: 'subscribed',
        merge_fields: {},
      });
      expect(result.status).toBe(400);
      expect(result.error).toBe('Invalid email');
    });

    it('handles network errors gracefully', async () => {
      const errorFetch = jest.fn().mockRejectedValue(new Error('Network timeout'));
      service = createMailchimpIntegrationService(testConfig, errorFetch as unknown as typeof fetch);
      const result = await service.upsertSubscriber({
        email_address: 'user@example.com',
        status: 'subscribed',
        merge_fields: {},
      });
      expect(result.status).toBe(0);
      expect(result.error).toContain('Network timeout');
    });
  });

  // ─── removeSubscriber ──────────────────────────────────────────────────────

  describe('removeSubscriber()', () => {
    it('calls PATCH with status unsubscribed', async () => {
      await service.removeSubscriber('user@example.com');
      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.method).toBe('PATCH');
      expect(JSON.parse(opts.body)).toEqual({ status: 'unsubscribed' });
    });
  });

  // ─── deleteSubscriber ──────────────────────────────────────────────────────

  describe('deleteSubscriber()', () => {
    it('calls DELETE on the member endpoint', async () => {
      fetchMock = mockFetch(204);
      service = createMailchimpIntegrationService(testConfig, fetchMock as unknown as typeof fetch);
      const result = await service.deleteSubscriber('user@example.com');
      expect(result.status).toBe(204);
      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.method).toBe('DELETE');
    });
  });

  // ─── getSubscriber ─────────────────────────────────────────────────────────

  describe('getSubscriber()', () => {
    it('calls GET on the member endpoint', async () => {
      await service.getSubscriber('user@example.com');
      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.method).toBe('GET');
    });
  });

  // ─── listAudiences ─────────────────────────────────────────────────────────

  describe('listAudiences()', () => {
    it('calls GET /lists', async () => {
      fetchMock = mockFetch(200, { lists: [] });
      service = createMailchimpIntegrationService(testConfig, fetchMock as unknown as typeof fetch);
      const result = await service.listAudiences();
      expect(result.status).toBe(200);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('/lists');
    });
  });

  // ─── updateTags / addTags / removeTags ────────────────────────────────────

  describe('tag management', () => {
    it('updateTags sends a POST to the tags endpoint', async () => {
      await service.updateTags('user@example.com', [{ name: 'vip', status: 'active' }]);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain('/tags');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body).tags[0].name).toBe('vip');
    });

    it('addTags wraps tags with status active', async () => {
      await service.addTags('user@example.com', ['tag-a', 'tag-b']);
      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.tags.every((t: { status: string }) => t.status === 'active')).toBe(true);
    });

    it('removeTags wraps tags with status inactive', async () => {
      await service.removeTags('user@example.com', ['old-tag']);
      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.tags[0].status).toBe('inactive');
    });
  });

  // ─── buildMergeFields ──────────────────────────────────────────────────────

  describe('buildMergeFields()', () => {
    it('maps payload fields to Mailchimp merge fields', () => {
      const fields = service.buildMergeFields(activePayload);
      expect(fields.FNAME).toBe('Alice');
      expect(fields.LNAME).toBe('Smith');
      expect(fields.PLAN).toBe('Pro Monthly');
      expect(fields.AMOUNT).toBe('29.99');
      expect(fields.CURRENCY).toBe('USD');
      expect(fields.NEXTBILL).toBe('2026-10-01');
    });

    it('handles missing subscriberName gracefully', () => {
      const fields = service.buildMergeFields({ ...activePayload, subscriberName: undefined });
      expect(fields.FNAME).toBe('');
      expect(fields.LNAME).toBe('');
    });

    it('formats nextBillingDate as YYYY-MM-DD', () => {
      const fields = service.buildMergeFields(renewalPayload);
      expect(fields.NEXTBILL).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // ─── handleSubscriptionEvent ──────────────────────────────────────────────

  describe('handleSubscriptionEvent()', () => {
    it('upserts subscriber and applies tag for subscription_created', async () => {
      const result = await service.handleSubscriptionEvent(activePayload);
      expect(result.upsertResult.status).toBe(200);
      // Two calls: upsert + updateTags
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('sets status to unsubscribed for subscription_cancelled', async () => {
      await service.handleSubscriptionEvent(cancelledPayload);
      const [, opts] = fetchMock.mock.calls[0];
      expect(JSON.parse(opts.body).status).toBe('unsubscribed');
    });

    it('applies correct tag for renewal_reminder', async () => {
      await service.handleSubscriptionEvent(renewalPayload);
      const [, opts] = fetchMock.mock.calls[1];
      const body = JSON.parse(opts.body);
      const activeTag = body.tags.find((t: { status: string }) => t.status === 'active');
      expect(activeTag.name).toBe('subtrackr-renewal-due');
    });

    it('applies correct tag for payment_failed', async () => {
      await service.handleSubscriptionEvent(paymentFailedPayload);
      const [, opts] = fetchMock.mock.calls[1];
      const body = JSON.parse(opts.body);
      const activeTag = body.tags.find((t: { status: string }) => t.status === 'active');
      expect(activeTag.name).toBe('subtrackr-payment-failed');
    });

    it('applies correct tag for trial_ending', async () => {
      await service.handleSubscriptionEvent(trialEndingPayload);
      const [, opts] = fetchMock.mock.calls[1];
      const body = JSON.parse(opts.body);
      const activeTag = body.tags.find((t: { status: string }) => t.status === 'active');
      expect(activeTag.name).toBe('subtrackr-trial-ending');
    });
  });

  // ─── createEventCampaign ──────────────────────────────────────────────────

  describe('createEventCampaign()', () => {
    it('posts a campaign with correct subject for renewal_reminder', async () => {
      await service.createEventCampaign(renewalPayload);
      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body) as { settings: { subject_line: string }; recipients: { list_id: string } };
      expect(body.settings.subject_line).toContain('renews on');
      expect(body.recipients.list_id).toBe('list-abc123');
    });

    it('includes segment condition scoped to subscriber email', async () => {
      await service.createEventCampaign(activePayload);
      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body) as { recipients: { segment_opts: { conditions: Array<{ value: string }> } } };
      expect(body.recipients.segment_opts.conditions[0].value).toBe('user@example.com');
    });

    it('uses correct subject for payment_failed', async () => {
      await service.createEventCampaign(paymentFailedPayload);
      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body) as { settings: { subject_line: string } };
      expect(body.settings.subject_line).toContain('payment failed');
    });

    it('uses correct subject for subscription_cancelled', async () => {
      await service.createEventCampaign(cancelledPayload);
      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body) as { settings: { subject_line: string } };
      expect(body.settings.subject_line).toContain('cancelled');
    });
  });

  // ─── sendCampaign / scheduleCampaign ──────────────────────────────────────

  describe('sendCampaign()', () => {
    it('sends POST to /campaigns/{id}/actions/send', async () => {
      await service.sendCampaign('camp-001');
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain('/campaigns/camp-001/actions/send');
      expect(opts.method).toBe('POST');
    });
  });

  describe('scheduleCampaign()', () => {
    it('sends schedule_time in body', async () => {
      const scheduleTime = new Date('2026-10-05T09:00:00Z');
      await service.scheduleCampaign('camp-001', scheduleTime);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain('actions/schedule');
      expect(JSON.parse(opts.body).schedule_time).toContain('2026-10-05');
    });
  });

  // ─── processWebhook ───────────────────────────────────────────────────────

  describe('processWebhook()', () => {
    const makeEvent = (type: MailchimpWebhookEvent['type'], email = 'user@example.com'): MailchimpWebhookEvent => ({
      type,
      fired_at: new Date().toISOString(),
      data: { email, list_id: 'list-abc123' },
    });

    it('handles unsubscribe event', () => {
      const result = service.processWebhook(makeEvent('unsubscribe'));
      expect(result.handled).toBe(true);
      expect(result.action).toBe('mark_unsubscribed');
      expect(result.email).toBe('user@example.com');
    });

    it('handles subscribe event', () => {
      const result = service.processWebhook(makeEvent('subscribe'));
      expect(result.handled).toBe(true);
      expect(result.action).toBe('mark_subscribed');
    });

    it('handles cleaned event', () => {
      const result = service.processWebhook(makeEvent('cleaned'));
      expect(result.handled).toBe(true);
      expect(result.action).toBe('remove_bounced');
    });

    it('handles profile update event', () => {
      const result = service.processWebhook(makeEvent('profile'));
      expect(result.handled).toBe(true);
      expect(result.action).toBe('update_profile');
    });

    it('handles email update event', () => {
      const result = service.processWebhook(makeEvent('upemail'));
      expect(result.handled).toBe(true);
      expect(result.action).toBe('update_email');
    });

    it('handles campaign event', () => {
      const event: MailchimpWebhookEvent = {
        type: 'campaign',
        fired_at: new Date().toISOString(),
        data: { campaign_id: 'camp-xyz' },
      };
      const result = service.processWebhook(event);
      expect(result.handled).toBe(true);
      expect(result.action).toBe('campaign_event');
      expect((result.details as { campaignId: string }).campaignId).toBe('camp-xyz');
    });
  });

  // ─── createMailchimpIntegrationService factory ────────────────────────────

  describe('createMailchimpIntegrationService()', () => {
    it('creates a service instance with default fromName and replyTo', () => {
      const minimal = createMailchimpIntegrationService(
        {
          apiKey: 'key',
          datacenter: 'us1',
          defaultListId: 'list-001',
        },
        fetchMock as unknown as typeof fetch
      );
      expect(minimal).toBeInstanceOf(MailchimpIntegrationService);
    });
  });
});
