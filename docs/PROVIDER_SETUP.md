# Provider setup

## Salesforce

Create an External Client App / OAuth client. Set the callback URL to:

`https://YOUR_HOST/v1/oauth/salesforce/callback`

Give only the scopes your mappings need. `api` and refresh/offline access are typical. The reference provider uses REST CRUD, object describe, external-ID upsert and SystemModstamp reconciliation. For low-latency CDC, run a Pub/Sub CDC subscriber and POST normalized events to the connection webhook endpoint using its generated webhook secret.

## HubSpot

Create a public app and set:

`https://YOUR_HOST/v1/oauth/hubspot/callback`

Configure CRM object read/write scopes. Configure webhook subscriptions to:

`https://YOUR_HOST/v1/webhooks/<tenant>/<connection>/hubspot`

HubSpot v3 webhook signatures are verified using the app client secret and raw request body. The reference OAuth flow uses HubSpot OAuth v3 token endpoints.

## Zoho CRM

Create a server-based OAuth client in the correct Zoho data center. Callback:

`https://YOUR_HOST/v1/oauth/zoho/callback`

Set `ZOHO_ACCOUNTS_URL` and `ZOHO_API_DOMAIN` for your primary data center. Token responses can update the API domain per connection. Configure a Zoho Notification channel to the connection webhook URL and pass the generated connection webhook secret in `X-Sales-Connect-Webhook-Secret` or a protected `secret` query parameter.

## Webhook endpoint

`POST /v1/webhooks/:tenantId/:connectionId/:provider`

Do not expose the generated non-HubSpot webhook secret in browser code.
