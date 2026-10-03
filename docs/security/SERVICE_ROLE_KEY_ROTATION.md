# Runbook — service_role JWT leak & signing-key rotation (2026-06)

> **Severity: HIGH.** A self-hosted-Supabase `service_role` JWT (bypasses Row-Level
> Security) was committed to the repository and mirrored to the public GitHub
> mirror. Treat the underlying JWT signing secret as **compromised** and rotate it.

## 1. What leaked

A `service_role` JWT — payload `{"role":"service_role","iss":"supabase","iat":1772489077,"exp":2245874677}`
(valid until ~2041), signature ends `…bm0yshgJ-kbz2…79cB4` — was committed in two
places, plus related artefacts:

| File | What | Status |
|------|------|--------|
| `coolify/_seed_remote.py` | `service_role` literal (`SK = "…"`) | ✅ removed — now `os.environ["AISHA_POSTGREST_SERVICE_KEY"]` |
| `packages/n8n-nodes-aisha/workflows/WF_NODE_FACTORY.json` | `service_role` literal in two Code nodes (raw `fetch()`) | ✅ removed — now an `aishaRpc` node reading the `aishaPostgrestApi` credential |
| `trash/cleanup-2026-04-22-rebrand/docs-legacy-compose/docker-compose.coolify-old.yml` | `${SERVICE_ROLE_KEY:-<token>}` defaults (×4) + anon sibling | ✅ scrubbed to bare `${VAR}` |
| `scripts/test-brain-wiring.sh` | a *separate* long-lived `service_role` JWT (`iss:aisha`, sig `…1CjUfv…`) | ✅ removed — now requires `POSTGREST_SERVICE_TOKEN` |

**Coupled credential (NOT a leak, but breaks on rotation):** the `anon` key
signed by the *same* secret (`iss:supabase`, `iat/exp` identical, sig `…nMF7gANM…`)
is checked into `mobile-app/src/config/api.ts` and `scripts/setup-cockpit/host.mjs`.
`anon` keys are public-by-design (shipped to clients; RLS enforces access), so they
are intentionally committed — **but they will stop validating the moment the signing
secret is rotated.** They must be re-issued in step 4.

**Out of scope (public fixtures, no action):** the `iss:supabase-demo` tokens used
across `e2e/*` and local dev are the documented public Supabase demo keys.

## 2. Why this matters

A `service_role` JWT is accepted by PostgREST / the gateway as an **RLS-bypassing**
identity — it can read and write every row in every table (PHI, users, tokenomics)
regardless of policy. A copy valid until 2041, in public git history, is a standing
full-database compromise until the signing secret is rotated. Removing the literal
from `HEAD` (done) does **not** neutralise it — the secret is recoverable from
history and the GitHub mirror.

## 3. Rotate the signing secret  ⟶ **operator action (not automatable from this PR)**

The token is signed with the platform JWT secret (`JWT_SECRET` / `PGRST_JWT_SECRET`,
set on the core stack). Rotating it invalidates **every** token signed with the old
secret (the leaked `service_role` AND the matching `anon` key) in one shot.

> Per platform policy there is **no direct SSH** to the servers — drive the change
> through the Coolify API (env update + redeploy), as the deploy scripts do.

1. **Generate a new secret + derived keys.** The repo already has the generator:
   ```bash
   node scripts/generate-secrets.mjs          # emits JWT_SECRET + signed anon/service_role
   ```
   Capture the new `JWT_SECRET`, `AISHA_POSTGREST_SERVICE_KEY` (service_role) and
   `AISHA_POSTGREST_ANON_KEY` (anon) — both freshly signed with the new secret.
2. **Push the new env to the core stack** (PostgREST + gateway) via the Coolify API
   (`PATCH …/applications/{uuid}/envs/bulk`), then **redeploy** so PostgREST reloads
   `PGRST_JWT_SECRET`. Resolve the UUID dynamically:
   `bash scripts/lib/coolify-resolve-uuid.sh aisha-core`.
3. **Verify** the old token is now rejected and a new one is accepted:
   ```bash
   # OLD service_role -> expect 401 (JWSError / JWSInvalidSignature)
   curl -s -o /dev/null -w '%{http_code}\n' \
     -H "apikey: <OLD_service_role>" -H "Authorization: Bearer <OLD_service_role>" \
     "$AISHA_POSTGREST_URL/rest/v1/roles?select=id&limit=1"
   # NEW service_role -> expect 200
   ```

