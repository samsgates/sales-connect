# Contributing

1. Fork and create a focused branch.
2. Run `pnpm typecheck`, `pnpm test`, and `pnpm build`.
3. Provider changes must keep provider-specific field names out of the core engine.
4. New connectors should implement the common provider contract and add contract tests.
5. Never commit real OAuth tokens, CRM payloads containing customer PII, or production secrets.
