# 0001: Record Architecture Decisions

- Status: Accepted
- Date: 2026-11-23
- Deciders: SubTrackr maintainers

## Context

SubTrackr spans a React Native app, backend services, Soroban contracts and a developer portal.
Design rationale was previously scattered across pull requests and chat threads, which makes it
hard for new contributors to understand why the codebase is shaped the way it is and to avoid
re-litigating settled choices.

## Decision

We will use Architecture Decision Records (ADRs) in `docs/adr/` to capture significant
architecture and engineering decisions. Each decision gets one numbered Markdown file using
`0000-template.md`, and the README index is updated in the same change. A lightweight CI check
validates structure so records do not silently rot.

## Consequences

New contributors gain a single, reviewable history of decisions and their context. Changes that
alter a recorded decision must add a new ADR that supersedes the old one rather than rewriting
history. The team accepts the small overhead of writing and reviewing an ADR for decisions with
lasting impact.

## Alternatives considered

- Keep rationale in pull request descriptions: rejected because it is not discoverable later and
  is tied to a point in time rather than to the decision itself.
- Use an external wiki: rejected because records would drift away from the code they describe and
  would not be covered by repository CI.
