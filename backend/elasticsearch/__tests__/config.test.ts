import {
  loadElasticsearchConfig,
  loadElasticsearchNodes,
  DEFAULT_ES_CONFIG,
  ElasticsearchNode,
} from '../config';

describe('elasticsearch config loaders', () => {
  it('loads primary and replica nodes from env', () => {
    const nodes = loadElasticsearchNodes({
      ES_PRIMARY_URL: 'https://es-primary:9200',
      ES_READ_REPLICA_URLS: 'https://es-r1:9200,https://es-r2:9200',
    } as NodeJS.ProcessEnv);

    expect(nodes).toEqual([
      { name: 'es-primary', url: 'https://es-primary:9200', role: 'primary' },
      { name: 'es-replica-1', url: 'https://es-r1:9200', role: 'replica' },
      { name: 'es-replica-2', url: 'https://es-r2:9200', role: 'replica' },
    ]);
  });

  it('returns no nodes when remote config is absent (in-process mode)', () => {
    const nodes = loadElasticsearchNodes({} as NodeJS.ProcessEnv);
    expect(nodes).toEqual([]);
  });

  it('skips blank replica entries', () => {
    const nodes = loadElasticsearchNodes({
      ES_READ_REPLICA_URLS: 'https://es-r1:9200, ,,https://es-r2:9200',
    } as NodeJS.ProcessEnv);

    expect(nodes.filter((n) => n.role === 'replica')).toHaveLength(2);
  });

  it('builds a config merged over the in-process defaults', () => {
    const config = loadElasticsearchConfig({
      ES_PRIMARY_URL: 'https://es-primary:9200',
      ES_READ_REPLICA_URLS: 'https://es-r1:9200',
    } as NodeJS.ProcessEnv);

    expect(config.nodes).toHaveLength(2);
    expect(config.readWriteSplitting).toBe(true);
    expect(config.automaticFailover).toBe(true);
    expect(config.maxSuggestions).toBe(DEFAULT_ES_CONFIG.maxSuggestions);
    expect(config.indexName).toBe(DEFAULT_ES_CONFIG.indexName);
  });

  it('defaults to in-process routing when no nodes are configured', () => {
    const config = loadElasticsearchConfig({} as NodeJS.ProcessEnv);
    expect(config.nodes).toEqual([]);
    expect(config.readWriteSplitting).toBe(true);
    expect(config.automaticFailover).toBe(true);
  });

  it('honours routing toggles from env', () => {
    const config = loadElasticsearchConfig({
      ES_READ_WRITE_SPLITTING: 'false',
      ES_AUTOMATIC_FAILOVER: 'false',
    } as NodeJS.ProcessEnv);

    expect(config.readWriteSplitting).toBe(false);
    expect(config.automaticFailover).toBe(false);
  });

  it('includes a suggestions cap in the default config', () => {
    expect(typeof DEFAULT_ES_CONFIG.maxSuggestions).toBe('number');
    expect(DEFAULT_ES_CONFIG.maxSuggestions).toBeGreaterThan(0);
  });

  it('exports typed nodes with the expected shape', () => {
    const node: ElasticsearchNode = { name: 'es-primary', url: 'http://localhost:9200', role: 'primary' };
    expect(node.role).toBe('primary');
  });
});