## 4. Update consumers to the newly-signed keys

After rotation, update everything that held an old-secret-signed token:

- **n8n credentials** (n8n UI → Credentials) — the credential(s) backing the
  workflow nodes: `aishaPostgrestApi` ("AISHA PostgREST" → field `serviceRoleKey`),
  and the legacy `httpHeaderAuth` creds named **"Supabase Service Role"** /
  **"AISHA Supabase (Service Role)"** / **"AISHA MCP Service Role"**. Set the new
  `service_role` + `anon` values.
- **Mobile app** `mobile-app/src/config/api.ts` → `CLOUD_ANON_KEY` (new anon key).
- **Setup cockpit** `scripts/setup-cockpit/host.mjs` → `CLOUD_ANON_KEY` default
  (new anon key) — better, set `AISHA_CLOUD_ANON_KEY` in its environment.
- **Published client config** `.well-known/app-config.json` (if it pins the anon key).
- **Any operator `.env` / secret store** referencing `AISHA_POSTGREST_SERVICE_KEY`,
  `AISHA_POSTGREST_ANON_KEY`, `POSTGREST_SERVICE_TOKEN`, `JWT_SECRET`.

## 5. The separate `iss:aisha` token

`scripts/test-brain-wiring.sh` carried a *different* long-lived `service_role` JWT
(`iss:aisha`, sig `…1CjUfv…`). If it is signed by the same `JWT_SECRET`, step 3
already kills it. If a different signing authority issued it, rotate that too and
confirm nothing else relies on the literal (the script now requires
`POSTGREST_SERVICE_TOKEN`).

## 6. Scrub git history (mirrored to GitHub)

The token remains in history and on the GitHub mirror. After rotation (which makes
the old token worthless), scrub it so scanners stop flagging it:

```bash
# Forgejo is canonical (origin); coordinate a force-update + re-mirror.
git filter-repo --replace-text <(printf '%s==>REDACTED-ROTATED\n' \
  'bm0yshgJ-kbz2HPNakc3iIUH6YvY6DQeo5T6Eo79cB4')
```
History rewrite changes commit hashes — coordinate with anyone holding clones, and
purge/re-push the GitHub mirror (or delete + recreate it) so the old objects are
garbage-collected upstream. **Rotation (step 3) is the real fix; the scrub is hygiene.**

## 7. Prevention (landed in this change)

- **`src/tests/gates/no-committed-secrets.gate.test.ts`** — the existing
  "no infra in repo" gate, **extended** here with a 4th rule that decodes every
  committed JWT and fails on any `role:service_role` token **unconditionally** (the
  allowlist cannot exempt it — a service token is never "public"), plus `role:anon`
  keys outside genuinely-public surfaces (`public/.well-known/`). It runs in the
  always-on `npm run test:gates` and is verified both ways (fails on an injected
  service_role token, passes once clean). This closes the gap that let the leak
  through twice over: the gate previously only matched **ES256** Apple JWTs (the
  platform tokens are **HS256**), it had **allowlisted the very files** that carried
  the leak, and `eslint-plugin-no-secrets` only lints JS/TS — so the JSON / YAML /
  shell / Python carriers were never scanned.
- PR #275 goes beyond minimal removal: it **env-vars every committed platform JWT**
  — not only the leaked `service_role` literals, but also the public
  `iss:supabase-demo` fixtures across the e2e suite, the `mobile-app` anon key (via
  the existing `getExpoEnv`), and dev scripts. Afterwards the tree carries **no**
  committed platform JWT (only the canonical jwt.io redaction-test fixture remains).
- **`.gitleaks.toml`** — portable companion for pre-commit / on-demand / history
  scanning (`gitleaks detect --config .gitleaks.toml`). It pins the compromised
  `…bm0yshgJ…` signature so it can never reappear, and tolerates the public
  `iss:supabase-demo` / `anon` signatures **only to avoid noise on old history** —
  the always-on vitest gate above is the stricter forward enforcer.

## 8. Lessons

- A leaked `service_role` key is a **full-DB compromise**, not a config nit.
  Rotation — not deletion from `HEAD` — is the fix.
- Secret scanning must cover **all file types**, not just source the linter sees.
- `service_role` belongs only in a secret store (env var) or an n8n credential —
  never in workflow JSON, seed scripts, or compose defaults.
