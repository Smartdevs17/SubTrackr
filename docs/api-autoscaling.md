# API horizontal autoscaling

**Issue:** #1289 — Implement horizontal autoscaling for API

| File                                            | Contents                                     |
| ------------------------------------------------ | -------------------------------------------- |
| `infra/kubernetes/api-deployment.yaml`           | API Deployment + Service                     |
| `infra/kubernetes/api-autoscaling.yaml`          | HorizontalPodAutoscaler + PodDisruptionBudget |

```bash
npm run infra:autoscaling:check     # validate the manifests (no cluster needed)
kubectl apply -f infra/kubernetes/api-deployment.yaml
kubectl apply -f infra/kubernetes/api-autoscaling.yaml
```

## Scaling policy

```yaml
minReplicas: 2
maxReplicas: 8
metrics:
  - cpu:    70% of request
  - memory: 80% of request
```

Both are **utilization** metrics, i.e. percentages of `resources.requests`, not
absolute values. That makes the thresholds portable across node types, but it
also means **the requests block is load-bearing**: an HPA with a Resource metric
and no matching request silently pins at `minReplicas`, which is why the
validator treats it as an error rather than a warning.

- **CPU 70%** is the primary signal. Subscription renewals and webhook
  deliveries are bursty and CPU-bound, so CPU leads the reaction.
- **Memory 80%** catches leaks and slow growth that CPU alone hides.
- **Floor of 2** keeps the API reachable when a single node is lost, while the
  HPA is still waiting on its metrics window.

### Why 8

Steady state sits near 2-3 replicas and bursts are short, so 8 is roughly a 3x
headroom over steady state. A higher ceiling mostly buys slower rollouts and
more pods contending for the same Postgres connection pool; a lower one turns a
burst into shed webhooks. Revisit with `kubectl describe hpa subtrackr-api` —
the `Scaling Active`, `Scaling Limit` and `Current Metrics` lines show which
bound is actually biting.

## Asymmetric scaling behaviour

Traffic spikes hard and recedes slowly, so scale-up and scale-down get different
policies:

```yaml
scaleUp:   stabilizationWindowSeconds: 30    # react within one metrics window
scaleDown: stabilizationWindowSeconds: 300   # be slow to give capacity back
```

A fast `scaleDown` is the classic self-inflicted outage: pods are removed, then
traffic returns, and the fleet pays a cold start plus a cold cache while the
Service is already shedding load. Five minutes of extra headroom is cheaper than
that. The `scaleDown` policy is also capped at 25% per minute, so the fleet
decommissions gradually.

## Scale-down safety

Scaling down is the dangerous direction, because a terminated pod holds
in-flight webhook deliveries. Three settings address it:

- `terminationGracePeriodSeconds: 45` — long enough to finish in-flight
  subscription renewals.
- `preStop: sleep 10` — readiness is withdrawn *before* `SIGTERM`, so endpoint
  removal propagates cluster-wide while the pod still answers. The validator
  warns if either is missing.
- `topologySpreadConstraints` + pod anti-affinity — replicas land on separate
  nodes, so adding a replica adds real capacity instead of co-scheduling on a
  node that is already saturated.

`maxUnavailable: 0` / `maxSurge: 1` on the rollout strategy means a deploy never
reduces available capacity, and the PodDisruptionBudget's `maxUnavailable: 1`
stops a node drain or cluster upgrade from evicting the last pods. Without the
PDB, a drain during a rollout can take the whole API offline.

> Before applying, retag `image` in `api-deployment.yaml` to your registry. The
> checked-in `subtrackr/api:latest` is only a default; the app image is built
> from `docker/backend.Dockerfile`.

## Validating the manifests

`kubectl apply` accepts an HPA that can never scale. `scripts/validate-autoscaling.js`
checks the invariants that only fail at runtime, with no dependencies and no
cluster:

```bash
node scripts/validate-autoscaling.js
node scripts/validate-autoscaling.js --json     # for CI consumption
```

It errors on:

- an HPA that is not `autoscaling/v2`, or targets something other than an
  `apps/v1` Deployment
- a `scaleTargetRef` naming a Deployment that is not in the manifest set, or a
  namespace mismatch between the two
- `minReplicas` / `maxReplicas` that are not usable integers, or a ceiling that
  leaves no burst headroom
- a Resource metric with no matching `resources.requests` entry, a
  non-`Utilization` target, or a percentage outside 1-100
- a missing or empty `scaleUp` / `scaleDown` behaviour block
- a Service that selects nothing, or targets a port the container never declares
- a missing PodDisruptionBudget, or one that selects labels the pods lack

and warns on a flappy `scaleDown` window, replicas exceeding the HPA floor, a
missing `terminationGracePeriodSeconds`, and a missing `preStop` hook.

## After deploying

```bash
kubectl describe hpa subtrackr-api     # Scaling Active / Current Metrics
kubectl get events --sort-by=.lastTimestamp
```

`Scaling Active: False` with a `FailedGetResourceMetric` event means the
metrics server is not installed — the HPA cannot function without
`metrics-server` in the cluster.
