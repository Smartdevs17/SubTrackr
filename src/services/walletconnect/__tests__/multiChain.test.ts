import { WALLETCONNECT_CHAINS } from '../chains';
import {
  buildMultiChainState,
  getActiveChain,
  getCaipNetworkId,
  isChainSupported,
  switchChain,
} from '../multiChain';

const SUPPORTED_IDS = WALLETCONNECT_CHAINS.map((c) => c.chainId);

describe('WalletConnect v2 — multi-chain support', () => {
  describe('buildMultiChainState', () => {
    it('sets activeChainId from argument', () => {
      const state = buildMultiChainState(137);
      expect(state.activeChainId).toBe(137);
    });

    it('includes all supported chain IDs', () => {
      const state = buildMultiChainState(1);
      expect(state.supportedChainIds).toEqual(expect.arrayContaining(SUPPORTED_IDS));
    });

    it('exposes chain metadata array', () => {
      const state = buildMultiChainState(1);
      expect(state.chains.length).toBe(WALLETCONNECT_CHAINS.length);
      expect(state.chains[0]).toHaveProperty('caipNetworkId');
    });
  });

  describe('switchChain', () => {
    it('succeeds for a supported chain', () => {
      const state = buildMultiChainState(1);
      const result = switchChain(state, 137);
      expect(result.success).toBe(true);
      expect(result.chainId).toBe(137);
      expect(result.chain?.name).toBe('Polygon');
    });

    it('fails for an unsupported chain ID', () => {
      const state = buildMultiChainState(1);
      const result = switchChain(state, 99999);
      expect(result.success).toBe(false);
      expect(result.error).toContain('chain_not_supported');
      expect(result.chainId).toBe(1); // stays on current
    });

    it('switching to current chain still succeeds', () => {
      const state = buildMultiChainState(1);
      const result = switchChain(state, 1);
      expect(result.success).toBe(true);
    });
  });

  describe('getActiveChain', () => {
    it('returns chain metadata for active chain', () => {
      const state = buildMultiChainState(8453);
      const chain = getActiveChain(state);
      expect(chain?.name).toBe('Base');
      expect(chain?.caipNetworkId).toBe('eip155:8453');
    });
  });

  describe('isChainSupported', () => {
    it('returns true for all configured chains', () => {
      SUPPORTED_IDS.forEach((id) => expect(isChainSupported(id)).toBe(true));
    });

    it('returns false for unknown chain', () => {
      expect(isChainSupported(0)).toBe(false);
    });
  });

  describe('getCaipNetworkId', () => {
    it('returns CAIP-2 network ID for Ethereum', () => {
      expect(getCaipNetworkId(1)).toBe('eip155:1');
    });

    it('returns CAIP-2 network ID for Arbitrum', () => {
      expect(getCaipNetworkId(42161)).toBe('eip155:42161');
    });

    it('returns undefined for unsupported chain', () => {
      expect(getCaipNetworkId(12345)).toBeUndefined();
    });
  });
});
