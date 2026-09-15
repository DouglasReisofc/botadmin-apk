# Group schedule recovery — 2026-09-15

## Cause

After the database tunnel outage, the group scheduler only considered the
configured minute and a three-minute grace window. Morning actions were therefore
skipped for the rest of the day. Its old claim also marked an action sent before
calling WhatsApp, which could leave a false success after a process crash.

## Production recovery

Queried all non-null group schedules. Three active, connected and licensed groups
had missing morning open markers:

| Group ID | Group | Scheduled opening (America/Sao_Paulo) | Verified recovery |
| --- | --- | --- | --- |
| 1600 | VittaSystem G2 | 08:00 | Already open; reconciled marker |
| 1624 | PEPTIDE HEALTH - GUPO VIP | 09:00 | Already open; reconciled marker |
| 1620 | Peptide Health Brasil 🇧🇷 | 09:00 | Was closed; opened and confirmed through group/info |

No late announcement messages were sent. Previous schedule configurations and
observed group state were saved in the production application's restricted
`logs/schedule-recovery-20260915.jsonl` before changes.

Groups 1540 and 1541 were not changed: their instance was disconnected and its
license expired in August, predating this outage. Disabled groups were preserved.
The supplementary audit found no overdue pending broadcast schedules or overdue
active ad campaigns. There were 166 failed campaign runs since 03:05 UTC on the
incident date, all reporting a disconnected instance; these were not mass-replayed.

## Implementation

- Select only the latest scheduled state, including the preceding local calendar
  day across midnight. Do not replay obsolete close/open transitions.
- Keep per-clock local-date success markers for idempotence.
- Serialize concurrent workers with a settings-row lock using SKIP LOCKED; read
  fresh settings under the lock. Lock/transaction rollback is automatic on crash.
- External group state requests have a shared 12-second timeout. Confirm the
  resulting WhatsApp state before committing success.
- If WhatsApp already has the desired state, only reconcile the success marker.
- Commit internal-group permission changes and the marker in one transaction,
  then notify members through the existing realtime event channel.
- Announcement errors do not undo successful state changes. Suppress stale
  announcements during catch-up.
- Preserve active-group, connected-instance and license checks.

## Validation

`tsx --test scripts/test-group-schedule-recovery.ts`: 10 passing tests covering
catch-up, latest-wins, completed events, midnight, new year, leap day, timezone,
disabled schedules, conflicting times, idempotence and invalid/unsorted clocks.

Two production PostgreSQL connections confirmed SKIP LOCKED excludes a claimed
settings row and rollback releases it; this test did not modify any records.
Production group/info confirmed all three recovered groups are open.

Build/deployment results must be checked separately; these tests do not establish
visual browser validation or the recovery of every event lost during the outage.
