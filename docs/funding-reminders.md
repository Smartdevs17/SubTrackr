# Wallet-funding reminders

`ml-service/funding` (#2029) predicts when a wallet will fail to cover an upcoming charge. `mobile/src/screens/funding/FundingReminderScreen.tsx` shows the result.

`build_funding_reminder(balance_minor, currency, charges, now, inflows=...)` replays charges in due order against the balance plus any scheduled top-ups, and returns:

- `level`: `ok`, `warning`, or `urgent` (first shortfall within 2 days or overdue)
- the first uncovered charge, its due date and the shortfall
- `recommended_top_up_minor`: the worst shortfall in the horizon plus a 5% buffer, rounded up
- `remind_at`: 3 days before the shortfall, never in the past
- `runway_days`: how long the balance lasts at the scheduled pace

Amounts are integer minor units. Naive datetimes and non-integer amounts are rejected. `reminder_to_dict` gives the camelCase JSON the screen consumes.

The forecast is deterministic arithmetic over known charges; it uses no trained model. The issue's scope paths are `mobile/src/screens/funding/` and `ml-service/funding/`, matching this layout.

Tests: `ml-service/funding/tests/test_forecast.py`, `mobile/src/screens/funding/__tests__/FundingReminderScreen.test.tsx`.
