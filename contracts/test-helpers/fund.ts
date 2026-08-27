import { fundAccount } from '../../packages/test-harness/dist/index.js';

export async function fund(publicKey: string) {
  return fundAccount(publicKey);
}
