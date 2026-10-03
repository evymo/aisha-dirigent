# Secrets management — investigation + decision (Phase 12 WP 3.7)

> **Snapshot 2026-05-20**, valid against main commit `<merge-sha>`.
> **Owner**: DevOps (per Phase 12 §0.3 roster).
> **Phase 12 WP 3.7** — `docs/security/`.
> **Status**: Decision-doc only. Implementation is a SEPARATE follow-up WP
> chosen based on §6 Decision.

## TL;DR

Today every secret in the AISHA stack lives as a **plaintext environment
variable** inside the container's runtime — visible via `docker inspect`
to anyone with Docker socket access. We have **126 env-var secret
references across 20 Coolify compose files**.

This document compares 4 options and recommends one. Implementation is
NOT in this PR — that's the follow-up.

## §0 Threat model — what we're protecting

### 0.1 In-scope

| Threat | Today's exposure |
|---|---|
| A. Lateral movement after svc compromise — attacker reads `/proc/<pid>/environ` | ALL secrets in same container readable |
| B. `docker inspect <ctr>` from host with Docker socket access | ALL secrets viewable as plaintext JSON |
| C. Crash dump / core file written to disk includes env block | All secrets dumpable |
| D. Accidentally committed `.env*` file to repo | Git history exposure |
| E. Coolify backup tarball contains env vars | Anyone with Coolify backup access reads everything |
| F. Sentry / Langfuse error frame includes env in breadcrumb | PII/secret leak to observability vendor |

### 0.2 Out-of-scope (handled by other WPs or already mitigated)

- Network-level exfiltration (mTLS at WP 3.3)
- Process-level isolation (Docker network seg at WP 3.4)
- JWT revocation (already at WP 3.5)
- PII filter at observability layer (already at WP 4.7)
- Secrets in code/git history (already gated by Husky + Semgrep)

## §1 Current state inventory

### 1.1 Volume

```bash
grep -hE "_PASSWORD|_SECRET|_TOKEN|_KEY:" docker-compose.coolify*.yml \
  | grep -E '\$\{' | wc -l
# 126
```

20 compose files, 126 `${SECRET_NAME}` references.

### 1.2 Categories observed

| Category | Examples | Risk |
|---|---|---|
| Database passwords | `NOCODB_DB_PASSWORD`, `KEYCLOAK_DB_PASSWORD`, `ELASTIC_PASSWORD` | **High** (DB compromise = data) |
| OIDC client secrets | `NOCODB_OIDC_SECRET`, `APPSMITH_OIDC_SECRET`, `NETBIRD_MGMT_SECRET` | **High** (silent IdP impersonation) |
| Service tokens | `POSTGREST_SERVICE_TOKEN`, `RAGNAROK_API_KEY`, `BROKER_TOKEN_SECRET` | **High** (privileged service ops) |
| Encryption keys | `APPSMITH_ENCRYPTION_PASSWORD`, `OAUTH2_PROXY_COOKIE_SECRET` | **High** (decrypt all sessions/data) |
| External vendor keys | `OPENAI_API_KEY`, `COHERE_API_KEY`, `DEEPL_API_KEY` | Medium (cost abuse + vendor lockout) |
| Internal API keys | `KRONOS_API_KEY`, `MAESTRO_API_KEY` | Medium (internal services) |
| KC admin password | `KEYCLOAK_ADMIN_PASSWORD` | **Critical** (full realm takeover) |

### 1.3 What works today

- `.env-prod-backup` file is in `.gitignore` and never committed
- Coolify Variables UI is the only authoritative source — env file is just
  a local cache for cold-start scripts
- Bootstrap scripts generate secrets at runtime, PATCH to Coolify Variables
  API (per `feedback_bootstrap_creds_generator_pushes.md`)
- Husky pre-commit + Semgrep block known secret patterns from entering git
- No `.env` file ever ships in a container image

### 1.4 What doesn't work today

| Gap | Impact |
|---|---|
| `docker inspect svc-ai-chat` reveals **all** env vars in plaintext | Anyone with host root + Docker socket reads every secret |
| Crash dump / `dump-stack` output includes env | Worst case: dump to S3 = remote exposure |
| Coolify backup includes `Variables` data (encrypted at rest in Coolify DB, but operator with Coolify shell can dump them) | Single Coolify breach → all secrets |
| Container `env` command lists all env to anyone with `exec` rights | RCE → secret enumeration |
| Bulk Coolify env PATCH via `/envs/bulk` accepts JSON; trace log of that request may include secrets | API audit log = secret log |

