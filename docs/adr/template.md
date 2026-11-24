# ADR Template

**Title:** [Short, descriptive title of the architectural decision]

**Status:** [Proposed | Accepted | Superseded | Deprecated]

**Date:** YYYY-MM-DD

**Authors:** [Name(s) and GitHub handle(s)]

## Context

[Describe the architectural problem or decision that needs to be made. Include:
- What is the problem we're trying to solve?
- What are the constraints and requirements?
- What is the current state of the system?
- Why is this decision needed now?]

## Decision Drivers

- [Driver 1: e.g., Performance, scalability, cost, team familiarity]
- [Driver 2: e.g., Regulatory compliance, security, maintainability]
- [Driver 3: e.g., Time-to-market, technical debt reduction]

## Considered Options

### Option 1: [Name of option]

**Description:** [Brief description of this option]

**Pros:**
- [Pro 1]
- [Pro 2]

**Cons:**
- [Con 1]
- [Con 2]

**Estimated Effort:** [Low | Medium | High]
**Risk Level:** [Low | Medium | High]

### Option 2: [Name of option]

**Description:** [Brief description of this option]

**Pros:**
- [Pro 1]
- [Pro 2]

**Cons:**
- [Con 1]
- [Con 2]

**Estimated Effort:** [Low | Medium | High]
**Risk Level:** [Low | Medium | High]

### Option 3: [Name of option] (if applicable)

**Description:** [Brief description of this option]

**Pros:**
- [Pro 1]

**Cons:**
- [Con 1]

**Estimated Effort:** [Low | Medium | High]
**Risk Level:** [Low | Medium | High]

## Decision Outcome

**Chosen Option:** [Option X: Name]

**Rationale:** [Explain why this option was chosen over the others. Reference the decision drivers and trade-offs.]

## Consequences

### Positive
- [Positive consequence 1]
- [Positive consequence 2]

### Negative
- [Negative consequence 1]
- [Mitigation for negative consequence 1]

### Neutral
- [Neutral consequence 1]

## Implementation Plan

1. [Step 1 with owner and timeline]
2. [Step 2 with owner and timeline]
3. [Step 3 with owner and timeline]

## Validation Criteria

- [ ] [Criterion 1: e.g., All existing tests pass]
- [ ] [Criterion 2: e.g., Performance benchmark meets threshold]
- [ ] [Criterion 3: e.g., No breaking changes to public API]

## Related Decisions

- [ADR-XXX: Title of related ADR] - [Brief description of relationship]

## References

- [Link to relevant documentation, RFC, or external resource]
- [Link to discussion thread (GitHub issue, PR, Slack, etc.)]

---

## Template Usage Instructions

1. **Copy this file** to `docs/adr/NNNN-title-of-decision.md` where `NNNN` is the next sequential number.
2. **Fill in all sections** - leave no placeholder text.
3. **Number sequentially** - check the [ADR Index](../adr/index.md) for the next number.
4. **Submit for review** - open a PR with the new ADR.
5. **On acceptance** - update status to "Accepted" and add to the index.
6. **If superseding** - update the old ADR's status to "Superseded" and link to the new one.

## Metadata Format (Front Matter)

```yaml
---
adr: NNNN
title: [Title of decision]
status: [Proposed | Accepted | Superseded | Deprecated]
date: YYYY-MM-DD
authors: [Name1, Name2]
decision-drivers: [Driver1, Driver2]
options-considered: [Option1, Option2, Option3]
chosen-option: [Option X]
related-adrs: [ADR-XXX, ADR-YYY]
---
```