import { SimulationErrorCode } from './simulation-types';

export interface GasEstimate {
  cpuInsns: number;
  memoryBytes: number;
  estimatedFee: string;
  confidence: number;
}

export interface RequiredAuth {
  address: string;
  role: string;
}

export interface StateDiff {
  contractId: string;
  key: string;
  before: string | null;
  after: string | null;
}

export interface ExpectedResult {
  status: 'success' | 'failure';
  returnValue: string | null;
}

export interface SimulationResponseDto {
  success: boolean;
  gasEstimate?: GasEstimate;
  requiredAuth?: RequiredAuth[];
  stateDiff?: StateDiff[];
  expectedResult?: ExpectedResult;
  predictedErrors?: SimulationErrorCode[];
  simulationTimestamp: string;
}
