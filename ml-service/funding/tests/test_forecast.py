"""Tests for wallet-funding low-balance predictions."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

ML_SERVICE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ML_SERVICE_ROOT not in sys.path:
    sys.path.insert(0, ML_SERVICE_ROOT)

from funding import (  # noqa: E402
    Charge,
    FundingLevel,
    Inflow,
    build_funding_reminder,
    reminder_to_dict,
)

NOW = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)


def charge(sub: str, amount: int, days: float) -> Charge:
    return Charge(sub, amount, NOW + timedelta(days=days))


def remind(balance: int, charges, **kwargs):
    return build_funding_reminder(
        balance_minor=balance, currency="USDC", charges=charges, now=NOW, **kwargs
    )


def test_ok_when_every_charge_is_covered():
    r = remind(1000, [charge("a", 300, 3), charge("b", 400, 10)])
    assert r.level is FundingLevel.OK
    assert r.recommended_top_up_minor == 0
    assert r.remind_at is None
    assert r.covered_subscription_ids == ("a", "b")


def test_ok_with_no_charges():
    r = remind(0, [])
    assert r.level is FundingLevel.OK
    assert r.runway_days is None
    assert r.horizon_charges == 0


def test_exact_balance_covers_the_charge():
    assert remind(500, [charge("a", 500, 5)]).level is FundingLevel.OK


def test_warning_finds_the_first_uncovered_charge_in_due_order():
    # Passed out of order on purpose: b (day 4) is covered, a (day 9) is the first shortfall.
    r = remind(600, [charge("a", 500, 9), charge("b", 400, 4)])
    assert r.level is FundingLevel.WARNING
    assert r.shortfall_subscription_id == "a"
    assert r.shortfall_minor == 300
    assert r.covered_subscription_ids == ("b",)
    assert r.remind_at == NOW + timedelta(days=6)


def test_urgent_when_the_shortfall_is_within_two_days():
    r = remind(100, [charge("a", 500, 1.5)])
    assert r.level is FundingLevel.URGENT
    # Reminder is never in the past.
    assert r.remind_at == NOW


def test_overdue_charge_is_urgent():
    r = remind(0, [charge("a", 500, -1)])
    assert r.level is FundingLevel.URGENT
    assert r.shortfall_minor == 500


def test_top_up_covers_the_worst_shortfall_plus_buffer():
    # 1000 -> pays a(700) -> 300 left; b(800) short 500; c(900) short 600.
    r = remind(1000, [charge("a", 700, 2), charge("b", 800, 5), charge("c", 900, 8)])
    assert r.shortfall_subscription_id == "b"
    assert r.shortfall_minor == 500
    assert r.recommended_top_up_minor == 600 + 30  # 5% of 600


def test_buffer_rounds_up_and_can_be_disabled():
    r = remind(0, [charge("a", 101, 5)], buffer_bps=500)
    assert r.recommended_top_up_minor == 101 + 6  # ceil(5.05)
    r = remind(0, [charge("a", 101, 5)], buffer_bps=0)
    assert r.recommended_top_up_minor == 101


def test_scheduled_inflow_covers_a_later_charge_but_not_an_earlier_one():
    inflow = Inflow(500, NOW + timedelta(days=5))
    early = remind(0, [charge("a", 400, 3)], inflows=[inflow])
    assert early.level is FundingLevel.WARNING
    late = remind(0, [charge("a", 400, 6)], inflows=[inflow])
    assert late.level is FundingLevel.OK


def test_charges_beyond_the_horizon_are_ignored():
    r = remind(100, [charge("far", 5000, 45)], horizon=timedelta(days=30))
    assert r.level is FundingLevel.OK
    assert r.horizon_charges == 0


def test_runway_estimates_days_at_the_scheduled_pace():
    # 600 minor over 10 days -> 60/day; 300 balance lasts 5 days.
    r = remind(300, [charge("a", 300, 5), charge("b", 300, 10)])
    assert r.runway_days == 5


def test_a_failed_charge_does_not_drain_the_wallet_for_cheaper_ones():
    r = remind(300, [charge("big", 900, 2), charge("small", 200, 4)])
    assert r.shortfall_subscription_id == "big"
    assert r.shortfall_minor == 600


@pytest.mark.parametrize(
    "kwargs",
    [
        {"balance_minor": -1},
        {"balance_minor": 1.5},
        {"balance_minor": True},
        {"currency": " "},
        {"horizon": timedelta(0)},
        {"buffer_bps": -1},
        {"buffer_bps": 10_001},
        {"now": datetime(2026, 11, 20)},
    ],
)
def test_invalid_arguments_are_rejected(kwargs):
    base = dict(balance_minor=100, currency="USDC", charges=[], now=NOW)
    base.update(kwargs)
    with pytest.raises(ValueError):
        build_funding_reminder(**base)


@pytest.mark.parametrize(
    "factory",
    [
        lambda: Charge("", 100, NOW),
        lambda: Charge("a", 0, NOW),
        lambda: Charge("a", 1.5, NOW),
        lambda: Charge("a", 100, datetime(2026, 11, 20)),
        lambda: Inflow(0, NOW),
    ],
)
def test_invalid_charges_and_inflows_are_rejected(factory):
    with pytest.raises(ValueError):
        factory()


def test_dict_form_is_json_safe():
    r = remind(100, [charge("a", 500, 1)])
    d = reminder_to_dict(r)
    assert d["level"] == "urgent"
    assert d["shortfallDueAt"] == "2026-11-21T12:00:00Z"
    assert d["remindAt"] == "2026-11-20T12:00:00Z"
    assert d["recommendedTopUpMinor"] == 400 + 20
    ok = reminder_to_dict(remind(1000, [charge("a", 10, 1)]))
    assert ok["remindAt"] is None and ok["shortfallSubscriptionId"] is None
