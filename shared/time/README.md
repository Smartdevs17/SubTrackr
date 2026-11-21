# Shared time-zone utilities

Shared time-zone helpers for client and backend code. Use the package entrypoint
for wall-clock calculations so offsets, DST transitions, day keys, and invalid
IANA zone fallback behavior stay consistent.

Import helpers from `shared/time` using a relative path appropriate to the
caller. For example, `src/services` imports from `../../shared/time`.

All zone-aware helpers fall back to UTC for unknown zones. Conversion functions
require valid `Date` instances and local-hour conversion requires an integer
from 0 through 23.
