# Audience Module

Universal audience management for the aisha platform — a non-invasive extension
that surfaces a polymorphic **actor + tag + tier** model on top of aisha's
existing entities (`profiles`, `partner_profiles`, `story_entries`, …). Operators
get a contact directory, cohorts, follow-ups, engagement metrics and an AI lens
over each actor.

The module reads aisha's **own** data and is fully useful on a standalone aisha
stack. Optionally, a **source broker** (`svc-source-broker`) enriches engagement
metrics from an external backend — the first source is source-api, but any
backend (e.g. AdWords) plugs in the same way. The source is one optional
parameter, not a dependency.

## What lives where

```
aisha (this repo)
├── docs/audience/                           ← canonical docs (you are here)
│   ├── README.md                            ← this index
│   ├── ARCHITECTURE.md                      ← system overview + data flow
│   ├── UNIVERSAL_MEMBER_MODEL.md            ← tier semantics (foundational)
│   ├── MARKETER_GUIDE.md                    ← what the module is, for operators
│   ├── MARKETER_FLOW_WALKTHROUGH.md         ← step-by-step UX trace
│   ├── V4_VERIFICATION.md                   ← live feature-verification matrix
│   └── ops/                                 ← runbooks (federation, grant model,
│                                               seam pattern, source PG setup)
├── aisha/db/migrations/*audience*.sql        ← audience module migrations
├── services/svc-source-broker/               ← Fastify source-broker microservice
├── packages/audience-types/                  ← TypeScript domain types + tests
├── appsmith/dashboards/audience.template.json ← native Audience dashboard
└── appsmith-templates/audience/              ← starter dashboard templates
```

Operational orchestration lives in a sibling repo `_platform/` (compose overlay,
Makefile targets, one-time setup helpers).

## Reading order

**Operator / product:**
1. **MARKETER_GUIDE.md** — what the module is and how an operator uses it
   (tiers, tags, cohorts, follow-ups)
2. **MARKETER_FLOW_WALKTHROUGH.md** — concrete step-by-step UX trace

**Engineer:**
3. **ARCHITECTURE.md** — 5-minute mental model
4. **UNIVERSAL_MEMBER_MODEL.md** — tier semantics (anonymous → partner)
5. **ops/SEAM_PATTERN.md** — integration-boundary (ACL) pattern for data sources
6. **ops/OPS_RUNBOOK.md** — how to deploy / debug live

## Key design principles

- **Aisha owns everything**. The external source stays untouched (read-only
  contract via a dedicated postgres role only); all aggregation logic lives in
  the broker (consumer-owned).
- **No new schema namespace**. `audience_*` prefix on views/RPCs/tables rather
  than a separate schema — simpler grants, easier upstream.
- **Reuse aisha tables**. Of 5 originally-planned new tables, only
  `signal_tag_rules` survived: tags ride on `story_labels`, cohorts on
  `studies`, assignments on `study_consultants`, engagement on
  `user_engagement_metrics`.
- **Operator admin = Appsmith intranet**. No custom React admin pages — the
  native `audience` dashboard + the starter templates import into a hosted
  Appsmith instance.
- **12-factor broker config**. All credentials in env vars; no secret vault for
  service accounts.

## Status snapshot

| Surface | State |
|---|---|
| Migrations | applied to live aisha-db (idempotent / defensive) |
| Source-broker microservice | healthy (scheduler + circuit breaker) |
| Vitest tests | broker + audience-types green |
| Webhook pipeline | E2E verified (signed payload → tags via `story_labels`) |
| Native Audience dashboard | renders via `build-aisha-appsmith.mjs` |

See **ops/OPS_RUNBOOK.md** for live deployment steps.