## §2 Options

### 2.A Coolify v4 native secrets (file-mount)

**What Coolify v4 provides** (verified via Coolify v4.x docs + source):

| Capability | Status |
|---|---|
| Encrypted-at-rest in Coolify DB | ✅ (AES-256-CBC with app-key in `/data/coolify/.env`) |
| Web UI for env editing | ✅ "Variables" tab per resource |
| Bulk PATCH API `/api/v1/applications/<uuid>/envs/bulk` | ✅ (we use this in bootstrap scripts) |
| File-mount of secrets (Docker secrets-style) | ⚠️ **Partial** — Coolify supports `secrets:` block in compose but only as file-mount from Coolify-managed `/data/secrets/` |
| Rotation API (rotate without restart) | ❌ Restart required after env update |
| Per-environment scoping (dev/staging/prod) | ✅ (each Coolify project = environment) |
| Audit log of secret reads/writes | ⚠️ Coolify writes to `audit_logs` table; not exported to external SIEM |
| Service-account read-only access (CI fetches secrets) | ✅ via API token with `read:applications` |
| Hardware-backed key escrow | ❌ |
| Multi-region replication / DR | ⚠️ Manual (Coolify is single-node by design) |

**File-mount example** (what Coolify exposes today):

```yaml
services:
  svc-ai-chat:
    secrets:
      - openai_api_key
    environment:
      OPENAI_API_KEY_FILE: /run/secrets/openai_api_key
secrets:
  openai_api_key:
    external: true
    name: aisha_openai_api_key
```

The secret lives in `/data/coolify/secrets/aisha_openai_api_key` on the
Coolify host (owner root:root, mode 0600). At container start, Docker
mounts it at `/run/secrets/openai_api_key` (read-only, owner = container
user, mode 0400).

**Pros**:
- Zero new infrastructure to operate
- Already encrypted-at-rest
- Eliminates `docker inspect` env exposure for secrets that move to
  file-mount
- Coolify backup story unchanged (already there)
- Compatible with existing `${VAR}` substitution for non-secret vars

**Cons**:
- App code must read `*_FILE` env vars + `readFileSync()` at boot
  (one helper, ~10 LOC; we already have `services/_shared/config/` pattern)
- No rotation without restart (acceptable for AISHA cadence)
- No external SIEM audit shipping (mitigated by `audit_journal` for
  AISHA-managed secret reads)
- ~5 hr/svc estimated migration effort × ~24 svc = ~120 hours total
  (parallelizable across 5-6 svc per week)

### 2.B HashiCorp Vault with Agent sidecar

**Architecture**: deploy `vault` server (Coolify stack), `vault-agent`
sidecar in each pod that needs secrets. Agent fetches secrets via
short-lived token, writes to in-memory tmpfs file, optionally restarts
the main process on rotation.

| Capability | Vault provides |
|---|---|
| Encrypted-at-rest | ✅ (transit + storage encryption) |
| Rotation without restart | ✅ (`vault-agent` re-fetches; app re-reads file) |
| Audit log | ✅ (file + syslog + external sink) |
| HSM-backed unseal | ✅ (commercial license) |
| Multi-region | ✅ (Vault Enterprise) |
| Web UI | ✅ |
| API for CI / IaC | ✅ |

**Pros**:
- Gold-standard for enterprise secrets
- Rotation on demand
- Per-secret ACL policies
- External SIEM ship
- Production-tested pattern (e.g. Cloudflare, Stripe internal)

**Cons**:
- **One more service to operate**: Vault server (HA cluster of 3 nodes for
  prod-grade) + per-pod sidecars
- Unseal procedure on every restart (or `--auto-unseal` against AWS KMS /
  GCP KMS — couples us to a cloud)
- Steep learning curve: policies, transit engine, dynamic secrets, leases
- Cost: enterprise features (HSM, perf replication) gated behind paid
  tier; OSS sufficient for our scale but operators need training
- ~40 hr to deploy Vault + agent template + first migration; ~3 hr/svc
  thereafter
