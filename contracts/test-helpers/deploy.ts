import { deployContract } from '../../packages/test-harness/dist/index.js';

export async function deploy(wasmHex: string) {
  return deployContract(wasmHex);
}
