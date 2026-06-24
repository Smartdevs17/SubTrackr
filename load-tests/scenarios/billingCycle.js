import { sleep } from 'k6';
import { simulateContractPayment } from '../contracts/contractLoad.test.js';
import { burstOptions } from '../config/options.js';

export const options = burstOptions;

export default function () {
  // Simulate high volume of automated billing executions
  simulateContractPayment();
  sleep(Math.random() * 0.5); // Fast repetition
}
