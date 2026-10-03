# Stack-operations & cold-start test coverage

> Confirmation matrix for the test/gate coverage of AISHA cold-start (incl.
> `--wipe`) and the other "work with the stack via scripts" operations.
> Produced by a 6-agent coverage audit (2026-07-06). Re-verify with `npm run test:gates`.

## TL;DR — the two headline worries are covered ✅

| Worry | Covered? | By |
|---|---|---|
| A **new compose var** referenced WITHOUT a `:-default` breaks a fresh `--wipe` cold-start | ✅ **YES** — build fails, caught pre-merge | `env-doctor-contract-coverage.gate` + `cold-start-heredoc-bindings.gate` (a var must be written by `aisha-env-doctor.mjs` or the cold-start HEREDOC, or be KNOWN_DYNAMIC) |
| `--wipe` is **project-scoped** (won't touch other tenants) + **dry-run-safe** | ✅ **YES** | `coolify-project-scope.gate` (fail-loud, no global name-prefix DELETE) + `cold-start-dry-run-safety.gate` |
| Redeploy **syncs env BEFORE deploy** (no stale `${VAR}` interpolation) | ✅ **YES** | `redeploy-syncs-env-first.gate` |
| Manifest ↔ deploy-wave **parity** (every app is reachable by a wave) | ✅ **YES** | `redeploy-wave-coverage.gate` |
| A stack script uses a **bare `COOLIFY_API`** (no `/api/v1`) → "no apps" abort | ✅ **YES** (this PR) | `coolify-api-base-normalization.gate` + shared `scripts/lib/coolify-api-base.sh` |
| KB MCP **auth / tier-ACL** can't be bypassed from the service layer | ✅ **YES** | DB: `knowledge-tier-acl.gate` + `rag-isolation-rbac.gate` + pgTAP `11_knowledge_tier_acl.sql`; service: `mcp-knowledge-auth.gate` (this PR) |

## Coverage matrix — stack-operation scripts

| Script | Purpose | Coverage | Kind |
|---|---|---|---|
| `aisha-cold-start.sh` (+ `--wipe`) | full bring-up / teardown+rebuild | `cold-start-scripts.gate` (bash -n, --help, Usage), `cold-start-doctor.gate` (empty-env → explicit contract errors), `cold-start-heredoc-bindings.gate`, `env-doctor-contract-coverage.gate` | structural + doctor smoke |
| DB apply on cold-start | baseline+heals apply on a fresh DB | `verify-cold-start-apply.sh` / `verify-upgrade-apply.sh` **against a real Postgres in CI** (with-throwaway-db) | **functional** |
| `coolify-wipe-all.mjs` (`--wipe` engine) | destructive teardown | `coolify-project-scope.gate` (no unscoped DELETE), `cold-start-dry-run-safety.gate` | structural |
| `aisha-redeploy.mjs` | stateful wave redeploy | `redeploy-syncs-env-first.gate`, `redeploy-wave-coverage.gate` | structural |
| `coolify-sync-envs.sh` | per-app env push (compose `${VAR}` ∩ `.env.coolify`) | `coolify-api-base-normalization.gate`; **call-ordering** via `redeploy-syncs-env-first`. ⚠️ per-app intersection LOGIC not yet functionally exercised (gap G2) | structural |
| `aisha-env-doctor.mjs` | env contract heal | `env-doctor-contract-coverage.gate` | structural |
| `generate-secrets.mjs` | secret minting | `secret-strength-floor.gate` (execs it, checks entropy) | **functional** |
| `coolify-domain-doctor.mjs` | docker_compose_domains repair | derive-domains gates (`topology-derivation`, `domain-coverage`, `coolify-domain-format`) | structural |
| `derive-domains.mjs` | topology → domains SoT | `topology-derivation.gate` (all profiles `--check`), `topology-domains-parity.gate` | **functional (`--check`)** |
| `aisha-mesh-toggle.mjs` | mesh on/off/status | existence + string flags only. ⚠️ runtime untested (gap G3) | structural |
| `coolify-server-onboard.sh` | onboard a new Coolify server | bash -n + exec bit (this PR) — was ZERO | structural |
| `coolify-stack-status.sh` | status matrix | bash -n + exec bit + `coolify-api-base-normalization` (this PR) — was ZERO | structural |
| `patch-domains-and-redeploy.sh` | domain patch + redeploy | bash -n + exec bit (this PR) — was ZERO | structural |
| `blue-green-switch.mjs` | autopilot Phase-2 slot switch | ⚠️ ZERO (gap G4 — `.mjs`, not in the bash gate) | none |

## Remaining gaps (identified, prioritized)

- **G1 — no end-to-end `--wipe` dry-run gate.** Orchestrator runtime (wave order, API call sequence, healthcheck gating) is only string-asserted; `cold-start-doctor.gate` explicitly disclaims runtime coverage. *Fix:* a mocked/replayed Coolify-API integration test driving `aisha-cold-start.sh --wipe --dry-run` end-to-end, asserting the planned DELETE/create/deploy sequence.
- **G2 — `coolify-sync-envs.sh` per-app intersection logic** (compose `${VAR}` ∩ `.env.coolify`) is not functionally executed. *Fix:* extract the intersection helper + a fixture-app unit test.
- **G3 — `aisha-mesh-toggle.mjs` runtime** (`--on/--off/--status` → Coolify env mutations) untested. *Fix:* dry-run gate asserting the emitted env mutations.
- **G4 — `blue-green-switch.mjs`** has no coverage (`.mjs`). *Fix:* a `--help`/dry-run/no-cred exit-assertion unit test.
- **G5 — CI cold-start DB apply gate is conditionally skipped when DinD is unavailable** (emits only a warning) — the strongest cold-start apply proof can silently no-op. *Fix:* run it on a DinD-guaranteed runner (or make it non-skippable).

This PR closes the `COOLIFY_API` gap, the MCP service-auth gap, and the three ZERO-coverage shell scripts; G1–G5 are documented follow-ups (none is a preview blocker — the two headline worries above are fully covered).
