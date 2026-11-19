"""
ml-service/artifact_access.py

Least-privilege artifact access for ml-service workloads (#2103).

Each workload runs under its own Kubernetes ServiceAccount and IAM role
(ml-service/iam/ and ml-service/kubernetes/serviceaccounts.yaml). WORKLOAD_GRANTS
mirrors those IAM policies: which key prefixes in the artifact bucket each
workload may read or write. IAM is the enforcement point. require() is a
defence-in-depth guard so code cannot ask for an artifact outside its grant.
tests/test_iam_policies.py fails if the policy JSON and this map drift apart.
"""

import os
from typing import Dict, Tuple

WORKLOAD_ENV = "ML_ARTIFACT_WORKLOAD"

READ = "read"
WRITE = "write"

WORKLOAD_GRANTS: Dict[str, Dict[str, Tuple[str, ...]]] = {
    "ml-inference": {
        READ: ("models/onnx/",),
    },
    "ml-service-api": {
        READ: ("models/registry/",),
    },
    "ml-model-trainer": {
        READ: ("models/registry/", "models/onnx/"),
        WRITE: ("models/registry/", "models/onnx/"),
    },
    "ml-feature-pipeline": {
        WRITE: ("features/daily/",),
    },
}


def is_allowed(workload: str, action: str, key: str) -> bool:
    """True when `workload` may perform `action` (READ or WRITE) on object `key`."""
    if not key or key.startswith("/") or ".." in key.split("/"):
        return False
    prefixes = WORKLOAD_GRANTS.get(workload, {}).get(action, ())
    return any(key.startswith(prefix) for prefix in prefixes)


def require(workload: str, action: str, key: str) -> None:
    """Raise PermissionError unless `workload` may perform `action` on `key`."""
    if not is_allowed(workload, action, key):
        raise PermissionError(f"{workload!r} may not {action} {key!r}")


def current_workload() -> str:
    """Workload name this process runs as, from ML_ARTIFACT_WORKLOAD (set in the Deployment)."""
    workload = os.environ.get(WORKLOAD_ENV, "")
    if workload not in WORKLOAD_GRANTS:
        raise RuntimeError(f"{WORKLOAD_ENV} must name a known workload, got {workload!r}")
    return workload
