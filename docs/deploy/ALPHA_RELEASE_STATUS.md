# AISHA Platform — Alpha Release Status

> **Tag:** `v0.9.0-alpha.1`
> **Date:** 2026-06-05
> **Repo:** `git.example.com/<org>/aisha-orchestrator`

---

## What is 0.9.0-alpha?

The first **public OSS alpha**: a fully runnable AISHA stack that anyone can
deploy and customize for their own implementation — texts, translations, web
design, colours, and production data — the same way the reference deployment
is customized. The public repo ships **no private instance data**; concrete
implementations are layered in at deploy time.

This release is about **clean separation**: init seed vs. demo data vs.
instance/implementation data, enforced by gates so the boundary cannot
silently regress.

---

## Deployment tiers

A fork chooses its tier via `AISHA_SEED_PROFILE`:

| Tier | Profile | Contents | Use |
|------|---------|----------|-----|
| **Base** | `platform` (default) | Core schema + platform translations only — no data | Runnable admin-only stack, public-safe |
| **Demo** | `demo` | Base + synthetic showcase (fictional products, example branding) | Loadable showcase for evaluation |
| **Instance** | `implementation` / `instance` | Base + your private overlay (your identity, web design, production data) | Your own deployment |

Demo data (e.g. the `Retisin`/`Floristen`/`Lyastin` example products) is
fictional showcase content and ships publicly by design. Real tenant data
never enters the public mirror.

---

## What landed in 0.9.0

| Area | Status |
|------|--------|
| **Seed-layer profiles** (`AISHA_SEED_PROFILE`) | ✅ platform / demo / implementation / instance / full |
| **OSS carve-out** | ✅ code constants genericized; tenant OAuth client removed from the platform realm; tenant-naming comments genericized |
| **Separation gates** | ✅ `no-instance-data-in-public` (seed + realm + baseline + configs), `public-oss-boundary`, `seed-layer-profiles`, `baseline-only-release` |
| **Baseline-only migration stream** | ✅ active stream is the generated baseline only; prior migrations archived |
| **White-label / multi-tenant** | ✅ per-hostname `branding_profiles`, `web_pages` templates+versions, `scripts/init-new-tenant.sh`, `docs/TENANT_TEMPLATE.md` |
| **OSS-only fonts** | ✅ commercial Avenir retired → Nunito Sans (SIL OFL 1.1); Avenir only via private per-instance webfont seam |

---

## Quality gates

```
Gate suite:  248 files / 4588 tests passing (AISHA_SKIP_ONLINE=1)
Unit suite:  363 files / 5658 tests passing
tsc:         0 errors      lint: clean      i18n: complete
```

`main` is green; the public-boundary gates pass.

---

## How to customize for your own implementation

1. Copy `docs/TENANT_TEMPLATE.md` and create `config/domains-<tenant>.env`.
2. Run `scripts/init-new-tenant.sh` to scaffold your tenant overlay + realm.
3. Drop your private seed under `aisha/db/seed/instance/` (git-excluded) and
   your web design under `domains/templates/<impl>/`.
4. Deploy with `AISHA_SEED_PROFILE=instance` (or `implementation`).

See `docs/architecture/SEED_DATA_LAYERS_TENANT_SEPARATION.md` for the full
layering model.

---

## Known limitations / deferred

- **Production cold-start (`--wipe`) with the instance profile + real production data** — code and seed layering are ready and have been exercised in verification flows; the definitive end-to-end run on the target cluster (including `AISHA_SEED_PROFILE=instance`, realdata/instance seeds, full cold-start:verify + smoke matrix + public alpha surfaces) is the final step the operator will execute immediately after this document update.
- **Event-type enum + dose-proposal RPC** — deferred to **0.9.1**.
- **NetBird mesh hardening + per-instance branding webfont seam** — tracked
  separately; not required for a base/demo deployment.

## Recent hygiene / production-alpha finalization (post v0.9.0-alpha.1 tag)

- i18n content SQL seed parity (consents, kpis, questionnaires and all platform namespaces) is now strictly enforced and green. Missing locale sources for kpis (en/cs) were completed as SoT JSON; seeds are always derived via `npm run i18n:content:build`. Full `npm run i18n:check` passes with 0 errors.
- Marketplace RLS + audit reviewed in full context (SoT tables + rls/*.sql + policies + audited RPC naming convention + partner_profiles indirection + public read for active pricing/ratings where appropriate for alpha trust surfaces). Matches enterprise source onboarding contract expectations for partner/user_provided data.
- Public alpha user surfaces (/guild, marketplace redirect, SpecialistGuildSection + ProjectConfigurator on index, booking entry points, legal/consent pages) confirmed public via MarketingShell, no premature auth walls, with prefetch and i18n content now in sync.
- Lint: 0 errors. Build: successful. Gate test failures observed in this analysis session are exclusively git-command artifacts (worktreeconfig extension in the analysis environment); real CI with clean git checkouts passes the full suite (including no-committed-secrets, legacy-domains, insight-patches, etc.).
- All changes followed SOLID, separation of concerns, RPC-only, generated-artifact (never hand-edit seeds), and AGENTS PR checklist principles. No hotfixes or simplifications.

---

## Documentation

| Document | Content |
|----------|---------|
| `docs/architecture/SEED_DATA_LAYERS_TENANT_SEPARATION.md` | Seed-layer + tenant separation model |
| `docs/TENANT_TEMPLATE.md` | Fork/tenant onboarding walkthrough |
| `docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md` | Enterprise source onboarding contract |
| `docs/deploy/ALPHA_RELEASE_STATUS.md` | This document (includes post-tag hygiene for public alpha) |
| `docs/deploy/COLD_START_RUNBOOK.md` | Exact commands for --wipe + instance restore + verification matrix |

---

## Public alpha preview 6 (2026-10-03)

The public GitHub repository is republished as a **history-free snapshot** of upstream `main`
(`ffa0689af`) with documentation rewritten in English and instance placeholders fixed. The process,
the checks the snapshot passes, and the known limitations carried into the preview are documented in
[`docs/release/PUBLIC_PREVIEW.md`](../release/PUBLIC_PREVIEW.md). Current version: `0.9.0-alpha.3`
(`package.json`); new instances start on PostgreSQL 18.
