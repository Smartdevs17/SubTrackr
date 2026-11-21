import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from savings import suggest_savings


def test_suggests_only_accounts_above_cohort_baseline():
    result = suggest_savings(
        [
            {"account_id": "a", "cohort": "pro", "monthly_spend": 100},
            {"account_id": "b", "cohort": "pro", "monthly_spend": 200},
        ]
    )
    assert [item["account_id"] for item in result] == ["b"]
    assert result[0]["cohort_baseline"] == 150
    assert result[0]["estimated_monthly_savings"] == 50
