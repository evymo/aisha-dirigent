# OWASP Top 10 — AISHA Orchestrator Runbook

> **Status:** Implementation complete (2026-05-16).
> **Scope:** Every Fastify service + Gateway + ws-gateway + event-worker + PostgREST/SQL layer.
> **Owner:** Platform Security.

This document is the single canonical reference for OWASP Top 10 (2021)
hardening across the entire AISHA orchestrator. **Operating principle:**
all data is treated as sensitive by default. There is no "low security
service" tier — the same primitives apply uniformly because the value of
data flowing through any service is not knowable at design time.

The runbook also defines the **tests-first workflow**: every OWASP control
is expressed as a test (unit test for the primitive, discovery gate for
adoption). Tests are the source of truth — the implementation follows
them, and CI surfaces gaps that humans would otherwise miss.

---

## Architecture summary

All security primitives live in **`packages/security/`** (`@aisha/security`),
imported uniformly across every service:

| Module | OWASP | Purpose |
|---|---|---|
| [`logger.ts`](../../packages/security/src/logger.ts) | A09 | `safeError/Warn/Info` + automatic PII redaction |
| [`audit.ts`](../../packages/security/src/audit.ts) | A09 | `createPostgrestAuditEmitter` → `log_security_event` RPC |
| [`cors.ts`](../../packages/security/src/cors.ts) | A05 | Strict allowlist CORS, no wildcards for credentialed routes |
| [`helmet.ts`](../../packages/security/src/helmet.ts) | A05 | HSTS, X-Frame, X-Content-Type, COOP/COEP/CORP, Referrer-Policy |
| [`rateLimit.ts`](../../packages/security/src/rateLimit.ts) | A04 | Tier-based per-route limits (auth / mutation / expensive / public) |
| [`jwt.ts`](../../packages/security/src/jwt.ts) | A07 | JWKS-pinned JWT verify + MFA (`acr`) + session-age (`auth_time`) |
| [`ssrf.ts`](../../packages/security/src/ssrf.ts) | A10 | Scheme + host allowlist + DNS-rebinding IP guard for outbound `fetch` |
| [`errors.ts`](../../packages/security/src/errors.ts) | A03/A05 | `validateBody(zodSchema)` + `toPublicError` (no internal leaks) |
| [`secrets.ts`](../../packages/security/src/secrets.ts) | A02 | `requireSecret` fail-fast loader + rotation manifest |
| [`applySecurity.ts`](../../packages/security/src/applySecurity.ts) | — | Single-call wrapper (helmet + cors + rate-limit + error handler) |

A01, A06, A08 are enforced **outside** the package:

- **A01 Broken Access Control** — PostgreSQL RLS + `SECURITY DEFINER` RPCs in
  `aisha/db/sql/`. Self-audit via [`owasp_rls_coverage_report()`](../../aisha/db/sql/functions/owasp_rls_coverage_report.sql).
- **A06 Vulnerable & Outdated Components** — [`.github/dependabot.yml`](../../.github/dependabot.yml) + the matrix
  `npm audit` job in [`dependency-security.yml`](../../.github/workflows/dependency-security.yml).
- **A08 Software & Data Integrity** — CycloneDX SBOM + cosign keyless signing
  + SLSA provenance via [`container-signing.yml`](../../.github/workflows/container-signing.yml).

---

## Wiring a new service

Every new Fastify service under `services/*` MUST:

1. Add deps in `package.json`:
   ```json
   "@aisha/security": "*",
   "@fastify/cors": "^11",
   "@fastify/helmet": "^12",
   "@fastify/rate-limit": "^10"
   ```
2. Add OWASP fields to `src/config.ts`:
   ```ts
   corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
   ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
   rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
   ```
3. Wire `applySecurity()` first in `src/server.ts`:
   ```ts
   import Fastify from 'fastify';
   import { applySecurity } from '@aisha/security';
   import { config } from './config.js';

   const app = Fastify({ logger: { level: config.logLevel }, trustProxy: true });

   await applySecurity(app, {
     service: 'svc-myservice',
     cors: { allowlist: config.corsAllowlist },
     rateLimit: { enabled: config.rateLimitEnabled, max: 60, timeWindow: 60_000 },
     // skipErrorHandler: true,  // only if service has its own AuthError handler
   });
   ```

