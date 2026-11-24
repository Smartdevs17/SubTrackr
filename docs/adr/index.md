# Architecture Decision Records (ADR) Index

This directory contains Architecture Decision Records (ADRs) for the SubTrackr project. Each ADR documents a significant architectural decision, its context, considered options, and the chosen outcome.

## ADR List

| # | Title | Status | Date | Authors | Related |
|---|-------|--------|------|---------|---------|
| 0001 | [Example: Adopt TypeScript Strict Mode](0001-typescript-strict-mode.md) | Accepted | 2024-01-15 | @author1 | — |
| 0002 | [Example: Migrate to pnpm Workspaces](0002-pnpm-workspaces.md) | Accepted | 2024-02-20 | @author2 | 0001 |
| 0003 | [Example: Event-Driven Architecture for Notifications](0003-event-driven-notifications.md) | Proposed | 2024-03-10 | @author3 | — |

> **Note:** Replace the example entries above with actual ADRs as they are created. The first real ADR should be numbered `0001`.

## Status Definitions

| Status | Meaning |
|--------|---------|
| **Proposed** | Under discussion, not yet approved |
| **Accepted** | Approved and being implemented / implemented |
| **Superseded** | Replaced by a newer ADR (link in Related column) |
| **Deprecated** | No longer relevant, but not replaced |

## Creating a New ADR

1. **Copy the template**: `cp docs/adr/template.md docs/adr/NNNN-title-of-decision.md`
2. **Choose the next number**: Check this index for the highest existing number and increment by 1.
3. **Fill in all sections** of the template.
4. **Add a row to this table** with the new ADR's metadata.
5. **Open a PR** for review.
6. **On merge**: Update the ADR's status to `Accepted`.

## Validation

ADRs are validated in CI by the `adr-validate.yml` workflow which checks:
- All ADR files follow the naming convention (`NNNN-title.md`)
- Required front matter fields are present
- Status is one of: Proposed, Accepted, Superseded, Deprecated
- Date format is YYYY-MM-DD
- Links in the index table are valid

## Related Documentation

- [ADR Template](template.md) — Use this template for new ADRs
- [Contributing Guide](../CONTRIBUTING.md) — General contribution guidelines
- [Architecture Overview](../architecture/README.md) — High-level system architecture

---

*Last updated: 2024-11-24*