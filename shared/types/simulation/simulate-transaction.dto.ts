export interface SimulateTransactionDto {
  network: 'testnet' | 'public';
  transactionXdr: string;
  walletType?: 'freighter' | 'xrpl';
}
