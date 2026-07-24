/**
 * Public RPC endpoints for read-only calls and Superfluid Framework initialization.
 * Keep aligned with `App.tsx` chain definitions.
 */
export const EVM_RPC_URLS: Record<number, string[]> = {
  1: ['https://cloudflare-eth.com', 'https://rpc.ankr.com/eth', 'https://eth.llamarpc.com'],
  137: ['https://polygon-rpc.com', 'https://rpc.ankr.com/polygon'],
  42161: ['https://arb1.arbitrum.io/rpc', 'https://rpc.ankr.com/arbitrum'],
  10: ['https://mainnet.optimism.io', 'https://rpc.ankr.com/optimism'],
  8453: ['https://mainnet.base.org', 'https://developer-access-mainnet.base.org'],
};

export function getEvmRpcUrls(chainId: number): string[] {
  const urls = EVM_RPC_URLS[chainId];
  if (!urls || urls.length === 0) {
    throw new Error(`No RPC configured for chain ${chainId}`);
  }
  return urls;
}
