# AISHA packages auto-publish — operator runbook

> **Status:** wired (2026-05-18).
> **Audience:** AISHA platform admins / release operators.
> **Purpose:** every `@aisha/*` package whose workspace version is ahead of
> Verdaccio is rebuilt + republished automatically on every merge to `main`,
> so services declaring `"@aisha/<name>": "*"` always resolve to fresh code.

## Why this exists

PR #73 (playwright production integration) failed locally because
`packages/security/src/` had `constantTimeStringCompare` while Verdaccio's
published `@aisha/security` (`0.1.1`) didn't — the function had been added
in code but never published. Every service that consumes `@aisha/security`
via `"*"` was running the stale crypto primitives.

**This is a real supply-chain risk:** when security primitives drift
silently behind the workspace, the production services can be missing
fixes that the codebase already shipped. The auto-publish loop closes
that gap by making the registry the canonical mirror of the workspace,
with no manual `npm publish` step to forget.

## Mechanism

```
push to main (paths: packages/**)
                │
                ▼
.github/workflows/aisha-packages-publish.yml   (opt-in: vars.VERDACCIO_URL)
                │
                ▼
scripts/aisha-packages-publish.mjs
                │
                ├─ walks packages/*/package.json
                ├─ picks publishable: private:false + publishConfig + build
                ├─ for each:
                │   ├─ GET https://npm.example.com/<name> → registered version
                │   ├─ if workspace > registered → npm run build + npm publish
                │   └─ else → skip (idempotent, no-op)
                ▼
        Verdaccio (npm.example.com) updated
                │
                ▼
        log_integration_action audit row
```

## Eligibility rule for auto-publish

A package in `packages/<name>/` is auto-published when **all four** hold:

| Check | What it means | If violated |
|---|---|---|
| `private` ≠ `true` | Owner consents to publish | Auto-publish skips silently |
| `publishConfig` present | Knows the target registry | Auto-publish skips silently |
| `scripts.build` present | Has a real artifact to ship | Auto-publish skips silently |
| Not `n8n-nodes-aisha` | That package has its own release pipeline (`scripts/n8n-release.mjs`) with extra coupling | Excluded by name |

The gate (`src/tests/gates/aisha-packages-publish.gate.test.ts`) enforces
that **any package consumed by a service via `"@aisha/X": "*"` must
satisfy the eligibility rule** — otherwise the service can't resolve
that dep on next `npm install`.

## How versioning works

The publish runner is **idempotent on version**:
- If `packages/<name>/package.json` version == latest published → skip
- If workspace version > published → build + publish
- If workspace version < published → skip with a warning

So the canonical workflow is:

1. Make changes in `packages/<name>/src/`
2. **Bump `packages/<name>/package.json` version** (patch by default)
3. Merge PR to main
4. Auto-publish workflow runs → Verdaccio has the new version
5. Services using `"*"` get the new code on their next `npm install`

If you forget step 2, the workflow runs but does nothing
(workspace version == published → skip). Symptom: the bug fix lives in
git but the registry still has the old code. **The gate test does not
catch this** — it can't infer intent from a workspace version that
matches Verdaccio. Discipline lives at PR review time.

A pre-commit hook could detect "modified `packages/X/src/*` without
modifying `packages/X/package.json` version" — that's an open follow-up
(see `feedback_aisha_capability_applied_not_new`: Aisha can wire this in
once we settle on the convention).

## Repository configuration (opt-in)

Publishing is OPT-IN: nothing in the platform build needs a private registry
(`@aisha/*` are npm workspaces built from source). The workflow's `publish` job
runs only in a repository that sets the variable `VERDACCIO_URL`; forks do not
inherit repository variables, so a fork never writes into someone else's
registry. Set them in **Settings → Secrets and variables → Actions**:

| Name | Kind | What it does |
|---|---|---|
| `VERDACCIO_URL` | variable | Registry URL — the opt-in switch |
| `VERDACCIO_USER` + `VERDACCIO_PASSWORD` | secrets (preferred) | Mint a fresh publish token per run (no 30-day expiry drift) |
| `VERDACCIO_TOKEN` | secret (fallback) | Static token with publish scope for `@aisha/*` |
| `AISHA_GATEWAY_URL` | secret (optional) | Used for the audit-log step at end of workflow |
| `POSTGREST_SERVICE_TOKEN` | secret (optional) | Same |

