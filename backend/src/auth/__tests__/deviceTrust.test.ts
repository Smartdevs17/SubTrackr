import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryDeviceTrustStore,
  issueRefreshToken,
  rotateRefreshToken,
  revokeAllForUser,
  DeviceTrustError,
  hashToken,
  type DeviceFingerprint,
} from '../deviceTrust';

const fp: DeviceFingerprint = {
  userAgentHash: 'abc123',
  ipHint: '192.168.1.0',
  deviceId: 'device-001',
};

const fpOther: DeviceFingerprint = {
  userAgentHash: 'xyz999',
  deviceId: 'device-002',
};

describe('issueRefreshToken', () => {
  it('creates a trust record with the given fingerprint', async () => {
    const store = new InMemoryDeviceTrustStore();
    const token = await issueRefreshToken(store, 'user1', fp);

    expect(token).toBeTruthy();
    const record = await store.findByTokenHash(hashToken(token));
    expect(record).not.toBeNull();
    expect(record!.userId).toBe('user1');
    expect(record!.fingerprint).toMatchObject(fp);
    expect(record!.revokedAt).toBeUndefined();
  });
});

describe('rotateRefreshToken', () => {
  let store: InMemoryDeviceTrustStore;
  let token: string;

  beforeEach(async () => {
    store = new InMemoryDeviceTrustStore();
    token = await issueRefreshToken(store, 'user1', fp);
  });

  it('issues a new token and revokes the old one', async () => {
    const { newToken } = await rotateRefreshToken(store, token, fp);
    expect(newToken).not.toBe(token);

    const oldRecord = await store.findByTokenHash(hashToken(token));
    expect(oldRecord!.revokedAt).toBeDefined();
    expect(oldRecord!.revokedReason).toBe('used');

    const newRecord = await store.findByTokenHash(hashToken(newToken));
    expect(newRecord!.revokedAt).toBeUndefined();
  });

  it('preserves the family ID across rotation', async () => {
    const oldRecord = await store.findByTokenHash(hashToken(token));
    const { newRecord } = await rotateRefreshToken(store, token, fp);
    expect(newRecord.familyId).toBe(oldRecord!.familyId);
  });

  it('throws UNKNOWN_TOKEN for an unrecognised token', async () => {
    await expect(rotateRefreshToken(store, 'bogus', fp)).rejects.toMatchObject({
      code: 'UNKNOWN_TOKEN',
    });
  });

  it('throws REVOKED_TOKEN and revokes the family on replay', async () => {
    // First rotation is valid
    const { newToken } = await rotateRefreshToken(store, token, fp);
    // Replaying the original token should trigger family breach
    await expect(rotateRefreshToken(store, token, fp)).rejects.toMatchObject({
      code: 'REVOKED_TOKEN',
    });
    // The new token should also be revoked (family breach)
    const sibling = await store.findByTokenHash(hashToken(newToken));
    expect(sibling!.revokedAt).toBeDefined();
    expect(sibling!.revokedReason).toBe('family_breach');
  });

  it('throws DEVICE_MISMATCH and revokes the family on fingerprint change', async () => {
    await expect(rotateRefreshToken(store, token, fpOther)).rejects.toMatchObject({
      code: 'DEVICE_MISMATCH',
    });
    // All family members should be revoked
    const record = await store.findByTokenHash(hashToken(token));
    expect(record!.revokedReason).toBe('device_mismatch');
  });

  it('throws EXPIRED_TOKEN for an expired record', async () => {
    // Issue a token that is already expired
    const expiredStore = new InMemoryDeviceTrustStore();
    const expiredToken = await issueRefreshToken(expiredStore, 'user1', fp, -1000);
    await expect(
      rotateRefreshToken(expiredStore, expiredToken, fp),
    ).rejects.toMatchObject({ code: 'EXPIRED_TOKEN' });
  });
});

describe('revokeAllForUser', () => {
  it('revokes all active tokens across all device families', async () => {
    const store = new InMemoryDeviceTrustStore();
    await issueRefreshToken(store, 'user1', fp);
    await issueRefreshToken(store, 'user1', fpOther);
    await issueRefreshToken(store, 'user2', fp);

    const count = await revokeAllForUser(store, 'user1');
    expect(count).toBe(2);

    const remaining = await store.listActiveForUser('user1');
    expect(remaining).toHaveLength(0);

    // user2 tokens should be untouched
    const user2 = await store.listActiveForUser('user2');
    expect(user2).toHaveLength(1);
  });
});
