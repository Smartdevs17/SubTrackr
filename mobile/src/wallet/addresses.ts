/**
 * mobile/src/wallet/addresses.ts
 *
 * Address/key validation shared by wallet adapters and session restore.
 */

const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function normaliseAddress(value: string): string {
  return value.trim();
}

export function isStellarPublicKey(value: string): boolean {
  return STELLAR_PUBLIC_KEY.test(normaliseAddress(value));
}

export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS.test(normaliseAddress(value));
}

export function isValidWalletAddress(value: string): boolean {
  return isStellarPublicKey(value) || isEvmAddress(value);
}
