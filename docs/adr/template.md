# Architecture Decision Record Template

> This template follows the [MADR](https://adr.github.io/madr/) (Markdown Architecture Decision Records) format.

---

# ADR <NNNN>: <Title>

> **Status:** `Proposed` | `Accepted` | `Rejected` | `Superseded` | `Deprecated`
>
> **Date:** YYYY-MM-DD
>
> **Deciders:** <names/roles>
>
> **Technical Story:** <link to issue/PR>

---

## Context and Problem Statement

<Describe the context and problem that motivates this decision. 2-3 sentences max.>

---

## Decision Drivers

* <Driver 1: e.g., regulatory requirement, performance target, team expertise>
* <Driver 2>
* <Driver 3>

---

## Considered Options

### Option 1: <Name>

<Description of the option.>

**Pros:**
* <Pro 1>
* <Pro 2>

**Cons:**
* <Con 1>
* <Con 2>

---

### Option 2: <Name>

<Description of the option.>

**Pros:**
* <Pro 1>
* <Pro 2>

**Cons:**
* <Con 1>
* <Con 2>

---

### Option 3: <Name> (if applicable)

<Description of the option.>

**Pros:**
* <Pro 1>
* <Pro 2>

**Cons:**
* <Con 1>
* <Con 2>

---

## Decision Outcome

**Chosen option:** `<Option N: Name>`

<Brief rationale for the choice. Reference the drivers.>

---

## Consequences

### Positive

* <Positive consequence 1>
* <Positive consequence 2>

### Negative

* <Negative consequence 1>
* <Negative consequence 2>

### Risks

* <Risk 1 and mitigation>
* <Risk 2 and mitigation>

---

## Implementation Notes

* <Implementation detail 1>
* <Implementation detail 2>
* <Link to implementation PR>

---

## Validation

This ADR must be validated by:

- [ ] Code review approval from at least one architect
- [ ] CI check passes (`adr-validate.yml`)
- [ ] Added to ADR index (`docs/adr/README.md`)

---

## References

* <Link to related ADR, issue, PR, or external resource>
* <Link to another ADR this supersedes (if applicable)>

---

## Changelog

| Date       | Author | Change                          |
|------------|--------|---------------------------------|
| YYYY-MM-DD | <Name> | Initial version                 |

---

> **Template version:** 1.0
> **Location:** `docs/adr/template.md`
> **CI validation:** `.github/workflows/adr-validate.yml`