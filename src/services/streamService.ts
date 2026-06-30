import { ethers } from 'ethers';
import { Framework } from '@superfluid-finance/sdk-core';

import { ADDRESS_CONSTANTS } from '../utils/constants/values';
import {
  WalletError,
  WalletErrorCode,
  WalletServiceContext,
  errorTracker,
  isUserRejectedError,
  SECONDS_PER_MONTH,
  superTokenResolverSymbol,
  toWalletError,
  SuperfluidStreamResult,
} from './walletServiceShared';

export class StreamService {
  constructor(private readonly context?: WalletServiceContext) {}

  async estimateSuperfluidCreateFlow(
    tokenSymbol: string,
    amountPerMonth: string,
    recipient: string,
    chainId: number
  ): Promise<{ gasLimit: string; gasPrice: string; estimatedCost: string }> {
    const signer = this.context?.getWalletSigner?.() ?? this.getWalletSignerFallback();
    const network = await signer.provider!.getNetwork();
    if (network.chainId !== chainId) {
      throw new Error(
        `Wallet network (${network.chainId}) does not match selected chain (${chainId}). Switch network in your wallet.`
      );
    }

    const { createOp } = await this.buildSuperfluidCreateFlowContext(
      tokenSymbol,
      amountPerMonth,
      recipient,
      chainId,
      signer
    );

    const populated = await createOp.getPopulatedTransactionRequest(signer, 1.2);
    const gasLimit = populated.gasLimit;
    if (!gasLimit) {
      throw new Error('Could not estimate gas for Superfluid createFlow');
    }

    const gasPrice = await signer.provider!.getGasPrice();
    const estimatedCostWei = gasPrice.mul(gasLimit);

    return {
      gasLimit: gasLimit.toString(),
      gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei'),
      estimatedCost: ethers.utils.formatEther(estimatedCostWei),
    };
  }

  async createSuperfluidStream(
    tokenSymbol: string,
    amountPerMonth: string,
    recipient: string,
    chainId: number
  ): Promise<SuperfluidStreamResult> {
    const signer = this.context?.getWalletSigner?.() ?? this.getWalletSignerFallback();

    try {
      const network = await signer.provider!.getNetwork();
      if (network.chainId !== chainId) {
        throw new Error(
          `Wallet network (${network.chainId}) does not match selected chain (${chainId}). Switch network in your wallet.`
        );
      }

      const { createOp, superTokenAddress, sender, receiver } =
        await this.buildSuperfluidCreateFlowContext(
          tokenSymbol,
          amountPerMonth,
          recipient,
          chainId,
          signer
        );

      const txResponse = await createOp.exec(signer);
      const receipt = await txResponse.wait();

      if (!receipt?.transactionHash) {
        throw new Error('Transaction mined without a hash');
      }

      const streamId = `${superTokenAddress.toLowerCase()}:${sender.toLowerCase()}:${receiver.toLowerCase()}`;

      return {
        txHash: receipt.transactionHash,
        streamId,
      };
    } catch (error) {
      if (isUserRejectedError(error)) {
        errorTracker.record(WalletErrorCode.USER_REJECTED);
        throw new WalletError(
          WalletErrorCode.USER_REJECTED,
          'Transaction was rejected in your wallet.',
          'Open your wallet and approve the transaction to continue.'
        );
      }
      throw toWalletError(
        error,
        WalletErrorCode.STREAM_CREATION_FAILED,
        'Stream creation failed.',
        'Check your token balance and try again.'
      );
    }
  }

