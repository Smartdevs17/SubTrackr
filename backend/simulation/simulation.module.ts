import { Container } from '../../services/container';
import { simulateTransactionHandler } from './simulation.controller';
import { SimulationService } from './simulation.service';
import { sorobanSimulationClient } from './connectors/soroban-simulation.client';

export function registerSimulationModule(container: Container) {
  container.bind('ISimulationService', () => new SimulationService(sorobanSimulationClient));
}