The umbrella gate test `src/tests/gates/owasp-orchestrator-adoption.gate.test.ts`
fails the build if any of these steps is missing.

---

## Per-category implementation status

### A01 — Broken Access Control

- **Mechanism:** PostgreSQL RLS (`relrowsecurity = true`) + `SECURITY DEFINER`
  RPCs with `REVOKE ALL FROM PUBLIC` + explicit `GRANT TO authenticated/anon`
  per CLAUDE.md "Absolutní pravidla". All client access goes through the
  `rpcService<T>()` / `rpcUser<T>()` adapter in [`postgrest.ts`](../../services/svc-ai-chat/src/postgrest.ts) — direct
  `.from(table).select()` is banned.
- **Self-audit:** `SELECT * FROM owasp_rls_coverage_report();` lists every
  `public.*` table with `has_rls`, `is_force_rls`, `policy_count`, and
  `gap_reason`. Admin-gated.
- **Status:** ✅ 278 RLS policies + 1089 SECURITY DEFINER functions live.

### A02 — Cryptographic Failures

- **Mechanism:** TLS 1.2+ enforced by PostgREST + Traefik edge. Secrets loaded
  via `requireSecret(envName, { minLength: 16, service })` which fails-fast on
  weak values (`changeme`, length < 16). Secrets never logged — only
  `fingerprintSecret()` (SHA-256 truncated).
- **Rotation:** `RotationManifest` per service; cadence default quarterly.
  Procedure: regenerate via `scripts/provision-sso.sh` style, push via Coolify
  `/envs/bulk` PATCH (see `feedback_bootstrap_creds_generator_pushes.md`).
- **Status:** ✅ shared primitives live; per-service manifests are an open
  follow-up (track in OWASP_ORCHESTRATOR_FOLLOWUPS.md).

### A03 — Injection

- **Mechanism:** Zod validation at every external boundary via
  `validateBody(schema, req.body)`. PostgREST parameterised queries (no string
  concat anywhere; banned by `gate/codebase-security-patterns.gate.test.ts`).
- **Status:** ✅ Zod used in 11+ services; gate test enforces no raw SQL string
  concatenation.

### A04 — Insecure Design

- **Mechanism:** Per-route rate-limit tiers (`auth`/`mutation`/`expensive`/`public`)
  via `routeRateLimit(tier)`. Global fallback at 100/min. Key derivation
  prefers `auth.uid()` over IP (`keyByUserOrIp`) so abuse from a single user
  behind NAT is bounded.
- **Status:** ✅ `applySecurity` registers global limit on every service; tier
  overrides per-route as needed.

### A05 — Security Misconfiguration

- **Mechanism:** `@fastify/helmet` with HSTS (1y + subdomains + preload),
  COOP/COEP/CORP, X-Frame-Options=DENY, Referrer-Policy=no-referrer. CORS
  via strict allowlist (no wildcards on credentialed routes). Default-deny
  error handler from `toPublicError()` strips internal stack frames.
- **Status:** ✅ helmet on every service; gateway uses bespoke CORS but still
  registers helmet via `buildHelmetOptions`.

### A06 — Vulnerable & Outdated Components

- **Mechanism:** Dependabot weekly PRs (Monday 04:00 Europe/Prague), grouped
  by ecosystem. `npm audit --audit-level=high` matrix across every service
  in CI. Container base images via Dependabot `docker` ecosystem.
- **Status:** ✅ Dependabot config + audit matrix live.

### A07 — Identification & Authentication

- **Mechanism:** Keycloak OIDC + JWKS verification via `createJwtVerifier()`.
  MFA enforced via `enforcePolicy({ requireMfa: true })` for sensitive routes
  (checks `acr >= 2`). Session age via `enforcePolicy({ maxAuthAgeSec: 1800 })`
  for PHI flows. Service-role tokens compared in constant time via
  `verifyServiceRole()`.
- **Status:** ✅ verifier shared; per-service adoption tracked by umbrella gate.

### A08 — Software & Data Integrity Failures

