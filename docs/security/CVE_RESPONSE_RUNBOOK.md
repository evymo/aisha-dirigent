# CVE response runbook — `@aisha/*` packages

> **Status:** wired (2026-05-19).
> **Audience:** AISHA platform admins / security operators / on-call.
> **Purpose:** define the canonical flow when a CVE is found in any
> `@aisha/*` package (especially `@aisha/security`), and the few CI
> escape hatches that exist for stuck recovery.

## The TL;DR doctrine

**A CVE fix is a release, not an emergency bypass.** The auto-publish
loop (PRs #92/#94/#105) makes "merge to main → published within minutes"
the normal path. A dedicated "emergency publish that bypasses review"
would violate `feedback_pr_workflow_no_force` and undermine the very
supply-chain discipline that defends against the next CVE.

What *is* needed:

1. **Speed of triage** — runbook so on-call doesn't have to invent the flow under pressure.
2. **Speed of merge** — focused review for `priority:cve` PRs, not full architectural review.
3. **One escape hatch** — the auto-publish workflow's `force` input recovers from
   a stuck workflow (Verdaccio half-published). **Not a merge bypass** —
   security fixes still flow through PR review per `feedback_pr_workflow_no_force`.

## End-to-end flow

```
0. CVE intel arrives (Snyk, npm audit, internal review, external report)
        │
        ▼
1. Triage (operator)
        │ — Severity? Affected versions? Exploit availability?
        ▼
2. Branch + fix (packages/<pkg>/src/)
        │
        ▼
3. Bump version (packages/<pkg>/package.json)
        │ — patch for fix, major if breaking (rare for CVE)
        ▼
4. Open PR with priority:cve label + the cve-response template
        │ — Auto-runs test:stack:full
        ▼
5. Focused review by SECURITY_REVIEWERS (single admin OK, no team)
        │
        ▼
6. Merge to main
        │
        ▼
7. .github/workflows/aisha-packages-publish.yml triggers automatically (opt-in: vars.VERDACCIO_URL)
        │ — Detects packages/** change → builds → publishes
        ▼
8. Verdaccio has fresh version. Services using "@aisha/<pkg>": "*"
   pick it up on next `npm install`.
        │
        ▼
9. Post-mortem entry in docs/security/CVE_HISTORY.md (created lazily
   the first time a CVE actually happens; not pre-empted here).
```

## Triage (step 1) — required fields

Before opening the PR, gather:

| Field | Source | Why it matters |
|---|---|---|
| **CVE ID** (e.g. `CVE-2026-1234`) | NVD / GitHub Advisory / Snyk | Audit trail |
| **Affected versions** | `npm view @aisha/<pkg> versions` | Sometimes only a subset is vulnerable |
| **Severity** | CVSS score | Decides patch vs major bump |
| **Exploit availability** | Reporter / public PoC | Decides how to phrase the changelog |
| **Mitigation in current code** | Manual review | Operators may already be safe via config |
| **Affected services** | Who consumes `@aisha/<pkg>`? Use the inventory in `docs/release/AISHA_PACKAGES_PUBLISH.md` | Decides whether downstream services need restart |

## Branch + fix (step 2-3)

```bash
git checkout -b fix-cve-2026-1234-aisha-security origin/main
# Edit packages/<pkg>/src/<file>
npm --prefix packages/<pkg> version patch --no-git-tag-version
# patch by default — major only if the fix is breaking
```

**Critical:** the pre-commit guard (`scripts/aisha-packages-version-check.mjs`,
PR #105) requires a version bump alongside any `src/**` change. CVE fixes
*always* qualify — the guard will catch you if you forget the bump.

## PR template

Use `.github/PULL_REQUEST_TEMPLATE/cve-response.md` (append `?template=cve-response.md`
to the compare URL, or pick it when opening the PR). Required fields:

```markdown
**CVE ID:**
**CVSS:**
**Affected versions:**
**Fix summary (technical):**
**Operator action required:**  (e.g. "redeploy svc-X" / "none")
**Disclosure embargo expires:**
```

The auto-merge bot can be configured to recognize the `priority:cve`
label and apply a fast-track ruleset (skip non-security gates, require
1 reviewer instead of 2). This is documented as a configurable knob
in `docs/security/SECURITY_REVIEWERS.md` — not enabled by default.

## Step 7 — what to expect from the workflow

Normal CVE PR merge → `aisha-packages-publish.yml`:

1. Detects `packages/**` change in the merged commit.
2. Walks `packages/*` looking for publishable entries (private:false +
   publishConfig + scripts.build).
3. For each: compares workspace version to `npm view @aisha/<pkg> version`.
4. If workspace ahead → builds + publishes.
5. Audits the publish event via `log_integration_action`.

**Typical duration**: 60-180 seconds end-to-end.

## The `force` escape hatch — when to use it

The workflow exposes a `force: bool` input via `workflow_dispatch`:

```
GitHub → Actions → AISHA Packages Publish → Run workflow
  → force: true
# or: gh workflow run aisha-packages-publish.yml -f force=true
```

**Only legitimate use:** a prior workflow run left Verdaccio in a
half-published state (the publish step ran but tar.gz upload failed
mid-way; registry returns 404 for the version but workspace pkg.json
already shows the bumped value, so a normal re-trigger skips because
"workspace == published"). With `force=true`, the runner:

- Adds `--force` to `npm publish` (Verdaccio overwrites the broken artifact)
- Logs `FORCE=1 — version-skip optimization bypassed (CVE recovery mode)` to stderr
- Otherwise runs identically to a normal publish

**Not** a legitimate use:
- Skipping PR review for a security fix — that's a `feedback_pr_workflow_no_force` violation
- Republishing a version that's known-good already on Verdaccio — wastes registry storage
- Routine "just rebuild everything" — that's what `--dry-run` previews are for

Both inputs are also gated by `aisha-packages-publish.gate.test.ts` —
new in this PR — so a future change can't silently remove them.

## Verification post-publish

```bash
# 1. Confirm new version on Verdaccio
npm view @aisha/<pkg> version

# 2. Force-refresh any service's @aisha/<pkg> cache
cd services/<svc>/ && rm -rf node_modules/@aisha/<pkg> && npm install
node -e "console.log(require('@aisha/<pkg>/package.json').version)"
# → expected: <new-version>

# 3. Restart service (if affected service runtime needs a restart to pick up
#    the new code — most do for ESM cache reasons)
docker compose -f docker-compose.coolify.yml restart <svc>
```

## Failure modes & remediation

| Symptom | Likely cause | Fix |
|---|---|---|
| Workflow runs but registry still has old version | Verdaccio publish step failed silently | Use `force=true` via workflow_dispatch |
| `npm view` returns old version on operator instance | Operator's local Verdaccio cached the old version | After per-stack uplink is configured (PR #121), refresh: `npm cache clean && npm view @aisha/<pkg>` |
| Service still runs vulnerable code after publish | Service cached `node_modules` | Rebuild the service container (`docker compose build <svc>`) |
| `force=true` workflow exits 1 with auth error | Token expired or wrong scope | Re-issue VERDACCIO_TOKEN secret with publish scope |
| Pre-commit version guard refuses commit | You forgot to bump `packages/<pkg>/package.json` | `npm --prefix packages/<pkg> version patch --no-git-tag-version` then re-stage |

## Gate coverage

`src/tests/gates/aisha-packages-publish.gate.test.ts` asserts the
workflow + runner support the CVE-recovery `force` input:

- Workflow declares `inputs.force` with `type: boolean` and the canonical description
- Workflow plumbs `inputs.force` to runner via `FORCE` env var
- Runner script honours `FORCE === '1'` to bypass `cmp <= 0 → skip`
- Runner passes `--force` to `npm publish` when in FORCE mode
- Runner logs an unmissable warning when FORCE is active
- This runbook ships beside the workflow

## Out of scope (and why)

- **CVE_HISTORY.md** — not pre-created; the first real CVE owns the
  template. Premature templating produces stale shape.
- **Auto-merge of `priority:cve` PRs** — knob exists in SECURITY_REVIEWERS.md
  but disabled by default. Auto-merging security fixes feels right but
  often hides regressions that a human would catch.
- **Bypass-merge-to-main for security** — explicitly rejected. Every
  CVE fix flows through PR review, full-stop. Speed comes from focus +
  smaller-PR scope, not from bypass.
