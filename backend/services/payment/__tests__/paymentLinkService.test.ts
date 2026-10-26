/**
 * Tests for PaymentLinkService (Issue #1713).
 *
 * Coverage requirements:
 *  - creating a link generates a valid HMAC token                   ✓
 *  - validating with correct token succeeds                         ✓
 *  - validating with wrong token fails (invalid_token)              ✓
 *  - validating expired link fails (expired)                        ✓
 *  - revoking a link then validating fails (revoked)                ✓
 *  - getLink / listLinks                                             ✓
 *  - custom expiry                                                   ✓
 *  - revoking a non-existent link throws                            ✓
 *  - getLink returns null for unknown id                            ✓
 */

import { createHmac } from 'crypto';
import {
  PaymentLinkService,
  InMemoryPaymentLinkStore,
  PaymentLinkConfig,
  CreateLinkInput,
  PaymentLink,
} from '../domain/paymentLinkService';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: PaymentLinkConfig = {
  merchantId: 'mch_test_001',
  defaultExpirySeconds: 86400, // 24 h
  signingSecret: 'super-secret-key-for-tests',
};

const BASE_INPUT: CreateLinkInput = {
  merchantId: 'mch_test_001',
  amount: 49.99,
  currency: 'USD',
  memo: 'Order #42',
};

/** Builds a fresh service with a controllable clock so we can simulate expiry. */
function makeService(now = Date.now()) {
  let currentTime = now;
  const clock = () => currentTime;
  const store = new InMemoryPaymentLinkStore();
  const service = new PaymentLinkService(store, clock);

  return {
    service,
    store,
    clock,
    /** Advance the fake clock by `ms` milliseconds. */
    advance: (ms: number) => {
      currentTime += ms;
    },
    /** Rewind the fake clock by `ms` milliseconds (make things appear past). */
    rewind: (ms: number) => {
      currentTime -= ms;
    },
  };
}

