import { Keypair } from '@stellar/stellar-sdk';

export interface StellarKeypair {
  publicKey: string;
  secretKey: string;
}

export function generateStellarKeypair(): StellarKeypair {
  const kp = Keypair.random();
  return {
    publicKey: kp.publicKey(),
    secretKey: kp.secret(),
  };
}

export function isValidStellarPublicKey(key: string): boolean {
  try {
    Keypair.fromPublicKey(key);
    return true;
  } catch {
    return false;
  }
}