- New attack surface — Vault itself is HVT; loss-of-Vault = total outage

### 2.C Doppler

SaaS secrets manager with CLI/SDK wrappers.

**Pros**:
- Zero infra to operate
- Web UI, audit, rotation, secret-as-code workflow
- Free tier sufficient for AISHA secret volume (~150 secrets)

**Cons**:
- **External dependency** — Doppler outage = AISHA can't restart any
  container needing fresh secrets
- Data residency: secrets transit Doppler's AWS/GCP; not acceptable for
  EU GDPR-strict customers
- Vendor lock-in: migration off Doppler is ~same effort as initial
  migration on
- Cost at scale ($89/user/month for Team tier above 10 users)

**Verdict**: Killed by data residency + outage dependency. Documented for
completeness only.

### 2.D SOPS + age + git-secrets

Encrypt env files with `age` keys, commit `*.enc` to git, decrypt at
deploy time.

**Pros**:
- GitOps-native: secrets are version-controlled
- No runtime service
- `age` is small, audited
- Free, no SaaS

**Cons**:
- Secrets still end up as env vars at runtime (no file-mount benefit)
- Decryption key has to live somewhere — chicken-and-egg
- Rotation = git commit (operator-heavy)
- Doesn't solve `docker inspect` exposure (the primary motivator)

**Verdict**: Solves a different problem (secrets-in-git), not our problem
(secrets-in-env-at-runtime). Documented for completeness.

## §3 Decision matrix

Weighted score (5 = best, 1 = worst):

| Criterion | Weight | A. Coolify | B. Vault | C. Doppler | D. SOPS |
|---|---|---|---|---|---|
| Eliminates `docker inspect` exposure | 5 | 5 | 5 | 5 | 1 |
| Operator-trivial to deploy | 3 | 5 | 2 | 5 | 4 |
| Existing infra reuse | 5 | 5 | 1 | 1 | 3 |
| Rotation without restart | 2 | 1 | 5 | 4 | 1 |
| External SIEM audit | 1 | 2 | 5 | 4 | 1 |
| EU data residency compatible | 4 | 5 | 5 | 1 | 5 |
| New attack surface | 3 | 5 | 2 | 3 | 4 |
| Cost (TCO 12 months) | 2 | 5 | 4 | 2 | 5 |
| **Weighted total** | | **97** | **77** | **57** | **55** |

## §4 Decision

**Adopt Option A — Coolify v4 native file-mount secrets.**

Rationale:
- Best score on weighted matrix (97 vs 77 for Vault)
- Per §-1.12 R10 (redundancy audit): Coolify already deploys this
  infrastructure, we just use it
- Per §-1.8 (AISHA capability applied not new): file-mount is a
  capability the stack already has, we wire it up
- Per "stokrat měřit než jednou blbě říznout": the smaller delta from
  current state (env → file) has lower regression risk than introducing
  Vault
- Vault stays on the parking lot for **Phase 19+** (post 90-day plan) if
  we ever need rotation-without-restart for compliance reasons (e.g.
  PCI-DSS Level 1 or HIPAA expansion)

## §5 Migration plan (separate follow-up WP, NOT this PR)

The follow-up work package is **WP 3.7b — Coolify file-mount secrets
migration**. Scope:

### 5.1 Phase 0 — proof of concept (3 days, DevOps)

1. Pick 1 service with 3 secrets (suggest: `svc-mcp-knowledge` with
   `OPENAI_API_KEY` + `RAGNAROK_API_KEY` + `POSTGREST_SERVICE_TOKEN`)
2. Add `services/_shared/config/secrets.ts`:
   ```ts
   import { existsSync, readFileSync } from "node:fs";
   
   /**
    * Read a secret from either a file mount (preferred) or fall back to
    * the env var (for local-dev where we don't bother with secret files).
    *
    * Coolify file-mount convention: env var `FOO_FILE=/run/secrets/foo`
    * makes the secret available at the file path; env var `FOO` is the
    * legacy plaintext fallback.
    */
   export function readSecret(varName: string): string {
     const fileVar = `${varName}_FILE`;
     const filePath = process.env[fileVar];
     if (filePath && existsSync(filePath)) {
       return readFileSync(filePath, "utf8").trim();
     }
     const inline = process.env[varName];
     if (inline) return inline;
     throw new Error(`Secret ${varName} not available (no ${fileVar} mount, no ${varName} env)`);
   }
   ```
