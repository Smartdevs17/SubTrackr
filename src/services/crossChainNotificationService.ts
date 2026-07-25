import { ChainType } from '../types/wallet';

export interface UnifiedNotification {
  id: string;
  type: 'payment_success' | 'payment_failed' | 'subscription_created' | 'subscription_cancelled' |
        'chain_switched' | 'cross_chain_transfer' | 'billing_due' | 'price_alert';
  title: string;
  message: string;
  chainType: ChainType;
  chainId: number;
  subscriptionId?: string;
  severity: 'info' | 'warning' | 'error';
  timestamp: Date;
  read: boolean;
}

class CrossChainNotificationService {
  private static instance: CrossChainNotificationService;
  private listeners: ((notification: UnifiedNotification) => void)[] = [];

  static getInstance(): CrossChainNotificationService {
    if (!CrossChainNotificationService.instance) {
      CrossChainNotificationService.instance = new CrossChainNotificationService();
    }
    return CrossChainNotificationService.instance;
  }

  addListener(listener: (notification: UnifiedNotification) => void): void {
    this.listeners.push(listener);
  }

  removeListener(listener: (notification: UnifiedNotification) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  private notify(notification: UnifiedNotification): void {
    this.listeners.forEach((listener) => listener(notification));
  }

  notifyPaymentSuccess(subscriptionId: string, chainType: ChainType, chainId: number, amount: string): void {
    this.notify({
      id: `payment-${Date.now()}`,
      type: 'payment_success',
      title: 'Payment Successful',
      message: `Payment of ${amount} processed on ${chainType} chain ${chainId}`,
      chainType,
      chainId,
      subscriptionId,
      severity: 'info',
      timestamp: new Date(),
      read: false,
    });
  }

  notifyPaymentFailed(subscriptionId: string, chainType: ChainType, chainId: number, reason: string): void {
    this.notify({
      id: `payment-fail-${Date.now()}`,
      type: 'payment_failed',
      title: 'Payment Failed',
      message: `Payment failed on ${chainType} chain ${chainId}: ${reason}`,
      chainType,
      chainId,
      subscriptionId,
      severity: 'error',
      timestamp: new Date(),
      read: false,
    });
  }

  notifyChainSwitched(fromChain: ChainType, toChain: ChainType): void {
    this.notify({
      id: `chain-switch-${Date.now()}`,
      type: 'chain_switched',
      title: 'Chain Switched',
      message: `Switched from ${fromChain} to ${toChain}`,
      chainType: toChain,
      chainId: 0,
      severity: 'info',
      timestamp: new Date(),
      read: false,
    });
  }

  notifyCrossChainTransfer(subscriptionId: string, sourceChain: ChainType, targetChain: ChainType): void {
    this.notify({
      id: `cross-chain-${Date.now()}`,
      type: 'cross_chain_transfer',
      title: 'Cross-Chain Transfer',
      message: `Subscription transfer from ${sourceChain} to ${targetChain} initiated`,
      chainType: targetChain,
      chainId: 0,
      subscriptionId,
      severity: 'info',
      timestamp: new Date(),
      read: false,
    });
  }
}

export const crossChainNotificationService = CrossChainNotificationService.getInstance();