- **Mechanism:** CycloneDX SBOM generated per service in `dependency-security.yml`,
  uploaded as 90-day-retention artifact. Container images signed with cosign
  keyless OIDC + SLSA L1 provenance + CycloneDX attestation in
  `container-signing.yml`. Verification at deploy time:
  ```bash
  cosign verify \
    --certificate-identity-regexp 'https://github.com/.+/aisha-orchestrator/.*' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    ghcr.io/<repo>/<service>:<tag>
  ```
- **Status:** ✅ workflows live; integration with deploy verification is an
  open follow-up.

### A09 — Security Logging & Monitoring Failures

- **Mechanism:** Two tiers:
  - Operational logs → `safeError/Warn/Info` with automatic PII/secret
    redaction (`redact()`). Output stays in stdout/Sentry.
  - Compliance logs → `createPostgrestAuditEmitter()` → `log_security_event`
    SECURITY DEFINER RPC → `audit_journal` table with `area='security'` and
    `tags=['owasp', outcome, service]`.
- **Status:** ✅ shared primitives + RPC live; per-service integration ongoing.

### A10 — Server-Side Request Forgery

- **Mechanism:** `createSsrfGuard({ hostAllowlist, allowInternalNetworks })`
  returns a `safeFetch` wrapper that:
  1. Validates URL scheme (https only by default).
  2. Validates hostname against allowlist (`*.suffix.example.com` supported).
  3. Resolves DNS and rejects RFC1918/loopback/link-local/metadata IPs.
  4. Follows redirects itself (max 5 hops, checks 1–3 on every hop) under
     `planRedirect`: to another origin only `accept`/`accept-language`/
     `user-agent` travel (no credentials); 303 and non-GET/HEAD 301/302 become
     GET without body; 307/308 with a body to another origin are returned
     unfollowed; https → http is refused. `init.redirect` keeps its fetch
     meaning (`manual` returns the 3xx, `error` rejects).
  Allowlists per service via `SSRF_HOST_ALLOWLIST` env (e.g., `api.openai.com,
  api.anthropic.com`).
- **Status:** ✅ guard available; services should migrate `fetch(externalUrl)`
  to `safeFetch(externalUrl)` over time (track follow-ups).

---

## Verification & operational queries

### Confirm a service emits audit events

```sql
SELECT created_at, action, severity, details->>'service' AS svc, tags
FROM audit_journal
WHERE 'owasp' = ANY(tags) AND details->>'service' = 'svc-ai-chat'
ORDER BY created_at DESC LIMIT 50;
```

### Spot RLS gaps

```sql
SELECT * FROM owasp_rls_coverage_report() WHERE gap_reason IS NOT NULL;
```

### Verify a deployed image signature

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/.+/aisha-orchestrator/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/<repo>/svc-ai-chat:v1.2.3
```

### Run the umbrella gate locally

```bash
npm run test:gates -- src/tests/gates/owasp-orchestrator-adoption.gate.test.ts
```

---

## Open follow-ups

| Item | Owner | Priority |
|---|---|---|
| Per-service `RotationManifest` for A02 secret rotation | Platform | P2 |
| Migrate outbound `fetch()` calls in svc-ai-chat to `safeFetch` (A10) | Platform | P2 |
| Add `requireMfa: true` policy to admin RPCs in svc-ai-chat (A07) | Platform | P1 |
| Wire `log_security_event` emission into JWT failure paths (A09) | Platform | P1 |
| Add per-route `routeRateLimit('auth')` to login/refresh endpoints (A04) | Platform | P2 |
| Deploy verification: `cosign verify` gate in deploy scripts (A08) | DevOps | P1 |

---

## References

- OWASP Top 10:2021 — https://owasp.org/Top10/
- OWASP ASVS 5.0 — https://github.com/OWASP/ASVS
- Sigstore cosign — https://docs.sigstore.dev/cosign/overview/
- CycloneDX spec — https://cyclonedx.org/specification/overview/
- SLSA provenance — https://slsa.dev/spec/v1.0/provenance
- Repo-level security policy & disclosure: [SECURITY.md](../../SECURITY.md)
- Hardening defaults summary: [docs/security/SECURITY.md](SECURITY.md)
