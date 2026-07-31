# Formal Verification Results

This document records the latest formal verification status for `contracts/subscription`.

## Properties Under Verification

- Authorization invariants
- Balance and refund safety bounds
- Subscription state transition correctness
- Global invariants (count monotonicity, index uniqueness)

## Latest Run

- Status: `Pending initial baseline run`
- CI Workflow: `.github/workflows/formal-verification.yml`
- Tooling: `certora-cli`

## Notes

- The current spec in `contracts/subscription/certora/SubTrackrSubscription.spec` is scaffolded.
- Replace placeholder rules with concrete storage-model assertions as the harness evolves.
