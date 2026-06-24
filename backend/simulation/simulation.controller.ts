import { SimulateTransactionDto } from '../../shared/types/simulation/simulate-transaction.dto';
import { SimulationResponseDto } from '../../shared/types/simulation/simulation-response.dto';
import { container } from '../services/container';
import { SimulationService } from './simulation.service';

export async function simulateTransactionHandler(req: any, res: any): Promise<void> {
  try {
    const dto: SimulateTransactionDto = req.body;

    // Quick validation
    if (!dto || !dto.network || !dto.transactionXdr) {
      res.status(400).json({ error: 'Missing required fields: network, transactionXdr' });
      return;
    }

    const service = container.resolve<SimulationService>('ISimulationService');
    const response: SimulationResponseDto = await service.simulateTransaction(dto);

    res.status(200).json(response);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
