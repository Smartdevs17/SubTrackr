import { ethers } from 'ethers';

import { getEvmRpcUrl } from '../config/evm';
import { CRYPTO_CONSTANTS } from '../utils/constants/values';
import { GasEstimate } from '../types/wallet';
import { ContractError, ContractErrorCode } from '../errors';
import {
  WalletError,
  WalletErrorCode,
  WalletServiceContext,
  errorTracker,
  getGasBufferMultiplier,
  toWalletError,
} from './walletServiceShared';

export class GasService {
  constructor(private readonly context?: WalletServiceContext) {}

  async estimateGas(
    from: string,
    to: string,
    value: string,
    chainId: number,
    userGasLimitOverride?: string
  ): Promise<GasEstimate> {
    let provider: ethers.providers.JsonRpcProvider;
    let gasPrice: ethers.BigNumber;

    try {
      provider =
        this.context?.getProvider?.(chainId) ??
        new ethers.providers.JsonRpcProvider(getEvmRpcUrl(chainId));
      gasPrice = await this.resolveGasPrice(provider);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw toWalletError(
        error,
        WalletErrorCode.GAS_ESTIMATION_FAILED,
        'Could not retrieve gas price.',
        'Check your network connection and try again.'
      );
    }

    let gasLimit: ethers.BigNumber;

    if (userGasLimitOverride) {
      gasLimit = ethers.BigNumber.from(userGasLimitOverride);
    } else {
      try {
        const estimated = await provider.estimateGas({
          from,
          to,
          value: ethers.utils.parseEther(value || '0'),
        });
        gasLimit = estimated.mul(getGasBufferMultiplier(chainId)).div(100);
      } catch (err) {
        console.warn('Gas estimation failed, using safe fallback:', err);
        gasLimit = ethers.BigNumber.from(CRYPTO_CONSTANTS.FALLBACK_GAS_LIMIT);
      }
    }

    const estimatedCost = gasPrice.mul(gasLimit);
    return {
      gasLimit: gasLimit.toString(),
      gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei'),
      estimatedCost: ethers.utils.formatEther(estimatedCost),
    };
  }

  async estimateApproveGas(
    token: string,
    spender: string,
    amount: ethers.BigNumberish,
    chainId: number
  ): Promise<GasEstimate> {
    const provider =
      this.context?.getProvider?.(chainId) ??
      new ethers.providers.JsonRpcProvider(getEvmRpcUrl(chainId));
    const gasPrice = await this.resolveGasPrice(provider);

    const erc20Abi = ['function approve(address spender, uint256 amount) returns (bool)'];
    const conn = this.context?.getConnection?.();
    if (!conn?.eip1193Provider) {
      const err = new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'Wallet is not connected.',
        'Connect your wallet and try again.'
      );
      errorTracker.record(WalletErrorCode.NOT_CONNECTED);
      throw err;
    }
    const web3Provider = new ethers.providers.Web3Provider(conn.eip1193Provider);
    const signer = web3Provider.getSigner();
    const erc20WithSigner = new ethers.Contract(token, erc20Abi, signer);

    let gasLimit: ethers.BigNumber;
    try {
      const estimated = await erc20WithSigner.estimateGas.approve(spender, amount);
      gasLimit = estimated.mul(getGasBufferMultiplier(chainId)).div(100);
    } catch (err) {
      console.warn('Approve gas estimation failed, using fallback:', err);
      gasLimit = ethers.BigNumber.from(CRYPTO_CONSTANTS.FALLBACK_GAS_LIMIT);
    }

    const estimatedCost = gasPrice.mul(gasLimit);
    return {
      gasLimit: gasLimit.toString(),
      gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei'),
      estimatedCost: ethers.utils.formatEther(estimatedCost),
    };
  }

  async approveErc20(token: string, spender: string, amount: ethers.BigNumberish): Promise<string> {
    const signer = this.context?.getWalletSigner?.() ?? this.getWalletSignerFallback();
    const erc20Abi = ['function approve(address spender, uint256 amount) returns (bool)'];
    const erc20 = new ethers.Contract(token, erc20Abi, signer);
    try {
      const tx = await erc20.approve(spender, amount);
      const receipt = await tx.wait();
      if (!receipt?.transactionHash) {
        throw new Error('Approval transaction mined without a hash');
      }
      return receipt.transactionHash;
    } catch (error) {
      if (
        error instanceof Error &&
        /user rejected|user denied|ACTION_REJECTED/.test(error.message)
      ) {
        errorTracker.record(WalletErrorCode.USER_REJECTED);
        throw new WalletError(
          WalletErrorCode.USER_REJECTED,
          'Approval was rejected in your wallet.',
          'Open your wallet and approve the request to continue.'
        );
      }
      throw new ContractError(
        ContractErrorCode.EXECUTION_FAILED,
        'Token approval failed.',
        'Check your wallet connection and try again.',
        error
      );
    }
  }

  private getWalletSignerFallback(): ethers.Signer {
    throw new WalletError(
      WalletErrorCode.NOT_CONNECTED,
      'Wallet is not connected.',
      'Connect your wallet and try again.'
    );
  }

  private async resolveGasPrice(
    provider: ethers.providers.JsonRpcProvider
  ): Promise<ethers.BigNumber> {
    if (typeof provider.getFeeData === 'function') {
      const feeData = await provider.getFeeData();
      return feeData.maxFeePerGas ?? feeData.gasPrice ?? ethers.BigNumber.from(0);
    }

    if (typeof provider.getGasPrice === 'function') {
      return provider.getGasPrice();
    }

    return ethers.BigNumber.from(0);
  }
}
