"""Wallet-funding reminders with low-balance predictions (#2029).

Pure, dependency-free forecasting: given a wallet balance and the charges due
in the coming days, find the first charge the wallet cannot cover and say how
much to top up and by when.
"""

from .forecast import (
    Charge,
    FundingLevel,
    FundingReminder,
    Inflow,
    build_funding_reminder,
    reminder_to_dict,
)

__all__ = [
    "Charge",
    "FundingLevel",
    "FundingReminder",
    "Inflow",
    "build_funding_reminder",
    "reminder_to_dict",
]
