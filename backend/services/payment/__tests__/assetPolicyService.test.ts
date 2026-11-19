/**
 * AssetPolicyService allowlist/denylist tests (Issue #1717).
 */

import {
  AssetPolicyService,
  AssetNotAllowedError,
  InMemoryAssetPolicyRepository,
} from '../domain/AssetPolicyService';

function makeService(): {
  service: AssetPolicyService;
  repo: InMemoryAssetPolicyRepository;
} {
  const repo = new InMemoryAssetPolicyRepository();
  return { service: new AssetPolicyService(repo), repo };
}

describe('AssetPolicyService', () => {
  it('allows everything when no rules exist', async () => {
    const { service } = makeService();

    await expect(
      service.isAllowed({ merchantId: 'm1', chain: 'stellar', asset: 'XLM' }),
    ).resolves.toBe(true);
  });

  it('enforces a denylist', async () => {
    const { service } = makeService();
    await service.setPolicy('m1', [
      { merchantId: 'm1', chain: 'stellar', assetCode: 'SCAM', mode: 'deny' },
    ]);

    await expect(
      service.isAllowed({ merchantId: 'm1', chain: 'stellar', asset: 'scam' }),
    ).resolves.toBe(false);
    await expect(
      service.isAllowed({ merchantId: 'm1', chain: 'stellar', asset: 'XLM' }),
    ).resolves.toBe(true);
  });

  it('denylist is scoped to its chain', async () => {
    const { service } = makeService();
    await service.setPolicy('m1', [
      { merchantId: 'm1', chain: 'stellar', assetCode: 'USDC', mode: 'deny' },
    ]);

    await expect(
      service.isAllowed({ merchantId: 'm1', chain: 'evm', asset: 'USDC' }),
    ).resolves.toBe(true);
  });

  it('deny wins over allow for the same asset', async () => {
    const { service } = makeService();
    await service.setPolicy('m1', [
      { merchantId: 'm1', chain: 'stellar', assetCode: 'XLM', mode: 'allow' },
      { merchantId: 'm1', chain: 'stellar', assetCode: 'XLM', mode: 'deny' },
    ]);

    await expect(
      service.isAllowed({ merchantId: 'm1', chain: 'stellar', asset: 'XLM' }),
    ).resolves.toBe(false);
  });

  it('allowlist denies unlisted assets (deny-by-default)', async () => {
    const { service } = makeService();
    await service.setPolicy('m1', [
      { merchantId: 'm1', chain: 'stellar', assetCode: 'XLM', mode: 'allow' },
    ]);

    await expect(
      service.isAllowed({ merchantId: 'm1', chain: 'stellar', asset: 'XLM' }),
    ).resolves.toBe(true);
    await expect(
      service.isAllowed({ merchantId: 'm1', chain: 'stellar', asset: 'BTC' }),
    ).resolves.toBe(false);
  });

  it('matches issuers case-insensitively; issuer-less checks only match issuer-less rules', async () => {
    const { service } = makeService();
    await service.setPolicy('m1', [
      {
        merchantId: 'm1',
        chain: 'stellar',
        assetCode: 'USDC',
        assetIssuer: 'GA5ZSEJYB37JRC5AWC7X6FP7KEPML7YQPRBQMYJZXISSMLE4M7I6CPWU',
        mode: 'allow',
      },
    ]);

    await expect(
      service.isAllowed({
        merchantId: 'm1',
        chain: 'stellar',
        asset: 'usdc',
        issuer: 'ga5zsejyb37jrc5awc7x6fp7kepml7yqprbqmyjzxissmle4m7i6cpwu',
      }),
    ).resolves.toBe(true);

    // No issuer provided → only issuer-less rules match, so the
    // issuer-specific allow rule does not apply.
    await expect(
      service.isAllowed({ merchantId: 'm1', chain: 'stellar', asset: 'USDC' }),
    ).resolves.toBe(false);
  });

  it('does not match a rule with a different issuer', async () => {
    const { service } = makeService();
    await service.setPolicy('m1', [
      {
        merchantId: 'm1',
        chain: 'stellar',
        assetCode: 'USDC',
        assetIssuer: 'GA5ZSEJYB37JRC5AWC7X6FP7KEPML7YQPRBQMYJZXISSMLE4M7I6CPWU',
        mode: 'allow',
      },
    ]);

    await expect(
      service.isAllowed({
        merchantId: 'm1',
        chain: 'stellar',
        asset: 'USDC',
        issuer: 'GBADISSUER000000000000000000000000000000000000000000000000',
      }),
    ).resolves.toBe(false);
  });

  it('scopes policies per merchant', async () => {
    const { service } = makeService();
    await service.setPolicy('m1', [
      { merchantId: 'm1', chain: 'stellar', assetCode: 'XLM', mode: 'deny' },
    ]);

    await expect(
      service.isAllowed({ merchantId: 'm2', chain: 'stellar', asset: 'XLM' }),
    ).resolves.toBe(true);
  });

  it('setPolicy replaces prior rules for the merchant', async () => {
    const { service } = makeService();
    await service.setPolicy('m1', [
      { merchantId: 'm1', chain: 'stellar', assetCode: 'XLM', mode: 'deny' },
    ]);
    await service.setPolicy('m1', [
      { merchantId: 'm1', chain: 'stellar', assetCode: 'XLM', mode: 'allow' },
    ]);

    const rules = await service.getPolicy('m1');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.mode).toBe('allow');
    await expect(
      service.isAllowed({ merchantId: 'm1', chain: 'stellar', asset: 'XLM' }),
    ).resolves.toBe(true);
  });

  it('assertAllowed throws AssetNotAllowedError with merchant context', async () => {
    const { service } = makeService();
    await service.setPolicy('m1', [
      { merchantId: 'm1', chain: 'stellar', assetCode: 'XLM', mode: 'deny' },
    ]);

    await expect(
      service.assertAllowed({ merchantId: 'm1', chain: 'stellar', asset: 'XLM' }),
    ).rejects.toThrow(AssetNotAllowedError);
    await expect(
      service.assertAllowed({ merchantId: 'm1', chain: 'stellar', asset: 'XLM' }),
    ).rejects.toThrow(/m1/);
  });
});
