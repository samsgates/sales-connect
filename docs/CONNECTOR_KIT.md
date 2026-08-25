# Connector development kit

A connector implements `CRMProvider` from `@sales-connect/types`.

Minimum responsibilities:

1. OAuth authorization, code exchange and token refresh.
2. Schema/object discovery.
3. Single-record CRUD.
4. Paginated list/reconciliation reads.
5. Upsert semantics.
6. Canonical normalization and provider denormalization.
7. Capability declaration.
8. Webhook verification/parsing when the provider offers events.

Provider field names must never enter the core engine. Add a package under `packages/provider-<name>` and provider contract tests. If the provider cannot support a capability, report it in `capabilities()` and use a documented fallback such as polling or lookup+create/update.
