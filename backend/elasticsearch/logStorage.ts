import AsyncStorage from '@react-native-async-storage/async-storage';
import { LogLevel } from '../services/shared/logging';
import { checkLogAlerts } from '../alerting/logAlerts';

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  correlationId?: string;
  [key: string]: any;
}

export interface LogSearchQuery {
  level?: LogLevel;
  correlationId?: string;
  searchTerm?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

const LOG_STORAGE_KEY = '@subtrackr/elasticsearch_logs';
const MAX_LOGS = 10000;

export class LogStorage {
  private logs: LogEntry[] = [];
  private initialized = false;

  async init() {
    if (this.initialized) return;
    try {
      const storedLogs = await AsyncStorage.getItem(LOG_STORAGE_KEY);
      if (storedLogs) {
        this.logs = JSON.parse(storedLogs);
      }
    } catch (e) {
      console.error('Failed to load logs from storage', e);
    }
    this.initialized = true;
  }

  private async persist() {
    try {
      await AsyncStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(this.logs));
    } catch (e) {
      console.error('Failed to persist logs', e);
    }
  }

  async insertLog(entry: LogEntry) {
    if (!this.initialized) await this.init();

    this.logs.unshift(entry); // Add to beginning
    
    // Check for alerts
    await checkLogAlerts(entry, this);

    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(0, MAX_LOGS);
    }
    
    // Debounce or periodic persist in a real app, here we do it immediately
    void this.persist();
  }

  async searchLogs(query: LogSearchQuery): Promise<{ data: LogEntry[]; total: number }> {
    if (!this.initialized) await this.init();

    let filtered = this.logs;

    if (query.level) {
      filtered = filtered.filter(l => l.level === query.level);
    }
    
    if (query.correlationId) {
      filtered = filtered.filter(l => l.correlationId === query.correlationId);
    }
    
    if (query.startDate) {
      filtered = filtered.filter(l => new Date(l.timestamp) >= query.startDate!);
    }
    
    if (query.endDate) {
      filtered = filtered.filter(l => new Date(l.timestamp) <= query.endDate!);
    }
    
    if (query.searchTerm) {
      const term = query.searchTerm.toLowerCase();
      filtered = filtered.filter(l => 
        l.message.toLowerCase().includes(term) || 
        JSON.stringify(l).toLowerCase().includes(term)
      );
    }

    const total = filtered.length;
    const offset = query.offset || 0;
    const limit = query.limit || 50;

    return {
      data: filtered.slice(offset, offset + limit),
      total
    };
  }

  async cleanupOldLogs(daysToKeep: number = 30) {
    if (!this.initialized) await this.init();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    this.logs = this.logs.filter(l => new Date(l.timestamp) >= cutoffDate);
    await this.persist();
  }
}

export const logStorage = new LogStorage();