  async createSablierStream(
    token: string,
    amount: string,
    startTime: number,
    stopTime: number,
    recipient: string,
    chainId: number
  ): Promise<string> {
    try {
      const signer = this.context?.getWalletSigner?.() ?? this.getWalletSignerFallback();
      const network = await signer.provider!.getNetwork();
      if (network.chainId !== chainId) {
        throw new Error(
          `Wallet network (${network.chainId}) does not match selected chain (${chainId}). Switch network in your wallet.`
        );
      }

      const erc20Abi = [
        'function decimals() view returns (uint8)',
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)',
      ];
      const erc20 = new ethers.Contract(token, erc20Abi, signer);
      const decimals = await erc20.decimals();
      const amountBn = ethers.utils.parseUnits(amount, decimals);

      const SABLIER_V2_LOCKUP_LINEAR = ADDRESS_CONSTANTS.SABLIER_V2_LOCKUP_LINEAR;
      const owner = await signer.getAddress();
      const currentAllowance: ethers.BigNumber = await erc20.allowance(
        owner,
        SABLIER_V2_LOCKUP_LINEAR
      );
      if (currentAllowance.lt(amountBn)) {
        const txApprove = await erc20.approve(SABLIER_V2_LOCKUP_LINEAR, amountBn);
        await txApprove.wait();
      }

      const abi = [
        'function createWithDurations(tuple(address sender, address recipient, uint128 totalAmount, address asset, bool cancelable, bool transferable, tuple(uint40 cliff, uint40 total) durations, address broker) params) external returns (uint256 streamId)',
      ];

      const sablierContract = new ethers.Contract(SABLIER_V2_LOCKUP_LINEAR, abi, signer);
      const sender = await signer.getAddress();
      const totalDuration = Math.floor((stopTime - startTime) / 1000);

      const params = {
        sender,
        recipient,
        totalAmount: amountBn,
        asset: token,
        cancelable: true,
        transferable: true,
        durations: {
          cliff: 0,
          total: totalDuration,
        },
        broker: ADDRESS_CONSTANTS.ZERO_ADDRESS,
      };

      const txCreate = await sablierContract.createWithDurations(params);
      const receipt = await txCreate.wait();

      if (!receipt?.transactionHash) {
        throw new Error('Transaction mined without a hash');
      }

      return receipt.transactionHash;
    } catch (error) {
      if (isUserRejectedError(error)) {
        errorTracker.record(WalletErrorCode.USER_REJECTED);
        throw new WalletError(
          WalletErrorCode.USER_REJECTED,
          'Transaction was rejected in your wallet.',
          'Open your wallet and approve the transaction to continue.'
        );
      }
      throw toWalletError(
        error,
        WalletErrorCode.STREAM_CREATION_FAILED,
        'Stream creation failed.',
        'Check your token balance and allowance, then try again.'
      );
    }
  }

  async buildSuperfluidCreateFlowContext(
    tokenSymbol: string,
    amountPerMonth: string,
    recipient: string,
    chainId: number,
    signer: ethers.Signer
  ) {
    const sf = await Framework.create({
      chainId,
      provider: signer.provider!,
    });

    const resolverSymbol = superTokenResolverSymbol(chainId, tokenSymbol);
    const superToken = await sf.loadSuperToken(resolverSymbol);
    const decimals = await superToken.contract.decimals();

    const amountBn = ethers.utils.parseUnits(amountPerMonth, decimals);
    const flowRate = amountBn.div(SECONDS_PER_MONTH);
    if (flowRate.lte(0)) {
      throw new Error(
        'Monthly amount is too small to stream (flow rate rounds to zero per second). Increase the amount.'
      );
    }

    const sender = await signer.getAddress();
    const receiver = ethers.utils.getAddress(recipient);

    if (sender.toLowerCase() === receiver.toLowerCase()) {
      throw new Error('Recipient must be a different address than your connected wallet.');
    }

    const createOp = sf.cfaV1.createFlow({
      superToken: superToken.address,
      sender,
      receiver,
      flowRate: flowRate.toString(),
    });

    return { createOp, superTokenAddress: superToken.address, sender, receiver, flowRate };
  }

  private getWalletSignerFallback(): ethers.Signer {
    throw new WalletError(
      WalletErrorCode.NOT_CONNECTED,
      'Wallet is not connected.',
      'Connect your wallet and try again.'
    );
  }
}
