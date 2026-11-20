"""Checks that the IAM policy JSON matches artifact_access.WORKLOAD_GRANTS (#2103)."""

import json
import sys
from pathlib import Path

import pytest

ML_SERVICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_SERVICE))

import artifact_access as aa  # noqa: E402

POLICY_DIR = ML_SERVICE / "iam" / "policies"
BUCKET_PLACEHOLDER = "${bucket_arn}"
EXAMPLE_BUCKET_ARN = "arn:aws:s3:::example-ml-artifacts"

POLICY_FILES = {
    "ml-inference": "ml-inference.json",
    "ml-service-api": "ml-service-api.json",
    "ml-model-trainer": "ml-model-trainer.json",
    "ml-feature-pipeline": "ml-feature-pipeline.json",
}

VERB_FOR_ACTION = {"s3:GetObject": aa.READ, "s3:PutObject": aa.WRITE}
FORBIDDEN_ACTIONS = {"s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutBucketPolicy", "iam:*"}


def _load(workload):
    text = (POLICY_DIR / POLICY_FILES[workload]).read_text()
    return json.loads(text.replace(BUCKET_PLACEHOLDER, EXAMPLE_BUCKET_ARN))


def _as_list(value):
    return value if isinstance(value, list) else [value]


def _derived_grants(policy):
    grants = {}
    for stmt in policy["Statement"]:
        if stmt["Effect"] != "Allow":
            continue
        for action in _as_list(stmt["Action"]):
            if action == "s3:ListBucket":
                continue
            verb = VERB_FOR_ACTION[action]  # KeyError on an unexpected action
            for resource in _as_list(stmt["Resource"]):
                prefix = resource.split(f"{EXAMPLE_BUCKET_ARN}/", 1)[1].rstrip("*")
                grants.setdefault(verb, set()).add(prefix)
    return grants


def test_every_workload_has_a_policy_file_and_vice_versa():
    assert set(POLICY_FILES) == set(aa.WORKLOAD_GRANTS)
    for filename in POLICY_FILES.values():
        assert (POLICY_DIR / filename).is_file()


@pytest.mark.parametrize("workload", sorted(POLICY_FILES))
def test_policy_grants_match_code_grants(workload):
    derived = _derived_grants(_load(workload))
    expected = {verb: set(prefixes) for verb, prefixes in aa.WORKLOAD_GRANTS[workload].items()}
    assert derived == expected


@pytest.mark.parametrize("workload", sorted(POLICY_FILES))
def test_no_wildcards_or_destructive_actions(workload):
    for stmt in _load(workload)["Statement"]:
        for action in _as_list(stmt["Action"]):
            assert "*" not in action.replace("s3:ListBucket", "")
            assert action not in FORBIDDEN_ACTIONS
        for resource in _as_list(stmt["Resource"]):
            assert resource != "*"


@pytest.mark.parametrize("workload", sorted(POLICY_FILES))
def test_list_bucket_is_prefix_scoped(workload):
    for stmt in _load(workload)["Statement"]:
        if "s3:ListBucket" not in _as_list(stmt["Action"]):
            continue
        prefixes = stmt["Condition"]["StringLike"]["s3:prefix"]
        assert prefixes
        assert all(p and p != "*" and not p.startswith("*") for p in prefixes)
