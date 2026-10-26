import { EventEmitter } from 'events';

export interface WebSocketClientOptions {
  url: string;
  authToken: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
}

export class SubTrackrWebSocketClient extends EventEmitter {
  private url: string;
  private authToken: string;
  private autoReconnect: boolean;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private lastSequenceId = 0;
  private isConnected = false;

  constructor(options: WebSocketClientOptions) {
    super();
    this.url = options.url;
    this.authToken = options.authToken;
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
  }

  connect() {
    this.isConnected = true;
    this.emit('connected', { timestamp: Date.now() });

    // Request event replay if reconnecting
    if (this.lastSequenceId > 0) {
      this.requestReplay(this.lastSequenceId);
    }
  }

  handleMessage(rawMessage: string) {
    try {
      const data = JSON.parse(rawMessage);
      if (data.sequenceId) {
        this.lastSequenceId = Math.max(this.lastSequenceId, data.sequenceId);
      }
      this.emit('event', data);
    } catch (err) {
      this.emit('error', err);
    }
  }

  requestReplay(lastSeq: number) {
    this.emit('send', JSON.stringify({ type: 'replay', lastSequenceId: lastSeq }));
  }

  disconnect() {
    this.isConnected = false;
    this.emit('disconnected');
    if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const timeout = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      setTimeout(() => this.connect(), timeout);
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }
}
