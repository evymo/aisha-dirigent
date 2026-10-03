# Local-warmup OIDC consumer support

`scripts/local-warmup.sh` runs a **minimalist** local stack: no Traefik, no
`/etc/hosts` edits, host access via `localhost:<port>`, in-network traffic via
docker DNS. The model-driven Keycloak resolver
(`scripts/lib/kc-endpoint-resolver.mjs`, PR #336) decouples the token `iss`
(host-facing `127.0.0.1:<port>`) from the in-network JWKS/token fetch
(`aisha-keycloak:80`). That makes **explicit-endpoint** OIDC consumers work, but
**discovery-based** consumers cannot.

## Support matrix

| Consumer | Mechanism | local-warmup |
|---|---|---|
| `aisha-gateway`, `aisha-svc-mcp-knowledge`, `aisha-svc-plugin-system` | `KC_ISSUER` + explicit `KC_JWKS_URL` | ✅ works (host-facing iss, in-network JWKS) |
| oauth2-proxy admin/monitoring UIs (`aisha-nocodb-auth`, `aisha-appsmith-auth`, `aisha-intranet-auth`, `aisha-pgadmin-auth`, `frontend--n8n--auth`, …) | `OAUTH2_PROXY_SKIP_OIDC_DISCOVERY=true` + explicit endpoints | ✅ works |
| `aisha-svc-matrix` | `KEYCLOAK_ISSUER` (iss) + `KEYCLOAK_URL` (in-network JWKS) | ✅ works |
| **Langfuse** (`aisha-langfuse`) | NextAuth Keycloak provider — server-side discovery | ❌ login can't complete |
| **LLM Gateway** (`aisha-llm-gateway`) / **OpenClaw** (`aisha-openclaw`) | server-side OIDC discovery | ❌ |
| **Matrix Synapse** (`aisha-synapse`) | `oidc_providers` — no JWKS split in its config | ❌ |

## Why discovery consumers can't work here

A discovery consumer uses **one** issuer URL for **both** the `.well-known` fetch
(server-side — must be reachable from inside the container) **and** `iss`
validation (must equal what Keycloak stamps = the host-facing `127.0.0.1:<port>`
the browser used). On a single host with no Traefik and no `/etc/hosts`, there is
no single `host:port` that is both in-network-reachable **and** equal to the
host-facing `iss`:

- `127.0.0.1` inside a container is the container itself, not the host.
- the host port (`8180`) ≠ the in-network container port (`80`), so even a shared
  hostname can't carry one issuer URL for both sides.

The full / e2e stack solves this with **Traefik on `:443` + a real hostname**, so
the issuer is one reachable URL everywhere.

## What to do

- For these consumers, use the **e2e / full Traefik stack** (`npm run test:e2e`
  or the deployed stack), not local-warmup.
- The generator prints a **non-fatal warning** listing any discovery consumer in
  the selected preset — see `scripts/lib/oidc-consumer-support.mjs`.
- A future opt-in `.local` + `/etc/hosts` (or local Traefik) mode could lift this;
  it is intentionally **out of scope** for local-warmup's minimalist philosophy.
