import { useWalletStore } from '../store/walletStore';
import { selectWalletProvider, WalletProvider } from './selectors';

/** Single entry point for screens that need wallet state and actions. */
export function useWalletProvider(): WalletProvider {
  return selectWalletProvider(useWalletStore());
}
