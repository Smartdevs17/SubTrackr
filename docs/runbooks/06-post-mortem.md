# Disaster Recovery Post-Mortem Process

## Purpose
A post-mortem is a blameless analysis conducted after any disaster recovery event or automated failover is triggered. The goal is to identify root causes, understand the timeline of events, and improve our RTO, RPO, and systemic resilience.

## When to write a post-mortem
- Anytime `scripts/dr-failover.js` is executed (manually or automatically).
- When a `CRITICAL_RPO_BREACH` or `BACKUP_CORRUPTION` alert is fired by `drMonitoring.ts`.
- Any outage lasting longer than the 5-minute RTO target.

## Template

### 1. Incident Summary
* **Date & Time of Incident**: (UTC)
* **Duration**: (Time to detect + Time to resolve)
* **Severity**: (Low / Medium / High / Critical)
* **Lead Responder**: (Name / Team)

### 2. Timeline
*Provide a chronological breakdown of events. Include log timestamps and alerts.*
* `10:00 UTC` - App crash spike detected in monitoring.
* `10:02 UTC` - `drMonitoring.ts` alerted of corrupted state.
* `10:05 UTC` - `dr-failover.js` was executed manually by the on-call engineer.
* `10:06 UTC` - Services restored from the last known good backup.

### 3. Root Cause Analysis (The 5 Whys)
1. **Why did the system fail?** (e.g., A malformed state object was persisted to AsyncStorage.)
2. **Why was the malformed object persisted?** (e.g., The schema migration script failed to account for legacy accounts.)
3. **Why wasn't this caught in testing?** (e.g., Missing unit tests for legacy account edge cases.)
4. **Why?** ...
5. **Why?** ...

### 4. Resolution and Recovery
* **How was it resolved?** (Detail the failover procedure)
* **Was the RTO met?** (Did recovery complete within 5 minutes?)
* **Was the RPO met?** (Was data loss limited to the 1-hour window?)

### 5. Action Items
*List preventative measures to ensure this exact incident doesn't happen again.*
* [ ] Fix the schema migration script. (Owner: @dev)
* [ ] Add legacy account edge case unit tests. (Owner: @dev)
* [ ] Adjust `drMonitoring.ts` thresholds if RTO was exceeded.

## Process Workflow
1. **Within 24 hours** of the incident, the lead responder drafts the post-mortem using this template.
2. **Within 48 hours**, the engineering team reviews the document in a blameless post-mortem meeting.
3. Action items are assigned and added to the sprint backlog.
4. The finalized post-mortem is stored in the company's internal wiki or incident repository.
