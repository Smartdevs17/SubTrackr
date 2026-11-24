"""Usage floor signal used by the smart renewal pause (issue #2251).

The ML service owns the statistical summary; the backend renewal worker owns
the decision to actually pause a charge. This module is deliberately pure and
standard-library-only: it consumes a list of usage observations and returns an
immutable signal. No I/O, no network, no global state.

Failure modes use :class:`UsageFloorError` with a stable ``code`` so callers can
distinguish bad configuration from bad samples without parsing messages.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Mapping, Optional


class UsageFloorError(ValueError):
    """Validation error with a stable machine-readable code."""

    def __init__(self, code: str, message: str, details: Optional[Mapping[str, object]] = None):
        super().__init__(message)
        self.code = code
        self.details = dict(details) if details else {}

    @classmethod
    def invalid_config(cls, message: str, **details: object) -> "UsageFloorError":
        return cls("INVALID_CONFIG", message, details)

    @classmethod
    def invalid_sample(cls, message: str, **details: object) -> "UsageFloorError":
        return cls("INVALID_SAMPLE", message, details)


@dataclass(frozen=True)
class UsageFloorConfig:
    """Configuration for the trailing usage window."""

    usage_floor: float = 1.0
    window_days: int = 30
    min_samples: int = 7
    timezone_offset_minutes: int = 0


DEFAULT_USAGE_FLOOR_CONFIG: UsageFloorConfig = UsageFloorConfig()


def validate_usage_floor_config(config: Optional[Mapping[str, object]] = None) -> UsageFloorConfig:
    """Merge ``config`` over defaults and validate every field."""
    if config is None:
        config = {}
    if not isinstance(config, Mapping):
        raise UsageFloorError.invalid_config("config must be a mapping")

    values = {
        field: config.get(field, getattr(DEFAULT_USAGE_FLOOR_CONFIG, field))
        for field in (
            "usage_floor",
            "window_days",
            "min_samples",
            "timezone_offset_minutes",
        )
    }

    floor = values["usage_floor"]
    if isinstance(floor, bool) or not isinstance(floor, (int, float)) or floor < 0:
        raise UsageFloorError.invalid_config("usage_floor must be a non-negative number", usage_floor=floor)

    window = values["window_days"]
    if isinstance(window, bool) or not isinstance(window, int) or not 1 <= window <= 365:
        raise UsageFloorError.invalid_config("window_days must be an integer 1-365", window_days=window)

    minimum = values["min_samples"]
    if isinstance(minimum, bool) or not isinstance(minimum, int) or not 1 <= minimum <= window:
        raise UsageFloorError.invalid_config(
            "min_samples must be an integer between 1 and window_days", min_samples=minimum
        )

    offset = values["timezone_offset_minutes"]
    if isinstance(offset, bool) or not isinstance(offset, int) or abs(offset) > 1440:
        raise UsageFloorError.invalid_config(
            "timezone_offset_minutes must be within +/-1440", timezone_offset_minutes=offset
        )

    return UsageFloorConfig(
        usage_floor=float(floor),
        window_days=window,
        min_samples=minimum,
        timezone_offset_minutes=offset,
    )


@dataclass(frozen=True)
class UsageSignal:
    """Immutable summary of usage in the trailing window."""

    sample_count: int
    average: float
    total: float
    floor: float
    below_floor: bool
    window_start: str
    window_end: str


def _parse_instant(value: object) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise UsageFloorError.invalid_sample("timestamp must be a non-empty string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise UsageFloorError("INVALID_DATE", "timestamp is not a valid ISO-8601 instant", {"value": value}) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def build_usage_signal(
    samples: Iterable[Mapping[str, object]],
    config: Optional[Mapping[str, object]] = None,
    now: Optional[datetime] = None,
) -> UsageSignal:
    """Summarise samples in the trailing window.

    Samples outside the window are ignored; malformed samples raise
    :class:`UsageFloorError`. An empty window yields ``average = 0`` and
    ``below_floor = False`` (fail-open: never pause without evidence).
    """
    cfg = validate_usage_floor_config(config)
    if isinstance(samples, (str, bytes)) or not isinstance(samples, Iterable):
        raise UsageFloorError.invalid_sample("samples must be an iterable of mappings")

    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    shift = timedelta(minutes=cfg.timezone_offset_minutes)
    end = reference + shift
    start = end - timedelta(days=cfg.window_days)

    total = 0.0
    count = 0
    for sample in samples:
        if not isinstance(sample, Mapping):
            raise UsageFloorError.invalid_sample("sample must be a mapping")
        units = sample.get("units")
        if isinstance(units, bool) or not isinstance(units, (int, float)) or units < 0:
            raise UsageFloorError.invalid_sample("units must be a non-negative number", units=units)
        observed_at = _parse_instant(sample.get("at"))
        if observed_at < start or observed_at > end:
            continue
        total += float(units)
        count += 1

    average = total / count if count else 0.0
    return UsageSignal(
        sample_count=count,
        average=average,
        total=total,
        floor=cfg.usage_floor,
        below_floor=count > 0 and average < cfg.usage_floor,
        window_start=start.isoformat().replace("+00:00", "Z"),
        window_end=end.isoformat().replace("+00:00", "Z"),
    )


def below_floor(signal: UsageSignal, config: Optional[Mapping[str, object]] = None) -> bool:
    """Return True only with enough evidence to justify a renewal pause."""
    cfg = validate_usage_floor_config(config)
    return signal.sample_count >= cfg.min_samples and signal.below_floor
