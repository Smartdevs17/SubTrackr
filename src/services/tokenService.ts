import { ethers } from 'ethers';

import { ERC20__factory, getContractAddress } from '../contracts';
import { getEvmRpcUrl } from '../config/evm';
import { CRYPTO_CONSTANTS, CHAIN_IDS } from '../utils/constants/values';
import { NetworkError, NetworkErrorCode } from '../errors';
import {
  TokenBalance,
  WalletServiceContext,
  getNativeName,
  getNativeSymbol,
} from './walletServiceShared';

export class TokenService {
  constructor(private readonly context?: WalletServiceContext) {}

  async getTokenBalances(address: string, chainId: number): Promise<TokenBalance[]> {
    try {
      const provider =
        this.context?.getProvider?.(chainId) ??
        new ethers.providers.JsonRpcProvider(getEvmRpcUrl(chainId));
      const balances: TokenBalance[] = [];

      const nativeBalance = await provider.getBalance(address);

      balances.push({
        symbol: getNativeSymbol(chainId),
        name: getNativeName(chainId),
        address: '0x0000000000000000000000000000000000000000',
        balance: ethers.utils.formatEther(nativeBalance),
        decimals: CRYPTO_CONSTANTS.ETH_DECIMALS,
      });

      if (
        chainId === CHAIN_IDS.ETHEREUM ||
        chainId === CHAIN_IDS.POLYGON ||
        chainId === CHAIN_IDS.ARBITRUM
      ) {
        const usdcAddress = getContractAddress(chainId, 'usdc');
        if (!usdcAddress) {
          return balances;
        }
        const usdcContract = ERC20__factory.connect(usdcAddress, provider);

        try {
          const usdcBalance = await usdcContract.balanceOf(address);
          balances.push({
            symbol: 'USDC',
            name: 'USD Coin',
            address: usdcAddress,
            balance: ethers.utils.formatUnits(usdcBalance, CRYPTO_CONSTANTS.USDC_DECIMALS),
            decimals: CRYPTO_CONSTANTS.USDC_DECIMALS,
          });
        } catch {
          // USDC balance lookup is best-effort for some chains.
        }
      }

      return balances;
    } catch (error) {
      throw new NetworkError(
        NetworkErrorCode.RPC_ERROR,
        'Unable to fetch token balances.',
        'Check your network connection and try again.',
        error
      );
    }
  }

  async getErc20Allowance(
    token: string,
    owner: string,
    spender: string,
    chainId: number
  ): Promise<ethers.BigNumber> {
    const provider = new ethers.providers.JsonRpcProvider(getEvmRpcUrl(chainId));
    const erc20Abi = ['function allowance(address owner, address spender) view returns (uint256)'];
    const erc20 = new ethers.Contract(token, erc20Abi, provider);
    return erc20.allowance(owner, spender);
  }
}
