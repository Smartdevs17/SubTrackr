# Family plans with a shared paying wallet

A subscription's subscriber is the paying wallet. Renewals are charged to it as usual. The payer can attach a family group so other addresses share the entitlement without paying.

Rules, enforced both on chain (`contracts/subscription/src/family.rs`) and off chain (`backend/src/services/family.ts`), for #2031:

- Only the paying wallet creates the group and adds or removes members.
- Seats include the payer. Minimum 2, maximum 10.
- A member can leave at any time. The payer cannot leave its own group.
- The group needs a live (Active or Paused) subscription, and cancelling the subscription dissolves it.

Contract entry points: `create_family_group`, `add_family_member`, `remove_family_member`, `leave_family_group`, `get_family_group`, `has_family_access`. Events: `family_created`, `family_member_added`, `family_member_removed`.

The backend adds an invitation step: a wallet joins only by accepting an invitation addressed to it. Pending invitations hold a seat and expire after 7 days by default. Writes use optimistic versioning, so the store must implement the conditional `save`.

The issue named `contracts/src/family.rs`. That directory is not part of the Cargo workspace, so the module lives in the subscription crate.

Tests: `contracts/subscription/tests/family_plan.rs`, `backend/src/services/__tests__/family.test.ts`.
