# Architecture Decision Records (ADRs)

This directory records the architecture and engineering decisions that shape SubTrackr.
Each decision lives in its own numbered Markdown file, for example
[`0001-record-architecture-decisions.md`](0001-record-architecture-decisions.md).

## Index

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record Architecture Decisions | Accepted | 2026-11-23 |

## Adding a new ADR

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md`, where `NNNN` is the
   next available four-digit number.
2. Fill in every section, then set `Status` to `Proposed`.
3. Add a row to the index table above.
4. Run `node scripts/validate-adr.mjs` before opening a pull request. CI runs the same check.

A decision is *Accepted* only after review; superseded decisions keep their file and link to
the replacing ADR from their `Status` line.

## Validation rules

`scripts/validate-adr.mjs` fails when:

- a file is not named `NNNN-slug.md` or numbers are duplicated;
- the ADR is missing any of `Title`, `Status`, `Date`, `Context`, `Decision` or `Consequences`;
- the template's placeholder text is left unfilled;
- an indexed ADR does not exist, or an accepted ADR is absent from the index.
