# V4 — Live feature verification

Automated proof that the universal audience module covers its 30 operator
requirements, exercised against the **live** local aisha stack by walking the
operator demo flow (`MARKETER_FLOW_WALKTHROUGH.md` — Alice manages Bob).

```bash
make aisha-verify-features      # _platform/scripts/aisha-integration/verify-features.sh
```

**Result: 30 PASS · 0 FAIL · 4 GAP** (exit 0). Idempotent; re-runnable.

## What makes it faithful

The harness does not bypass security. Admin mutations run **through the
permission gate** exactly as Appsmith → PostgREST does: it sets
`request.jwt.claims` to Alice (admin) + `SET ROLE authenticated`, so every
SECURITY DEFINER RPC sees `auth.uid() = Alice` and enforces
`is_admin_or_staff` / `manage_actor_audience`. Member-scoped checks confirm Bob
is *not* admin.

It is also **dual-purpose**: each Alice action runs the real `audience_*` RPC and
**persists** (Bob gets tags, a follow-up, a cohort, an AI session), so the demo
data is observable in the Appsmith dashboard (V3). Mutations guard on existence,
so three runs leave exactly one of each.

## Coverage (30/30 implemented features verified live)

| Scenario | Features verified |
|---|---|
| Substrate | 16 views, 33 RPCs, tier-diverse seed (active 16 / registered 15 / qualified 5 / partner 4) |
| 1 — Triage | contact directory, engagement stats, tier RPC, tags (`tag_resource`), follow-up (`create_followup`), audit trail, timeline substrate |
| 2 — Queue | follow-up queue view, `ai_tasks` substrate |
| 3 — Cohorts | `create_cohort_from_filter` + register, cohort overview + unified marketing view, `bulk_tag`, per-recipient tracking columns, campaign-routing RPC |
| 4 — AI | tier-gated context profiles (6), `start_actor_ai_session(focus=Bob)` |
| 5 — Self-service | tier funnel, my-audience, creator stats, PostgREST grant surface |
| Pipeline | `signal_tag_rules`, `note_vectorize`, `broker_record_sync` |
| Security | member≠admin, admin=admin, no CRITICAL/HIGH grant findings |

## Bug found & fixed

**`partner_stories.partner_id` NOT NULL violation** (migration
`20260530120000_audience_partner_story_partner_id_fix.sql`). `partner_stories`
requires `partner_id` (FK → `partner_profiles`), but the story-per-actor code
inserted only `(user_id, title, …)`. Because `audience_audit_to_story_entry` is
an AFTER-INSERT trigger on `audit_journal`, the failure propagated and broke
**every admin RPC that logs an audit event** — `create_followup`,
`create_cohort_from_filter`, `bulk_tag`, `start_actor_ai_session`. The fix
derives `partner_id`; the trigger now **skips** story promotion for non-partner
actors (best-effort — the audit row is the system of record and must never be
broken by the side-effect), and the AI-session RPC raises a clear error for
non-partner actors. All four RPCs now pass through the Alice gate.

## Known gaps (honest — design notes, not failures)

| ID | Item | Why it's a gap, not a failure |
|---|---|---|
| ~~F2c~~ | ~~`complete_followup` RPC~~ | **CLOSED 2026-07-25** — `audience_admin_complete_followup` settles the beat and the compatibility `ai_tasks` row in one call. The workaround this row described was never real: `ai_tasks` carries own-read SELECT, own-create INSERT and service_role ALL, and **no UPDATE policy for `authenticated`**, so an operator's PATCH matched zero rows however the grants read. |
| ~~F18a~~ | ~~Contact-timeline attribution~~ | **CLOSED 2026-07-25** — operator actions now land on the SUBJECT's timeline authored by the operator, via the polymorphic axis (`subject_type='actor'`). The old behaviour had a root cause worth recording: the promotion could only build a `partner_story` for partner-tier actors, so for everyone else the record went to the acting admin or nowhere. The actor axis needs no story row at all. Proven live in `src/tests/db/twin-pulse-convergence.test.ts`. |
| ~~F28~~ | ~~Live source-api detail proxy~~ | **SUPERSEDED** by decision C (2026-07-05): three story-scoped routes (`/source/{story}/kpi \| engagement \| member`) run through the AISHA gateway with binding resolution, TTL cache and audit — see `services/svc-source-broker/docs/ONDEMAND_FEDERATION_STATUS.md`. The removed `proxy.ts` was not the last word on the live path. |
| F8 | openclaw outbox delivery | `openclaw_notifications` is a `WHERE false` **stub view** — the optional openclaw subsystem isn't deployed in this local instance. The routing RPC (`route_campaign_to_openclaw`) and channel validation are correct; only the terminal insert needs the real outbox table. |

## Personas (resolved dynamically from live data)

- **Alice** = `seed-admin@platform.local` (admin/staff, `manage_actor_audience`)
- **Bob** = first `qualified`-tier user with a `partner_profiles` row (Akiko Tanaka)
