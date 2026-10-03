# Local dev / test stack

One command brings up an **isolated** local AISHA stack (with Keycloak) seeded
with **dev** data — separate from `demo` (demo is showcase data only; this is the
neutral fixtures you build and run tests against).

## One command

```bash
npm run dev:stack            # core + keycloak + orchestration + integration (preset optimum), seed=dev
npm run dev:stack:full       # + messaging / observability / admin (preset full-light)
npm run dev:stack:status     # show running services
npm run dev:stack:down       # tear down
```

Under the hood this is `scripts/local-warmup.sh --preset optimum --seed-profile dev`:

1. **Generates a complete env** from `config/local-presets.mjs` `devEnvDefaults`
   (160+ vars) — no live Coolify API / no hand-maintained `.env.coolify`. The
   generator hard-fails if any compose `${VAR}` is undeclared, so the env is
   complete by construction.
2. **Generates an isolated compose** (`docker-compose.local.generated.json`,
   project `aisha-local`, containers prefixed `aisha-local__`). In-network
   aliases keep the bare service names, so it **coexists with the e2e stack and
   other projects** without port or name clashes.
3. **Recompiles the seed** with `AISHA_SEED_PROFILE=dev` inside the migrate
   container → applies platform core + the committed `aisha/db/seed/dev/`
   fixtures (a few stories across kanban statuses + a default spend policy).
   No demo data leaks in.
4. **Brings up Keycloak** (host issuer `127.0.0.1:8180` ⟂ in-network JWKS) so the
   web app's OIDC login works.

> **Re-running with a different app set:** pass `--preset`/`--apps` (or
> `--regenerate`) — the generator rebuilds. A bare `npm run warmup:local` reuses
> the existing generated compose (fast refresh of the same set).

## Ports

| Service | URL |
|---------|-----|
| Web (vite) | http://127.0.0.1:8080 |
| Gateway / PostgREST | http://127.0.0.1:3001 |
| Keycloak | http://127.0.0.1:8180 |
| Postgres | 127.0.0.1:54322 |

## Dev data

The `dev` seed profile (`aisha/db/seed/dev/`) is committed, FK-safe and
idempotent — re-seeding a running dev DB is safe. It seeds **stable reference
data only**; live agent sessions, trace events and blocked spend runs are
created at runtime (by the supervisor relay, the VS Code extension, or e2e
specs), never seeded. To extend the dev fixtures, add files under
`aisha/db/seed/dev/` and re-run `AISHA_SEED_PROFILE=dev npm run db:seed:compile`.

## Running the Playwright e2e against it — one command

```bash
npm run test:e2e:devstack -- workbench-surfacing.spec.ts
```

`scripts/e2e/run-devstack.mjs` is the fully-automatic runner (the local-warmup
twin of `test:e2e`, which targets the heavy Coolify e2e compose). It:

1. ensures the dev stack is up + healthy (brings it up via `dev:stack` if not),
2. provisions the deterministic admin/member/partner/staff users in **both**
   Keycloak (`provision-e2e.sh`) and the DB (`seed.e2e.sql` + identity sync),
   idempotently,
3. starts vite with `VITE_E2E=true` pointed at the dev stack (so the SPA reads
   the Playwright-injected token from `localStorage`, not `sessionStorage`),
4. runs Playwright (the `setup` project mints ROPC tokens and injects them; the
   specs then run UI-authenticated), and
5. tears the vite dev server down.

Knobs: `DEVSTACK_SKIP_UP=1`, `DEVSTACK_SKIP_PROVISION=1`, `DEVSTACK_WEB_PORT`,
`DEVSTACK_GATEWAY_URL`, `DEVSTACK_KC_URL`.

`e2e/workbench-surfacing.spec.ts` runs the two-sided loop: mutate via RPC
(backend) → assert the Mission Control panes render it (frontend) → assert the
resulting DB state via RPC (backend again).

> **Browser CORS:** the local generator sets the gateway's `ALLOWED_ORIGINS` to
> the dev web origins (8080 / 5173 / 4173, both `127.0.0.1` and `localhost`). In
> production this is pushed into the gateway's Coolify app env; locally there is
> no Coolify, so the generated compose injects it — without it every in-browser
> RPC fails the CORS preflight and the SPA can't resolve roles (admin → 403).
> Node-side callers (`page.request`) bypass CORS and would hide the gap, so the
> spec's UI assertions are what actually exercise it.

## Isolation summary

- **vs demo:** different seed profile (`dev` ≠ `demo`); demo data never loaded.
- **vs e2e stack:** different compose project + `aisha-local__` container names +
  distinct ports — both can run at once.
- **vs production:** local dev secrets (`devEnvDefaults`), loopback-only binds.