With `VERDACCIO_URL` set but no credentials the job warns and publishes
nothing (skipped, not failed). The token must have publish scope; the runner
queries the registry to detect already-published versions, so read scope is
also required (or the workflow will assume "never published" and try to
publish 0.0.0 → conflict).

## Manual runs

```bash
# Dry-run (no side effects) — preview what would publish
DRY_RUN=1 node scripts/aisha-packages-publish.mjs

# Live publish locally (requires VERDACCIO_TOKEN in env)
export VERDACCIO_TOKEN=<jwt>
node scripts/aisha-packages-publish.mjs
```

Or via GitHub: **Actions → AISHA Packages Publish → Run workflow** with
**Dry run** toggle (`gh workflow run aisha-packages-publish.yml -f dry_run=true`).

## Failure modes & remediation

| Symptom | Likely cause | Fix |
|---|---|---|
| Job `publish` is skipped | `VERDACCIO_URL` variable not set (opt-in) | Set the variable if this repository should publish |
| Run warns `publish skipped` | Registry set, credentials missing | Add `VERDACCIO_USER`+`VERDACCIO_PASSWORD` (or `VERDACCIO_TOKEN`) in repo settings → Secrets |
| Workflow runs but says "skipped" for every package | Workspace versions == published versions | If you intended a publish: bump version in the relevant `packages/<name>/package.json` |
| `registry returned 401` in script output | Token expired or wrong scope | Re-issue the Verdaccio token with `@aisha:*` publish scope |
| Workflow doesn't trigger after merge | `paths` filter mismatch (changes outside `packages/**`) | Trigger manually via `workflow_dispatch` |
| Service install fails with `404 @aisha/<name>` after merge | Package not yet on Verdaccio (workflow still running / failed) | Check workflow status; if failed, fix + re-run; if running, wait and re-install |
| Concurrent push during a publish run | Second run is queued by the `concurrency` group | Wait — versions are skipped if already published, so re-running is safe |

## Pre-commit version-bump guard (added 2026-05-19)

`scripts/aisha-packages-version-check.mjs` runs from `.husky/pre-commit`
and **fails the commit** when a contributor stages `packages/<pkg>/src/**`
changes without bumping `packages/<pkg>/package.json` version. Closes the
silent-failure loop: without this guard, the auto-publish workflow runs
post-merge but no-ops (idempotent on version match), Verdaccio stays
stale, and consumers using `"@aisha/<pkg>": "*"` keep installing the old
code — exactly the PR #73 failure mode.

Out-of-scope-on-purpose: changes to `dist/**`, `README.md`,
`tsconfig*.json`, or test files alone don't trip the guard. Only `src/**`
changes require a version bump.

Override for genuinely-no-op changes (e.g. comment-only refactors that
don't change emitted JS):

```bash
ALLOW_STALE_PACKAGE_VERSION=1 git commit -m "..."
```

Document the reason in the commit body when you use the override.

## Gate coverage

* `src/tests/gates/aisha-packages-publish.gate.test.ts` asserts:
  * runner script exists and contains the documented selection rule
  * the workflow exists, triggers on `packages/**`, plumbs `VERDACCIO_TOKEN`, and is opt-in
    (`vars.VERDACCIO_URL`, no repository name pinned)
  * **every `@aisha/X` that services consume via `"*"` is publishable**
  * runner is idempotent (version comparison, not blind republish)
  * runner has `DRY_RUN` escape hatch
  * **version-bump pre-commit check is wired into `.husky/pre-commit`** (added 2026-05-19)
  * version-check uses argv-form subprocess API (no shell injection surface)
  * version-check has the documented `ALLOW_STALE_PACKAGE_VERSION` override

The producer/consumer parity check is the heart of the gate: it catches
the exact failure mode that caused PR #73's pain — a package consumed
via `"*"` but not publishable (was `private:true` or missing
`publishConfig` or missing `build`).

## Out of scope / follow-ups

- **Cross-stack republish** — operator stack instances (the upstream
  Aisha stack, partner tenants, accounting offices) have their own Verdaccio. Right now this
  workflow targets only `npm.example.com`; per-stack mirrors are manual.
- **CVE rollback path** — when a security CVE is found in `@aisha/security`,
  the rollback today is "bump packages/security version, merge, wait for
  workflow". A dedicated emergency-publish path bypassing the
  merge-to-main gate would shorten MTTR.
