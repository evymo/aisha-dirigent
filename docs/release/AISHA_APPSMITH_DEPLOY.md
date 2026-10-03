# AISHA Appsmith artifact deploy — operator runbook

> **Status:** wired (2026-05-19).
> **Audience:** AISHA platform admins / release operators.
> **Canonical builder:** `scripts/build-aisha-appsmith.mjs`.

## What this covers

Every Appsmith artifact in the repo flows through one builder:

```
appsmith/dashboards/<slug>.template.json   ← whole Appsmith applications
appsmith/pages/<slug>.template.json        ← individual pages inside an existing app
       │
       ▼
scripts/build-aisha-appsmith.mjs
       │
       ├─ Mustache substitution (env vars → datasource configs)
       ├─ Widget catalog render (for dashboards using _widgetSlots)
       ├─ SHA-256 content hash
       ├─ Compare to last published via get_last_dashboard_hash(p_dashboard_slug)
       ├─ If unchanged → store_dashboard_hash(skipped_no_change), exit
       └─ If changed → write dist/appsmith/<slug>.json + store_dashboard_hash(pending)
```

The hash-check + storage tables (`dashboard_renders`) already accept any slug
— **no schema change** was needed to extend to per-page artifacts.

## Repository artifacts (as of 2026-05-19)

| Kind | Slug | Template path | What it ships |
|---|---|---|---|
| dashboard | `aisha-ops` | `appsmith/dashboards/aisha-ops.template.json` | Top-level Appsmith app with Overview, Per-Story, n8n, Sentry, Langfuse, Logs, Actions, Self-Tooling pages |
| page | `aitg-automation-control` | `appsmith/pages/aitg-automation-control.template.json` | AITG cadence control page inside AISHA Ops |
| page | `playwright-qa` | `appsmith/pages/playwright-qa.template.json` | Playwright E2E run queue + approve + report-view inside AISHA Ops |

## How to run

### Render all artifacts (dry-run; safe)

```bash
node scripts/build-aisha-appsmith.mjs --dry-run
```

Output goes to `dist/appsmith/*.json`. The hash store is not touched.

### Render one artifact

```bash
node scripts/build-aisha-appsmith.mjs --slug playwright-qa
```

### Live render (writes to dist/appsmith/ + stores hash)

```bash
node scripts/build-aisha-appsmith.mjs
```

### Force re-render (bypass hash-unchanged skip)

```bash
node scripts/build-aisha-appsmith.mjs --force --slug aisha-ops
```

## After running: importing into Appsmith

> **Current state (2026-05-19, A.1):** the builder writes rendered JSON to
> `dist/appsmith/<slug>.json`. The **actual Appsmith API import** (POST
> `/api/v1/applications/import/{workspaceId}` for dashboards, POST
> `/api/v1/pages` for pages) is a known TODO carried over from the
> original ops-only builder. See the **A.2 follow-up** below.

### Manual UI import (current path)

1. Open Appsmith UI (`https://appsmith.backend.id3a.cz/` or equivalent).
2. Sign in as admin.
3. **Dashboards** (`aisha-ops`): navigate to your workspace → **Import** → upload `dist/appsmith/aisha-ops.json`. Appsmith replaces the application.
4. **Pages** (`playwright-qa`, `aitg-automation-control`): open the AISHA Ops application → **Pages** sidebar → **+ Add page** → paste the page JSON or use Appsmith's "Import page" if your version exposes it.
5. Verify the page's RPC queries resolve (open any widget that calls `list_playwright_runs` or `aitg_list_automations_audited`).

### A.2 follow-up: automated API import

Tracking the work to remove the manual step:

- Implement `import * as appsmithClient from "./lib/appsmith-client.mjs"` with:
  - `login(email, password) → cookieJar`
  - `findApplicationBySlug(workspaceId, slug)`
  - `importApplication(workspaceId, dashboardJson)` (multipart)
  - `upsertPage(applicationId, pageJson)` (POST or PUT)
- Wire `scripts/build-aisha-appsmith.mjs::processArtifact` to call the client when not in `--dry-run`.
- Gate test extends to assert the client is invoked when secrets are present.

This is intentionally split from A.1 because the Appsmith REST API surface
needs its own client + retry/idempotency design. Currently the builder
guarantees deterministic output + hash discipline; the API push is the
next layer.

## Adding a new artifact

1. Create `appsmith/dashboards/<your-slug>.template.json` or `appsmith/pages/<your-slug>.template.json`.
2. The template must declare:
   - For dashboards: `applicationName`, `applicationSlug`, `pageList`, optional `datasourceList`.
   - For pages: `pageName`, `pageSlug`, `queries`, `widgets`.
3. Run `node scripts/build-aisha-appsmith.mjs --slug <your-slug> --dry-run` to confirm it renders.
4. Add to `aisha-appsmith-importer.gate.test.ts` only if you want extra assertions beyond the default parity check (which already covers presence + canonical fields).
5. Commit. CI runs the gate test automatically.

## Failure modes & remediation

| Symptom | Likely cause | Fix |
|---|---|---|
| `RPC get_last_dashboard_hash: 401` | `AISHA_POSTGREST_SERVICE_KEY` missing or invalid | Set the env var or run from CI with secret injection |
| `Render failed for slot X` | Widget catalog missing the kind the slot references | Add `appsmith/widgets/<kind>.json` or fix the slot map in `build-aisha-appsmith.mjs` |
| `Hash check failed (will proceed)` | RPC unreachable but builder continues | Acceptable for cold-start; check `dashboard_renders` table after for the stored row |
| Builder reports `dry_run` but you wanted a real run | Drop the `--dry-run` flag | — |
| dist/appsmith/playwright-qa.json content is empty | Template lacked `widgets`/`queries` keys at top level | Add the missing keys to the template |

## Gate coverage

`src/tests/gates/aisha-appsmith-importer.gate.test.ts` asserts:

- Builder script exists at the canonical path.
- Builder walks both `appsmith/dashboards/` and `appsmith/pages/`.
- Builder distinguishes dashboard-kind vs page-kind artifacts.
- Builder uses existing `get_last_dashboard_hash` + `p_dashboard_slug` (no schema change).
- Builder has `--dry-run` and `--slug` flags.
- Every template parses + has canonical fields.
- No template references the obsolete `build-aisha-ops-dashboard.mjs` builder name.
- This runbook ships beside the builder + references the A.2 future-work caveat.

## Backwards compatibility

`scripts/build-aisha-ops-dashboard.mjs` was renamed to
`scripts/build-aisha-appsmith.mjs` in this change. Callers updated:

- `n8n/workflows/WF_APPSMITH_DASHBOARD_BUILDER.json` — points at new path.
- `scripts/provision-appsmith.sh` — points at new path.
- `.claude/skills/aisha-deploy-flow/SKILL.md` — references new path.
- `src/tests/gates/appsmith-dashboard.gate.test.ts` — `BUILDER_SCRIPT` constant updated.

No deprecation shim is kept — per repo policy (`feedback_no_workarounds_rewrite_dont_remove`),
the canonical name moves and all callers move with it.
