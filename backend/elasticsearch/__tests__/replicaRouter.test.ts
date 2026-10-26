import {
  ElasticsearchReplicaRouter,
  createElasticsearchReplicaRouter,
} from '../replicaRouter';
import { loadElasticsearchConfig, loadElasticsearchNodes } from '../config';

describe('elasticsearch replica config', () => {
  it('loads primary and replica nodes from env', () => {
    const nodes = loadElasticsearchNodes({
      ES_PRIMARY_URL: 'https://es-primary:9200',
      ES_READ_REPLICA_URLS: 'https://es-r1:9200,https://es-r2:9200',
    });
    expect(nodes).toEqual([
      { name: 'es-primary', url: 'https://es-primary:9200', role: 'primary' },
      { name: 'es-replica-1', url: 'https://es-r1:9200', role: 'replica' },
      { name: 'es-replica-2', url: 'https://es-r2:9200', role: 'replica' },
    ]);
  });

  it('defaults to in-process when no nodes configured', () => {
    const config = loadElasticsearchConfig({});
    expect(config.nodes).toEqual([]);
    expect(config.readWriteSplitting).toBe(true);
    expect(config.automaticFailover).toBe(true);
  });
});

describe('ElasticsearchReplicaRouter', () => {
  it('routes writes to primary and reads to replicas', () => {
    const router = createElasticsearchReplicaRouter({
      ES_PRIMARY_URL: 'https://es-primary:9200',
      ES_READ_REPLICA_URLS: 'https://es-r1:9200,https://es-r2:9200',
    });

    expect(router.route('write').route).toBe('primary');
    expect(router.route('read').route).toBe('replica:es-replica-1');
    expect(router.route('read').route).toBe('replica:es-replica-2');
  });

  it('fails over reads to primary when replicas are down', () => {
    const router = new ElasticsearchReplicaRouter(
      loadElasticsearchConfig({
        ES_PRIMARY_URL: 'https://es-primary:9200',
        ES_READ_REPLICA_URLS: 'https://es-r1:9200',
      }),
    );

    router.markFailed('es-replica-1');
    const result = router.route('read');
    expect(result.route).toBe('failover-primary');
    expect(result.failedOver).toBe(true);
    expect(result.node?.name).toBe('es-primary');
  });

  it('supports connection string / node URL rotation', () => {
    const router = createElasticsearchReplicaRouter({
      ES_PRIMARY_URL: 'https://es-primary:9200',
      ES_READ_REPLICA_URLS: 'https://es-r1:9200',
    });

    const rotated = router.rotateNodes([
      { name: 'es-primary', url: 'https://es-primary-new:9200', role: 'primary' },
      { name: 'es-replica-1', url: 'https://es-r1-new:9200', role: 'replica' },
    ]);

    expect(rotated.getPrimary()?.url).toBe('https://es-primary-new:9200');
    expect(rotated.route('read').node?.url).toBe('https://es-r1-new:9200');
  });
});
