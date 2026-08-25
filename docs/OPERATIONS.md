# Operations

## Health

- `/health`: process health
- `/ready`: database readiness
- `/metrics`: Prometheus metrics

## Recovery

Failed events remain in `sc_sync_events`. Replay through `POST /v1/events/:id/replay`. Open field conflicts are in `sc_conflicts`. Backfill and reconciliation cursors are in `sc_checkpoints`.

## Recommended production topology

- 2+ server/worker replicas
- managed PostgreSQL with PITR
- reverse proxy / load balancer with TLS
- Prometheus/OpenTelemetry collector or equivalent
- provider webhook alerts
- scheduled backups and credential rotation

## Database maintenance

Expire old `sc_write_fingerprints` regularly. Partition or archive `sc_sync_events` when event history becomes large. Keep enough journal history for incident replay and customer audit requirements.