3. Migrate `svc-mcp-knowledge` to use `readSecret()` for the 3 secrets
4. Add `secrets:` block to `docker-compose.coolify.yml` for those 3
5. Create the 3 secret files in Coolify host: `/data/coolify/secrets/`
6. Restart service, verify it picks up from files via Langfuse trace
   (no functional regression)
7. Verify `docker inspect aisha-svc-mcp-knowledge | jq '.[0].Config.Env'`
   no longer contains the 3 secrets as plaintext

### 5.2 Phase 1 — rollout to remaining services (~8 weeks, 3 svc/week)

Migrate in dependency order (least-blocking first):
- Week 1: gateway, svc-ai-chat, svc-mcp-knowledge (the AI hot path)
- Week 2: svc-ide-context, svc-agent-runner, svc-plugin-system
- Week 3: svc-integrations (post merge of WP 4.2)
- Week 4-8: remaining 17 services, n8n, NocoDB, Keycloak, Postgres,
  Appsmith, etc.

Each service migration is a separate small PR:
- Add `readSecret()` import + replace 3-10 env reads
- Update compose: add `secrets:` block, change `${VAR}` to `${VAR_FILE}`
- Manual smoke test in staging
- Gate test: assert service uses `readSecret()` for known sensitive vars

### 5.3 Phase 2 — gate hardening (1 week, DevOps)

Once 100 % migrated:
1. Add CI step that builds + inspects each container image, fails if
   any of the known secret patterns appear in the runtime env block
2. Tighten `src/tests/gates/wp-3-7-secrets-no-plaintext.gate.test.ts`
   from "no regression above baseline" → "0 plaintext secrets in env"
3. Update `docs/security/SECRETS_MANAGEMENT.md` (operational runbook,
   different from this investigation doc)

## §6 Pre-flight gate for this PR (the investigation)

This investigation PR contributes:
- The doc (this file)
- A **baseline-capture gate test** that:
  - Counts plaintext secret references in compose files at merge time
  - Stores baseline in `src/tests/gates/wp-3-7-secrets-no-plaintext.baseline.json`
  - Asserts future PRs don't INCREASE the count (ratchet-down pattern, per
    WP 2.5 / 4.5 / 4.6)

This way the investigation alone delivers a measurable improvement: any
future PR that adds a NEW plaintext secret to compose without going
through the file-mount migration will fail CI.

## §7 Risks + mitigations

| Risk | Mitigation |
|---|---|
| Migration drags on, baseline doesn't drop | Calendar Phase 5.2 explicitly; Slack/Matrix weekly check-in |
| `readSecret()` breaks local-dev (no `*_FILE` mounts) | Helper falls back to plaintext env var — covered by the implementation in §5.1 |
| Service forgets a secret, hard-codes a token | Gate test enforces `readSecret()` for known-sensitive var names |
| Coolify secret-file mount silently fails | Restart + `docker inspect` shows `Mounts` array empty; smoke test catches |
| Migration introduces new singleton (memoization mistake) | Helper is pure function, no global cache; each call re-reads |

## §8 Rollback for migration follow-up

Each per-service migration PR ships with rollback: revert the commit,
service picks up old `${VAR}` env again. No data loss (secret values
unchanged in Coolify Variables — file mount is a parallel access path).

## §9 Related WPs

- **WP 3.5** JWT revocation — orthogonal (session lifecycle)
- **WP 3.6** MFA for admin/staff — orthogonal (auth factor)
- **WP 3.8** Trivy + cosign + SBOM — complements (supply chain)
- **WP 4.7** Sentry PII filter — orthogonal (observability layer)
- **WP 19+** Vault for rotation-without-restart — parking lot, post-Phase 5

## §10 References

- Coolify v4 Variables docs: <https://coolify.io/docs/knowledge-base/environment-variables>
- Docker secrets reference: <https://docs.docker.com/engine/swarm/secrets/>
- `feedback_bootstrap_creds_generator_pushes.md` (memory file)
- `feedback_no_infra_in_repo.md` (memory file)
- `aisha/db/sql/tables/audit_journal.sql` — audit pattern for secret
  reveal events (mirror to `secret_access_audited` future RPC?)
