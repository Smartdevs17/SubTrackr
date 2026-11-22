"""Low-balance prediction for subscription wallets.

All money is integer minor units (for example cents or stroops). Charges are
replayed in due-date order against the balance plus any expected inflows, so a
top-up scheduled for Friday correctly covers a charge on Saturday but not one
on Thursday.

Levels:
  OK       the wallet covers every charge inside the horizon.
  WARNING  the first uncovered charge is more than ``urgent_within`` away.
  URGENT   the first uncovered charge is within ``urgent_within``, or is
           already overdue.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Iterable, Sequence

DEFAULT_HORIZON = timedelta(days=30)
DEFAULT_URGENT_WITHIN = timedelta(days=2)
DEFAULT_LEAD = timedelta(days=3)
DEFAULT_BUFFER_BPS = 500  # 5% safety margin on the suggested top-up


class FundingLevel(str, Enum):
    OK = "ok"
    WARNING = "warning"
    URGENT = "urgent"


def _aware(value: datetime, name: str) -> datetime:
    if not isinstance(value, datetime):
        raise ValueError(f"{name} must be a datetime")
    if value.tzinfo is None:
        raise ValueError(f"{name} must be timezone-aware")
    return value.astimezone(timezone.utc)


def _minor(value: Any, name: str, *, allow_zero: bool) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer number of minor units")
    if value < 0 or (value == 0 and not allow_zero):
        raise ValueError(f"{name} must be {'non-negative' if allow_zero else 'positive'}")
    return value


@dataclass(frozen=True)
class Charge:
    subscription_id: str
    amount_minor: int
    due_at: datetime

    def __post_init__(self) -> None:
        if not isinstance(self.subscription_id, str) or not self.subscription_id.strip():
            raise ValueError("subscription_id must not be empty")
        _minor(self.amount_minor, "amount_minor", allow_zero=False)
        object.__setattr__(self, "due_at", _aware(self.due_at, "due_at"))


@dataclass(frozen=True)
class Inflow:
    """A top-up the user has already scheduled."""

    amount_minor: int
    arrives_at: datetime

    def __post_init__(self) -> None:
        _minor(self.amount_minor, "amount_minor", allow_zero=False)
        object.__setattr__(self, "arrives_at", _aware(self.arrives_at, "arrives_at"))


@dataclass(frozen=True)
class FundingReminder:
    level: FundingLevel
    balance_minor: int
    currency: str
    #: First charge the wallet cannot cover, if any.
    shortfall_subscription_id: str | None = None
    shortfall_due_at: datetime | None = None
    #: Amount the wallet is short at that charge, before the safety buffer.
    shortfall_minor: int = 0
    #: Suggested top-up: the worst shortfall in the horizon plus the buffer.
    recommended_top_up_minor: int = 0
    #: When to nudge the user. None when nothing is needed.
    remind_at: datetime | None = None
    #: Whole days the balance lasts at the scheduled pace; None when no charges.
    runway_days: int | None = None
    horizon_charges: int = 0
    #: Charges inside the horizon that the wallet can pay, in order.
    covered_subscription_ids: tuple[str, ...] = field(default_factory=tuple)


def build_funding_reminder(
    *,
    balance_minor: int,
    currency: str,
    charges: Iterable[Charge],
    now: datetime,
    inflows: Iterable[Inflow] = (),
    horizon: timedelta = DEFAULT_HORIZON,
    urgent_within: timedelta = DEFAULT_URGENT_WITHIN,
    lead: timedelta = DEFAULT_LEAD,
    buffer_bps: int = DEFAULT_BUFFER_BPS,
) -> FundingReminder:
    _minor(balance_minor, "balance_minor", allow_zero=True)
    if not isinstance(currency, str) or not currency.strip():
        raise ValueError("currency must not be empty")
    if horizon <= timedelta(0) or urgent_within < timedelta(0) or lead < timedelta(0):
        raise ValueError("horizon must be positive; urgent_within and lead must not be negative")
    if isinstance(buffer_bps, bool) or not isinstance(buffer_bps, int) or not 0 <= buffer_bps <= 10_000:
        raise ValueError("buffer_bps must be an integer between 0 and 10000")
    now = _aware(now, "now")
    end = now + horizon

    # Charges already overdue count as due now; later ones stay in order.
    pending: Sequence[Charge] = sorted(
        (c for c in charges if c.due_at <= end), key=lambda c: (c.due_at, c.subscription_id)
    )
    pending_inflows = sorted(inflows, key=lambda i: i.arrives_at)

    balance = balance_minor
    inflow_idx = 0
    first: Charge | None = None
    first_short = 0
    worst_short = 0
    covered: list[str] = []

    for charge in pending:
        while inflow_idx < len(pending_inflows) and pending_inflows[inflow_idx].arrives_at <= charge.due_at:
            balance += pending_inflows[inflow_idx].amount_minor
            inflow_idx += 1
        if balance >= charge.amount_minor:
            balance -= charge.amount_minor
            if first is None:
                covered.append(charge.subscription_id)
            continue
        short = charge.amount_minor - balance
        if first is None:
            first, first_short = charge, short
        worst_short = max(worst_short, short)
        # The failed charge does not drain the wallet; later, cheaper ones may still fit.

    total = sum(c.amount_minor for c in pending)
    runway: int | None = None
    if pending and total > 0:
        span_days = max((pending[-1].due_at - now).total_seconds() / 86400.0, 1.0)
        daily = total / span_days
        runway = int(math.floor(balance_minor / daily)) if daily > 0 else None

    if first is None:
        return FundingReminder(
            level=FundingLevel.OK,
            balance_minor=balance_minor,
            currency=currency,
            runway_days=runway,
            horizon_charges=len(pending),
            covered_subscription_ids=tuple(covered),
        )

    # Round up so the buffer never rounds the suggestion below what is needed.
    top_up = worst_short + -(-worst_short * buffer_bps // 10_000)
    time_left = first.due_at - now
    level = FundingLevel.URGENT if time_left <= urgent_within else FundingLevel.WARNING
    remind_at = max(first.due_at - lead, now)

    return FundingReminder(
        level=level,
        balance_minor=balance_minor,
        currency=currency,
        shortfall_subscription_id=first.subscription_id,
        shortfall_due_at=first.due_at,
        shortfall_minor=first_short,
        recommended_top_up_minor=top_up,
        remind_at=remind_at,
        runway_days=runway,
        horizon_charges=len(pending),
        covered_subscription_ids=tuple(covered),
    )


def reminder_to_dict(reminder: FundingReminder) -> dict[str, Any]:
    """JSON-safe form consumed by the mobile funding screen."""

    def iso(value: datetime | None) -> str | None:
        return value.isoformat().replace("+00:00", "Z") if value else None

    return {
        "level": reminder.level.value,
        "balanceMinor": reminder.balance_minor,
        "currency": reminder.currency,
        "shortfallSubscriptionId": reminder.shortfall_subscription_id,
        "shortfallDueAt": iso(reminder.shortfall_due_at),
        "shortfallMinor": reminder.shortfall_minor,
        "recommendedTopUpMinor": reminder.recommended_top_up_minor,
        "remindAt": iso(reminder.remind_at),
        "runwayDays": reminder.runway_days,
        "horizonCharges": reminder.horizon_charges,
        "coveredSubscriptionIds": list(reminder.covered_subscription_ids),
    }
