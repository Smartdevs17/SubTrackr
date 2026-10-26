import { rpc, TransactionBuilder } from '@stellar/stellar-sdk';

import { getDefaultStellarNetwork } from '../config/evm';
import { logger } from './logging';
import { WalletError, WalletErrorCode } from './walletService';

export const STROOPS_PER_XLM = 10_000_000;

export interface StellarSimulationOptions {
  sorobanRpcUrl: string;
  networkPassphrase: string;
  allowHttp: boolean;
  timeoutMs: number;
}

export interface StellarSimulationFees {
  inclusionFeeStroops: number;
  resourceFeeStroops: number;
  totalFeeStroops: number;
  inclusionFeeXlm: string;
  resourceFeeXlm: string;
  totalFeeXlm: string;
}

export interface StellarSimulationStorage {
  readBytes: number;
  writeBytes: number;
  diskBytes: number;
  memoryBytes: number;
  instructions: number;
  readOnlyEntries: number;
  readWriteEntries: number;
}

export interface StellarSimulationResult {
  success: boolean;
  error?: string;
  fees: StellarSimulationFees;
  storage: StellarSimulationStorage;
}

export interface ParsedStellarTransaction {
  source: string;
  network: string;
  networkPassphrase: string;
  feeStroops: number;
  operations: string;
}

export function stroopsToXlm(stroops: number): string {
  return (stroops / STROOPS_PER_XLM).toFixed(7);
}

function zeroFees(): StellarSimulationFees {
  return {
    inclusionFeeStroops: 0,
    resourceFeeStroops: 0,
    totalFeeStroops: 0,
    inclusionFeeXlm: '0.0000000',
    resourceFeeXlm: '0.0000000',
    totalFeeXlm: '0.0000000',
  };
}

function zeroStorage(): StellarSimulationStorage {
  return {
    readBytes: 0,
    writeBytes: 0,
    diskBytes: 0,
    memoryBytes: 0,
    instructions: 0,
    readOnlyEntries: 0,
    readWriteEntries: 0,
  };
}

export function parseStellarTransaction(xdr: string): ParsedStellarTransaction {
  const network = getDefaultStellarNetwork();
  try {
    const transaction = TransactionBuilder.fromXDR(xdr, network.networkPassphrase);
    return {
      source: transaction.source,
      network: network.name,
      networkPassphrase: network.networkPassphrase,
      feeStroops: transaction.fee,
      operations: transaction.operations.map((operation) => operation.type).join(', '),
    };
  } catch (error) {
    throw new WalletError(
      WalletErrorCode.INVALID_PARAMS,
      'Unable to parse Stellar transaction envelope.',
      'Recheck the supplied XDR value.',
      error
    );
  }
}

export function normalizeStellarSimulation(
  simulation: rpc.Api.SimulateTransactionResponse,
  declaredFeeStroops: number
): StellarSimulationResult {
  const errorPayload = simulation as { error?: string };
  if (errorPayload.error) {
    return {
      success: false,
      error: errorPayload.error,
      fees: zeroFees(),
      storage: zeroStorage(),
    };
  }

  const successPayload = simulation as {
    minResourceFee?: number | string;
    transactionData?: {
      resources?: () => {
        footprint?: () => { readOnly?: unknown[]; readWrite?: unknown[] };
        readBytes?: number;
        writeBytes?: number;
        instructions?: number;
      };
    };
    cost?: { cpuInsns?: number; memBytes?: number };
  };

  const resources = successPayload.transactionData?.resources?.();
  const footprint = resources?.footprint?.();
  const readBytes = resources?.readBytes ?? 0;
  const writeBytes = resources?.writeBytes ?? 0;
  const resourceInstructions = resources?.instructions ?? 0;
  const memoryBytes = successPayload.cost?.memBytes ?? 0;
  const instructions = successPayload.cost?.cpuInsns ?? resourceInstructions;

  const inclusionFeeStroops = declaredFeeStroops;
  const resourceFeeStroops = Number(successPayload.minResourceFee ?? 0);
  const totalFeeStroops = inclusionFeeStroops + resourceFeeStroops;

  return {
    success: true,
    fees: {
      inclusionFeeStroops,
      resourceFeeStroops,
      totalFeeStroops,
      inclusionFeeXlm: stroopsToXlm(inclusionFeeStroops),
      resourceFeeXlm: stroopsToXlm(resourceFeeStroops),
      totalFeeXlm: stroopsToXlm(totalFeeStroops),
    },
    storage: {
      readBytes,
      writeBytes,
      diskBytes: readBytes + writeBytes,
      memoryBytes,
      instructions,
      readOnlyEntries: footprint?.readOnly?.length ?? 0,
      readWriteEntries: footprint?.readWrite?.length ?? 0,
    },
  };
}

export async function simulateStellarTransaction(
  xdr: string,
  options: Partial<StellarSimulationOptions> = {}
): Promise<StellarSimulationResult> {
  const network = getDefaultStellarNetwork();
  const sorobanRpcUrl = options.sorobanRpcUrl ?? network.sorobanRpcUrl;
  const networkPassphrase = options.networkPassphrase ?? network.networkPassphrase;
  const allowHttp = options.allowHttp ?? false;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const server = new rpc.Server(sorobanRpcUrl, { allowHttp, timeout: timeoutMs });

  let transaction: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    transaction = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch (error) {
    throw new WalletError(
      WalletErrorCode.INVALID_PARAMS,
      'Unable to parse Stellar transaction envelope.',
      'Recheck the supplied XDR value.',
      error
    );
  }

  try {
    const simulation = await server.simulateTransaction(transaction);
    const result = normalizeStellarSimulation(simulation, transaction.fee);
    if (result.success) {
      logger.info('Stellar transaction simulation succeeded.', {
        totalFeeStroops: result.fees.totalFeeStroops,
        totalFeeXlm: result.fees.totalFeeXlm,
        instructions: result.storage.instructions,
      });
    }
    return result;
  } catch (error) {
    throw new WalletError(
      WalletErrorCode.GAS_ESTIMATION_FAILED,
      'Stellar transaction simulation failed.',
      'Retry the simulated payment or check the network status.',
      error
    );
  }
}
