import { useState, useCallback } from 'react';
import { ChainType } from '../types/wallet';
import { walletServiceManager, WalletError, WalletErrorCode } from '../services/walletService';
import { crossChainNotificationService } from '../services/crossChainNotificationService';
import { useSubscriptionStore } from '../store/subscriptionStore';

interface ChainSwitchingState {
  isSwitching: boolean;
  currentChainType: ChainType | null;
  currentChainId: number | null;
  error: string | null;
}

export function useChainSwitching() {
  const [state, setState] = useState<ChainSwitchingState>({
    isSwitching: false,
    currentChainType: null,
    currentChainId: null,
    error: null,
  });

  const setChainFilter = useSubscriptionStore((s) => s.setChainFilter);

  const getSupportedChains = useCallback(() => {
    return walletServiceManager.getSupportedChains();
  }, []);

  const switchToEthereum = useCallback(async () => {
    await switchToChain(ChainType.EVM, 1);
  }, []);

  const switchToPolygon = useCallback(async () => {
    await switchToChain(ChainType.EVM, 137);
  }, []);

  const switchToArbitrum = useCallback(async () => {
    await switchToChain(ChainType.EVM, 42161);
  }, []);

  const switchToStellar = useCallback(async () => {
    await switchToChain(ChainType.STELLAR, 0x8000);
  }, []);

  const switchToChain = useCallback(async (chainType: ChainType, chainId: number) => {
    setState((prev) => ({ ...prev, isSwitching: true, error: null }));

    try {
      const conn = walletServiceManager.getConnection();
      if (!conn) {
        if (chainType === ChainType.STELLAR) {
          await walletServiceManager.connectStellarWallet();
        } else {
          throw new WalletError(
            WalletErrorCode.NOT_CONNECTED,
            'Connect an EVM wallet first.',
            'Use the connect button to connect your wallet.'
          );
        }
      }

      await walletServiceManager.switchChain(chainType, chainId);

      setChainFilter({ chainType, chainId });

      crossChainNotificationService.notifyChainSwitched(
        state.currentChainType || chainType,
        chainType
      );

      setState({
        isSwitching: false,
        currentChainType: chainType,
        currentChainId: chainId,
        error: null,
      });
    } catch (error) {
      const message = error instanceof WalletError ? error.userMessage : 'Failed to switch chain';
      setState({
        isSwitching: false,
        currentChainType: state.currentChainType,
        currentChainId: state.currentChainId,
        error: message,
      });
    }
  }, [state.currentChainType, state.currentChainId, setChainFilter]);

  const disconnect = useCallback(async () => {
    await walletServiceManager.disconnectWallet();
    setState({
      isSwitching: false,
      currentChainType: null,
      currentChainId: null,
      error: null,
    });
  }, []);

  return {
    ...state,
    switchToChain,
    switchToEthereum,
    switchToPolygon,
    switchToArbitrum,
    switchToStellar,
    disconnect,
    getSupportedChains,
  };
}
