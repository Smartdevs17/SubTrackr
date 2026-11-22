"""Cohort-baseline savings suggestions used by the ML service."""

from statistics import mean
from typing import Any, Dict, List


def suggest_savings(accounts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return deterministic suggestions for accounts above their cohort baseline."""
    if not accounts:
        return []

    by_cohort: Dict[str, List[float]] = {}
    for account in accounts:
        cohort = str(account.get("cohort", "default"))
        by_cohort.setdefault(cohort, []).append(float(account.get("monthly_spend", 0)))

    suggestions: List[Dict[str, Any]] = []
    for account in accounts:
        spend = float(account.get("monthly_spend", 0))
        baseline = mean(by_cohort[str(account.get("cohort", "default"))])
        if spend <= baseline * 1.1:
            continue
        suggestions.append(
            {
                "account_id": str(account.get("account_id", "")),
                "cohort": str(account.get("cohort", "default")),
                "monthly_spend": round(spend, 2),
                "cohort_baseline": round(baseline, 2),
                "estimated_monthly_savings": round(max(0, spend - baseline), 2),
                "reason": "Monthly spend is above the cohort baseline.",
            }
        )
    return suggestions


__all__ = ["suggest_savings"]
