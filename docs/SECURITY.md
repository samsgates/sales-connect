# Security

- OAuth token sets are encrypted using AES-256-GCM with `SALES_CONNECT_MASTER_KEY`.
- The master key must be 64 hexadecimal characters and belongs in a KMS/secret manager in production.
- OAuth state is random, hashed at rest, expires after ten minutes and is single use.
- API requests are tenant-scoped. Background events also persist tenant identity.
- HubSpot webhook signature v3 is verified from the raw body.
- Zoho and Salesforce relay ingress use a per-connection webhook secret in the reference deployment.
- Never log decrypted credentials or CRM payloads containing unnecessary PII.
- Use TLS, a trusted reverse proxy, a managed PostgreSQL database with encrypted backups and private networking.
- Replace the reference global admin API key with your product's user/tenant authorization middleware before exposing the control plane publicly.
- Prefer provider least-privilege scopes and separate sandbox/production connections.
- Rotate `SALES_CONNECT_ADMIN_API_KEY`, provider client secrets, outbound webhook secrets and database credentials on a defined schedule.

## Threat model notes

The HTTP server does not trust tenant IDs without authentication. The bundled admin key is intentionally a self-hosting bootstrap, not a complete SaaS IAM system. If many customer operators use the dashboard, integrate your IdP and enforce tenant membership server-side.