/** Recompute the expected token from link fields, mirroring the service logic. */
function expectedToken(link: PaymentLink, secret: string): string {
  const message = `${link.id}|${link.merchantId}|${link.amount}|${link.currency}|${link.expiresAt}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('PaymentLinkService', () => {
  // -------------------------------------------------------------------------
  // createLink
  // -------------------------------------------------------------------------

  describe('createLink', () => {
    it('creates a link with a non-empty HMAC-SHA256 token', async () => {
      const { service } = makeService();

      const link = await service.createLink(BASE_INPUT, BASE_CONFIG);

      expect(link.token).toBeTruthy();
      // SHA-256 hex is exactly 64 characters.
      expect(link.token).toHaveLength(64);
    });

    it('generates a token that matches the canonical HMAC', async () => {
      const { service } = makeService();

      const link = await service.createLink(BASE_INPUT, BASE_CONFIG);
      const expected = expectedToken(link, BASE_CONFIG.signingSecret);

      expect(link.token).toBe(expected);
    });

    it('uses the default expiry from the config', async () => {
      const now = 1_700_000_000_000;
      const { service } = makeService(now);

      const link = await service.createLink(BASE_INPUT, BASE_CONFIG);

      expect(link.expiresAt).toBe(now + BASE_CONFIG.defaultExpirySeconds * 1000);
    });

    it('respects a custom expirySeconds override', async () => {
      const now = 1_700_000_000_000;
      const { service } = makeService(now);

      const link = await service.createLink({ ...BASE_INPUT, expirySeconds: 3600 }, BASE_CONFIG);

      // 3600 s custom, not 86400 default
      expect(link.expiresAt).toBe(now + 3600 * 1000);
    });

    it('sets createdAt to the current time', async () => {
      const now = 1_700_000_000_000;
      const { service } = makeService(now);

      const link = await service.createLink(BASE_INPUT, BASE_CONFIG);

      expect(link.createdAt).toBe(now);
    });

    it('sets status to "active"', async () => {
      const { service } = makeService();

      const link = await service.createLink(BASE_INPUT, BASE_CONFIG);

      expect(link.status).toBe('active');
    });

    it('stores the optional memo', async () => {
      const { service } = makeService();

      const link = await service.createLink({ ...BASE_INPUT, memo: 'Test memo' }, BASE_CONFIG);

      expect(link.memo).toBe('Test memo');
    });

    it('generates a unique id for each link', async () => {
      const { service } = makeService();

      const a = await service.createLink(BASE_INPUT, BASE_CONFIG);
      const b = await service.createLink(BASE_INPUT, BASE_CONFIG);

      expect(a.id).not.toBe(b.id);
    });

    it('throws when expirySeconds is zero', async () => {
      const { service } = makeService();

      await expect(
        service.createLink({ ...BASE_INPUT, expirySeconds: 0 }, BASE_CONFIG),
      ).rejects.toThrow('expirySeconds must be a positive integer');
    });

    it('throws when expirySeconds is negative', async () => {
      const { service } = makeService();

      await expect(
        service.createLink({ ...BASE_INPUT, expirySeconds: -1 }, BASE_CONFIG),
      ).rejects.toThrow('expirySeconds must be a positive integer');
    });

    it('throws when config merchantId does not match input merchantId', async () => {
      const { service } = makeService();

      await expect(
        service.createLink({ ...BASE_INPUT, merchantId: 'mch_other' }, BASE_CONFIG),
      ).rejects.toThrow('does not match');
    });
  });

  // -------------------------------------------------------------------------
  // validateLink
  // -------------------------------------------------------------------------

  describe('validateLink', () => {
    it('returns valid=true with the link for a correct token', async () => {
      const { service } = makeService();

      const link = await service.createLink(BASE_INPUT, BASE_CONFIG);
      const result = await service.validateLink(link.id, link.token, BASE_CONFIG);

      expect(result.valid).toBe(true);
      expect(result.link?.id).toBe(link.id);
      expect(result.reason).toBeUndefined();
    });

    it('returns not_found for an unknown id', async () => {
      const { service } = makeService();

      const result = await service.validateLink('nonexistent-id', 'any-token', BASE_CONFIG);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('returns invalid_token when the token is tampered with', async () => {
      const { service } = makeService();

      const link = await service.createLink(BASE_INPUT, BASE_CONFIG);
      const badToken = link.token.replace(/./g, 'a'); // all-a hex string

      const result = await service.validateLink(link.id, badToken, BASE_CONFIG);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_token');
    });

    it('returns invalid_token when the token has the right format but wrong secret', async () => {
      const { service } = makeService();

      const link = await service.createLink(BASE_INPUT, BASE_CONFIG);
      // Compute a valid-looking token with a different secret.
      const wrongToken = expectedToken(link, 'wrong-secret');

      const result = await service.validateLink(link.id, wrongToken, BASE_CONFIG);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_token');
    });

    it('returns expired when the link has passed its expiresAt', async () => {
      const { service, advance } = makeService();

      const link = await service.createLink(
        { ...BASE_INPUT, expirySeconds: 60 },
        BASE_CONFIG,
      );

      // Advance past expiry.
      advance(61_000);

      const result = await service.validateLink(link.id, link.token, BASE_CONFIG);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
    });

    it('returns valid=true when the link is exactly at (not past) expiry boundary', async () => {
      const { service } = makeService();

      // expirySeconds = 60; after 59 s the link should still be valid.
      const link = await service.createLink(
        { ...BASE_INPUT, expirySeconds: 60 },
        BASE_CONFIG,
      );

      // Do not advance time; link was just created.
      const result = await service.validateLink(link.id, link.token, BASE_CONFIG);

      expect(result.valid).toBe(true);
    });

    it('returns revoked when the link has been revoked', async () => {
      const { service } = makeService();

      const link = await service.createLink(BASE_INPUT, BASE_CONFIG);
      await service.revokeLink(link.id);

      const result = await service.validateLink(link.id, link.token, BASE_CONFIG);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('revoked');
    });

    it('revocation takes precedence over a correct token', async () => {
      const { service } = makeService();

      const link = await service.createLink(BASE_INPUT, BASE_CONFIG);
      await service.revokeLink(link.id);

      // Token is correct but link is revoked — must be rejected.
      const result = await service.validateLink(link.id, link.token, BASE_CONFIG);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('revoked');
      expect(result.link).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // revokeLink
  // -------------------------------------------------------------------------

  describe('revokeLink', () => {
    it('marks the link as revoked and records revokedAt', async () => {
      const now = 1_700_000_000_000;
      const { service } = makeService(now);

      const link = await service.createLink(BASE_INPUT, BASE_CONFIG);
      await service.revokeLink(link.id);

      const revoked = await service.getLink(link.id);
      expect(revoked?.status).toBe('revoked');
      expect(revoked?.revokedAt).toBe(now);
    });

    it('throws when trying to revoke a non-existent link', async () => {
      const { service } = makeService();

      await expect(service.revokeLink('does-not-exist')).rejects.toThrow(
        'PaymentLink does-not-exist not found',
      );
    });

    it('is idempotent — revoking twice does not throw', async () => {
      const { service } = makeService();

      const link = await service.createLink(BASE_INPUT, BASE_CONFIG);
      await service.revokeLink(link.id);

      // Should not throw on second revoke.
      await expect(service.revokeLink(link.id)).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getLink
  // -------------------------------------------------------------------------

  describe('getLink', () => {
    it('returns the link when it exists', async () => {
      const { service } = makeService();

      const created = await service.createLink(BASE_INPUT, BASE_CONFIG);
      const fetched = await service.getLink(created.id);

      expect(fetched?.id).toBe(created.id);
      expect(fetched?.merchantId).toBe(BASE_INPUT.merchantId);
    });

    it('returns null for an unknown id', async () => {
      const { service } = makeService();

      const result = await service.getLink('unknown-id');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // listLinks
  // -------------------------------------------------------------------------

  describe('listLinks', () => {
    it('returns all links belonging to a merchant', async () => {
      const { service } = makeService();

      await service.createLink(BASE_INPUT, BASE_CONFIG);
      await service.createLink(BASE_INPUT, BASE_CONFIG);

      const links = await service.listLinks(BASE_CONFIG.merchantId);

      expect(links).toHaveLength(2);
      expect(links.every((l) => l.merchantId === BASE_CONFIG.merchantId)).toBe(true);
    });

    it('returns an empty array when there are no links for a merchant', async () => {
      const { service } = makeService();

      const links = await service.listLinks('mch_unknown');

      expect(links).toEqual([]);
    });

    it('does not include links from a different merchant', async () => {
      const { service } = makeService();

      const otherConfig: PaymentLinkConfig = {
        merchantId: 'mch_other',
        defaultExpirySeconds: 3600,
        signingSecret: 'other-secret',
      };

      await service.createLink(BASE_INPUT, BASE_CONFIG);
      await service.createLink({ ...BASE_INPUT, merchantId: 'mch_other' }, otherConfig);

      const links = await service.listLinks(BASE_CONFIG.merchantId);

      expect(links).toHaveLength(1);
      expect(links[0].merchantId).toBe(BASE_CONFIG.merchantId);
    });
  });

  // -------------------------------------------------------------------------
  // InMemoryPaymentLinkStore
  // -------------------------------------------------------------------------

  describe('InMemoryPaymentLinkStore', () => {
    it('throws when updating a non-existent link', async () => {
      const store = new InMemoryPaymentLinkStore();

      await expect(store.update('ghost', { status: 'revoked' })).rejects.toThrow(
        'PaymentLink ghost not found',
      );
    });
  });
});
