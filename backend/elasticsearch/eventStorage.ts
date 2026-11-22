import { StoredEvent } from '../services/notification/eventDrivenWsServer';

export interface ElasticsearchEventRecord {
  index: string;
  id: string;
  body: StoredEvent;
  timestamp: string;
}

export class ElasticsearchEventStorage {
  private indexName = 'subtrackr_events';
  private storedRecords: Map<string, ElasticsearchEventRecord> = new Map();

  async indexEvent(event: StoredEvent): Promise<ElasticsearchEventRecord> {
    const record: ElasticsearchEventRecord = {
      index: this.indexName,
      id: `${event.subscriptionId}_${event.sequenceId}`,
      body: event,
      timestamp: new Date(event.timestamp).toISOString(),
    };
    this.storedRecords.set(record.id, record);
    return record;
  }

  async searchEventsByUserId(userId: string): Promise<StoredEvent[]> {
    const results: StoredEvent[] = [];
    for (const record of this.storedRecords.values()) {
      if (record.body.userId === userId) {
        results.push(record.body);
      }
    }
    return results;
  }
}

export const eventStorage = new ElasticsearchEventStorage();
