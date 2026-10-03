# Security Policy

We take the security of AISHA Platform seriously. This policy describes how to
report a vulnerability and what you can expect from us.

## Supported Versions

The platform is currently in the **alpha** stage. Only `main` is actively
supported. Once we cut versioned releases, this section will be updated with
a support matrix.

| Version | Supported          |
|---------|--------------------|
| `main`  | ✅                  |

## Reporting a Vulnerability

**Please do not open public issues for security vulnerabilities.**

### Preferred channel

Email **`security@evymo.com`** with:

- A clear description of the vulnerability
- Steps to reproduce (or a working PoC)
- The version / commit hash where you observed the issue
- Affected component (frontend, gateway, microservice, DB, infra, …)
- Your assessment of impact (data exposure, privilege escalation, RCE, etc.)
- Whether you would like public credit and under what name

If you do not receive an acknowledgement within **3 working days**, please
follow up via the repository's private security advisory channel.

### What happens next

| Phase                              | Target time          |
|------------------------------------|----------------------|
| Acknowledgement of report          | 3 working days       |
| Initial triage + severity rating   | 7 working days       |
| Status update cadence              | Weekly until closed  |
| Coordinated disclosure target      | 90 days from report  |

We aim to publish a CVE-style advisory once a fix is shipped, with credit
to the reporter unless they ask to remain anonymous.

### Severity

We use a CVSS-3.1-like rubric. As a rough guide:

| Severity  | Examples                                                                 |
|-----------|--------------------------------------------------------------------------|
| Critical  | Pre-auth RCE, full DB extraction, secret-store compromise                |
| High      | Auth bypass, IDOR with sensitive-data exposure, persistent XSS in admin  |
| Medium    | Reflected XSS, missing rate limit, sensitive-data leak in logs           |
| Low       | CSRF on non-state-changing endpoint, missing security header              |

## Scope

In scope:

- This repository's source code (frontend, services, packages, scripts)
- The supplied Docker images and `docker-compose*.yml` files
- The default Coolify deployment topology under `coolify/`
- The Postgres SoT under `aisha/db/`
- The VS Code extension under `extensions/aisha-dirigent/`

Out of scope:

- Third-party services we depend on (Keycloak, n8n, Stripe, etc.) — report
  upstream
- Issues only reproducible against modified forks
- Self-DoS via misconfiguration of optional components
- Vulnerabilities in alpha-stage features explicitly marked "experimental"
  in their docs (still useful — please report — but lower priority)

## Hardening Defaults

The platform ships with the following baseline hardening — if you observe
any of these are missing in your deployment, that itself is a security issue.
See [`docs/security/OWASP_ORCHESTRATOR.md`](docs/security/OWASP_ORCHESTRATOR.md)
for the canonical OWASP Top 10 runbook and per-category implementation
status.

- **A05** TLS 1.2+ on every external endpoint (Coolify-managed via Traefik)
- **A05** `@fastify/helmet` (HSTS, X-Frame, COOP/COEP/CORP, Referrer-Policy)
  on every service via `@aisha/security`
- **A05** CORS strict allowlist on every credentialed endpoint (no wildcards)
- **A07** Keycloak OIDC tokens with short TTLs, refresh rotation, JWKS-pinned
  verification, MFA enforcement (`acr >= 2`) on sensitive routes
- **A01** Row-Level Security (RLS) on every table holding user data; gap
  audit via `SELECT * FROM owasp_rls_coverage_report();`
- **A09** All sensitive RPCs end with `_audited` and write to `audit_journal`;
  cross-cutting security events via `log_security_event` RPC
- **A09** `safeError()` redaction in every logging path; `audit_journal`
  writes contain IDs only — never PII payloads
- **A03** Zod schema validation at every external boundary
  (`validateBody(schema, body)`)
- **A01** `SECURITY DEFINER` functions pinned with `SET search_path TO 'public'`
- **A04** Per-route rate limits via `routeRateLimit('auth'|'mutation'|
  'expensive'|'public')`, keyed by `auth.uid()` not IP alone
- **A10** Plugin sandbox isolated via `node:vm` + Docker isolation in
  `images/plugin-exec`
- **A10** Outbound URL allowlist via `createSsrfGuard()` with DNS-rebinding
  IP guard (rejects RFC1918, loopback, link-local, metadata)
- **A06** `npm audit --audit-level=high` matrix across every service in CI;
  weekly dependency updates by the in-repo updater (`scripts/aisha-deps-update.mjs`)
- **A08** CycloneDX SBOM per service + cosign keyless signing + SLSA L1
  provenance attestation on every release tag
- **A02** `requireSecret()` fail-fast loader rejects weak secrets at boot

## Coordinated Disclosure

We follow a 90-day coordinated disclosure default. If you need a different
timeline (e.g. because the issue is being actively exploited), say so in the
report — we will work with you.

We do not currently run a paid bug bounty, but we will publicly credit
reporters in the release notes of the preview that ships the fix.

## Hall of Fame

Reporters who have responsibly disclosed vulnerabilities will be listed here.
