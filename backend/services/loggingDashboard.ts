import { LogEntry, queryLogs } from './logging';

export interface LogQueryFilter {
  level?: 'debug' | 'info' | 'warn' | 'error';
  module?: string;
  correlationId?: string;
  text?: string;
  from?: string;
  to?: string;
}

export interface LogDashboardPage {
  total: number;
  entries: LogEntry[];
}

export function getLogDashboard(filter: LogQueryFilter = {}, pageSize = 50): LogDashboardPage {
  const entries = queryLogs(filter);
  const sortedEntries = entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    total: sortedEntries.length,
    entries: sortedEntries.slice(0, pageSize),
  };
}
