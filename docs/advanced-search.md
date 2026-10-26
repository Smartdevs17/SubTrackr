# Advanced Search for Subscriptions

SubTrackr ships an **advanced search** capability for subscriptions backed by an
Elasticsearch-style engine. In the mobile-first deployment the "cluster" is an
in-process index (mirroring a real ES setup) so the service layer can be swapped
for a remote Elasticsearch cluster without changing callers.

## Architecture

```
app/screens/AdvancedSearchScreen.tsx   → UI (filters, facets, saved searches)
app/stores/searchStore.ts              → legacy adapter over the search slice
src/store/slices/searchSlice.ts        → search state + actions (slices store)
app/services/searchService.ts          → search façade used by the screen/store
backend/services/search/ElasticsearchService.ts → in-process index + scoring
backend/elasticsearch/config.ts        → cluster config + node loaders
backend/elasticsearch/replicaRouter.ts → read/write routing + failover
backend/elasticsearch/searchService.ts → advanced search, facets, autocomplete
```

### Engine (`backend/services/search/ElasticsearchService.ts`)

- Tokenized full-text index with field boosting
- Fuzzy matching (Levenshtein distance)
- Faceted navigation (category, billing cycle, plan, status, price)
- Saved searches with new-match detection
- Analytics (top queries, zero-result queries)

### Remote nodes (`backend/elasticsearch/config.ts`)

The in-process index is the default. To point at a remote Elasticsearch cluster,
configure the following environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `ES_PRIMARY_URL` | Primary node URL | unset (in-process) |
| `ES_READ_REPLICA_URLS` | Comma-separated replica URLs | unset |
| `ES_READ_WRITE_SPLITTING` | Route reads to replicas | `true` |
| `ES_AUTOMATIC_FAILOVER` | Fail over reads to primary when replicas are down | `true` |

`loadElasticsearchNodes()` builds the node list and
`loadElasticsearchConfig()` merges it over `DEFAULT_ES_CONFIG`.

### Routing (`backend/elasticsearch/replicaRouter.ts`)

- Writes always target the primary node.
- Reads round-robin across healthy replicas.
- When every replica is unhealthy, reads fail over to the primary
  (`failedOver: true`).
- With no remote nodes configured, routing reports `in-process` and callers use
  the embedded index.

## How to run a search

From the app, the search slice performs a paginated, faceted search and keeps
the index in sync with the subscription store:

```ts
useAppStore.getState().setQueryText('netflix');
useAppStore.getState().setFilters({ categories: ['streaming'] });
const result = useAppStore.getState().result; // SearchResult | null
```

The backend façade (`backend/services/subscription/search.ts`) exposes the same
capability on the server side with pagination and suggestions:

```ts
import { searchService } from '../../backend/services/subscription/search';

const page = searchService.search({ query: 'aws', page: 1, pageSize: 20 });
const hints = searchService.getSuggestions({ partial: 'aws' });
```

## HTTP status endpoints

The backend server exposes search-adjacent status/metrics:

- `GET /rate-limits/status?apiKey=...` — per-API-key rate-limit usage
- `GET /rate-limits/status/user?userId=...` — per-user aggregate usage

## Tests

- `backend/elasticsearch/__tests__/config.test.ts` — env-based node/config loading
- `backend/elasticsearch/__tests__/replicaRouter.test.ts` — routing + failover
- `backend/elasticsearch/__tests__/searchAggregator.test.ts` — facets, autocomplete
- `src/store/__tests__/searchSlice.test.ts` — search slice state in `useAppStore`