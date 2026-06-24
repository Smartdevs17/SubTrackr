import { DomainError } from '../services/shared/errors';
import { SimulationErrorCode } from '../../shared/types/simulation';

export class SimulationError extends DomainError {
  constructor(
    message: string,
    public readonly simulationErrorCode: SimulationErrorCode,
    details?: any
  ) {
    // Map SimulationErrorCode to a generic ErrorCode if needed, here just pass string
    super(simulationErrorCode as any, message, details);
    this.name = 'SimulationError';
  }

  static fromCode(code: SimulationErrorCode, details?: any): SimulationError {
    const messages: Record<SimulationErrorCode, string> = {
      [SimulationErrorCode.INSUFFICIENT_BALANCE]: 'Insufficient balance to complete the transaction.',
      [SimulationErrorCode.AUTH_MISMATCH]: 'Authorization mismatch.',
      [SimulationErrorCode.CONTRACT_ERROR]: 'Contract execution error.',
      [SimulationErrorCode.EXPIRED_ENTRY]: 'Ledger entry is expired.',
      [SimulationErrorCode.INVALID_STATE]: 'Invalid contract state.',
      [SimulationErrorCode.INSUFFICIENT_GAS]: 'Insufficient gas or fee.',
      [SimulationErrorCode.SEQUENCE_ERROR]: 'Invalid sequence number.',
      [SimulationErrorCode.NETWORK_ERROR]: 'Network error while calling RPC.',
      [SimulationErrorCode.UNKNOWN]: 'Unknown simulation error.',
    };
    return new SimulationError(messages[code] || messages[SimulationErrorCode.UNKNOWN], code, details);
  }
}
