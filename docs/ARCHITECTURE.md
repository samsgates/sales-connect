# Architecture

Sales-Connect is split into a provider-independent synchronization core and provider adapters.

```text
Application / Local Store
          ⇅
   SalesConnectEngine
    ├─ entity mapping
    ├─ three-way conflicts
    ├─ ID mapping
    ├─ echo fingerprints
    ├─ event journal
    ├─ checkpoints
    └─ durable jobs
          ⇅
Provider Contract
 ├─ Salesforce
 ├─ HubSpot
 └─ Zoho CRM
```

## Reliability invariants

1. An event is inserted in `sc_sync_events` before a job is published.
2. Event IDs are unique and provider event IDs are deterministically hashed when available.
3. Local/remote IDs are unique per tenant, connection and entity.
4. Every mapping may retain a last common canonical snapshot for three-way conflict detection.
5. Outbound writes save a short-lived fingerprint. Matching inbound echoes are ignored.
6. Reconciliation overlaps the previous watermark by five minutes after a complete scan.
7. Backfills persist page cursors and can resume after interruption.
8. Every storage key carries `tenant_id`.

## Processing model

Local updates are written to the application adapter first and then journaled. Remote notifications are acknowledged after journal/queue insertion. Workers perform provider IO. Retryable worker failures are handled by the durable queue. A failed event remains inspectable in the journal.

## Conflict model

Sales-Connect uses a three-way comparison: local current state, remote current state, and the last common synchronized snapshot. A field is a conflict only when both sides changed it differently. Field ownership or configured conflict strategy can resolve automatically. Shared/manual fields enter `sc_conflicts`.

## Scaling

API replicas are stateless. PostgreSQL stores state and pg-boss provides distributed job ownership. Run multiple server replicas against the same database. Provider rate limiting should be tuned by deployment for large tenants; the provider contract makes a rate-limit scheduler pluggable without changing canonical sync semantics.
