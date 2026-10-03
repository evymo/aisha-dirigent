# docker-compose.coolify-webdispecink.yml — notes

Prose extracted from `docker-compose.coolify-webdispecink.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-svc-common: &svc-common`

==============================================================================
Coolify story: aisha-webdispecink (Backend — Webdispečink fleet import)
==============================================================================
OPTIONAL, OPT-IN tenant connector (svc-webdispecink) — sibling stack on par
with coolify-source-broker.yml. Imports fleet data from the Webdispečink
SOAP API (verze 2.0) into wd_* tables through audited RPCs:
  fáze 1: vozidla (_getCarsList2) + řidiči (_getDriversList2) + import log
  fáze 2+: polohy, kniha jízd, tachograf (viz zadání Webdispečink importu)

Sync is triggered by n8n (service-role token) or an admin/staff JWT via
POST /sync — the service holds no scheduler itself. Webdispečink credentials
live PRIMARILY in the app secret store (edge_app_secrets keys
webdispecink_kodf / webdispecink_username / webdispecink_password); the
WD_* env vars below are a bootstrap fallback only.

Internal-only: no Traefik labels, reached as svc-webdispecink:3042 over the
shared `coolify` network (same convention as coolify-realtime.yml).
==============================================================================

## `pki-init:`

─────────────────────────────────────────────────────────────────────────
pki-init — internal CA bundle for the per-stack volume.
─────────────────────────────────────────────────────────────────────────

## `svc-webdispecink:`

─────────────────────────────────────────────────────────────────────────
svc-webdispecink — Webdispečink SOAP import (:3042).
─────────────────────────────────────────────────────────────────────────

## `KEYCLOAK_URL: ${KEYCLOAK_INTERNAL_URL:-http://aisha-keycloak:80}`

Env-overridable like coolify-source-broker.yml — a story-scoped fork
instance (APP_NAME_PREFIX≠aisha) must point JWT verification at ITS
Keycloak, not the upstream stack's cross-stack alias.

## `WD_API_URL: ${WD_API_URL:-}`

── Webdispečink API — bootstrap fallback, primary is the secret store ──
WD_API_URL default žije v config.ts služby (vendor endpoint, ne
deployment hodnota) — tenant env ho nastavuje jen pro override.
