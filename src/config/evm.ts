/**
 * Public RPC endpoints for read-only calls and Superfluid Framework initialization.
 * Keep aligned with `App.tsx` chain definitions.
 */
export const EVM_RPC_URLS: Record<number, string> = {
  1: 'https://cloudflare-eth.com',
  137: 'https://polygon-rpc.com',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',
  8453: 'https://mainnet.base.org',
};

export function getEvmRpcUrl(chainId: number): string {
  const url = EVM_RPC_URLS[chainId];
  if (!url) {
    throw new Error(`No RPC configured for chain ${chainId}`);
  }
  return url;
}
