# HTTP API

All `/v1` API routes except OAuth callbacks and provider webhooks require:

```http
X-Sales-Connect-Key: <server api key>
X-Sales-Connect-Tenant: <tenant id>
```

Core routes:

- `POST /v1/connections`
- `GET /v1/connections`
- `POST /v1/connections/:id/authorize`
- `POST /v1/connections/:id/pause`
- `POST /v1/connections/:id/resume`
- `GET /v1/connections/:id/schema`
- `GET /v1/connections/:id/schema/:object`
- `POST /v1/connections/:id/mappings`
- `GET /v1/connections/:id/mappings`
- `POST /v1/connections/:id/records/:entity`
- `GET /v1/connections/:id/records/:entity`
- `DELETE /v1/connections/:id/records/:entity/:recordId`
- `POST /v1/connections/:id/sync/:entity/backfill`
- `POST /v1/connections/:id/sync/:entity/reconcile`
- `GET /v1/events`
- `POST /v1/events/:id/replay`
- `GET /v1/conflicts`
- `POST /v1/conflicts/:id/resolve`

### Example mapping

```json
{
  "entity": "contact",
  "direction": "bidirectional",
  "conflictStrategy": "field_owner",
  "deletePolicy": {"remoteToLocal":"soft_delete","localToRemote":"archive"},
  "mappings": [
    {"local":"firstName","remote":"firstname","owner":"shared"},
    {"local":"lastName","remote":"lastname","owner":"shared"},
    {"local":"email","remote":"email","owner":"remote"}
  ]
}
```

Remote field names are provider-specific. The server validates mappings against live provider metadata before creating a mapping version.
