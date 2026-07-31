import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export type NetworkStatusCallback = (isConnected: boolean) => void;

export class NetworkMonitor {
  private listeners: Set<NetworkStatusCallback> = new Set();
  private isConnected: boolean = true;
  private unsubscribeNetInfo: (() => void) | null = null;

  constructor() {
    this.startMonitoring();
  }

  private startMonitoring() {
    this.unsubscribeNetInfo = NetInfo.addEventListener((state: NetInfoState) => {
      const connected = state.isConnected !== false;
      if (this.isConnected !== connected) {
        this.isConnected = connected;
        this.notifyListeners(connected);
      }
    });

    NetInfo.fetch().then((state: NetInfoState) => {
      this.isConnected = state.isConnected !== false;
    });
  }

  stopMonitoring() {
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = null;
    }
  }

  isOnline(): boolean {
    return this.isConnected;
  }

  setOnline(status: boolean) {
    if (this.isConnected !== status) {
      this.isConnected = status;
      this.notifyListeners(status);
    }
  }

  subscribe(callback: NetworkStatusCallback): () => void {
    this.listeners.add(callback);
    callback(this.isConnected);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(isConnected: boolean) {
    this.listeners.forEach((callback) => {
      try {
        callback(isConnected);
      } catch (err) {
        console.error('Error notifying network status listener:', err);
      }
    });
  }
}

export const networkMonitor = new NetworkMonitor();
