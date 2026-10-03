# Marketer Flow Walkthrough

Concrete UX trace of how a marketer/operator uses the audience module via
the Appsmith intranet. This is the R5 deliverable from the original plan —
it grounds the abstract `audience_*` schema in a tangible day-in-the-life
scenario.

The marketer is **Bob's manager Alice**. Bob is an active source-api user
(events created, audience growing). Alice's goal: nudge Bob from "qualified"
tier toward "partner" tier by scheduling a 1:1 follow-up call.

## Prerequisites

- Appsmith instance running (see `ops/OPS_RUNBOOK.md` step 4)
- Templates from `appsmith-templates/audience/` imported (see `appsmith-templates/audience/DEPLOY.md`)
- Alice has aisha admin/staff role + the `manage_actor_audience` permission
  (seeded by migration `20260523200000_audience_permission_codes.sql`)
- At least one sync tick has run, so Bob's row exists in
  `user_engagement_metrics`

## Scenario 1: Triage today's prospects

### Step 1.1 — Alice lands on Contact Directory

Opens Appsmith app "Audience: Contact Directory" (template
`contact-directory.json`).

Behind the scenes:
- Appsmith calls `GET /audience_admin_contact_directory_v?order=last_active_at.desc.nullslast&limit=50`
- View JOINs `profiles + user_engagement_metrics + audience_actor_tier_v + story_labels (where resource_type='actor')`
- RLS policy `staff_admin_read_events` lets Alice see all rows (she's
  authenticated + admin)

She sees a flat list:
```
Name           Tier        Last active   Tags                  Assigned to
Bob Adams      qualified   2 hours ago   yoga, retreat-2026    Alice
Carol Mei      active      yesterday     -                     —
…
```

### Step 1.2 — Alice clicks "Bob Adams" row

Opens the actor detail drawer (template-internal navigation,
`AdminAudienceActorDetail` page).

Behind the scenes:
- `GET /audience_admin_actor_detail_v?user_id=eq.<uuid>` (composite view)
- Returns: profile + partner_profiles + memberships + tier + recent
  communications + active role_assignments + engagement metrics +
  active cohort memberships

Alice sees:
- Bob's profile (display name, joined date, last_active_at)
- Tier badge: **qualified** (derived by `audience_derive_actor_tier()`:
  partner_profiles row + ≥1 event created + ≥10 unique attendees in 30d)
- Engagement: 30/30 day app accesses, audience size 47 (+12 in 30d)
- Tags: "yoga" (manual), "attended_event" (auto via signal rule), "engaged"
  (auto), "retreat-2026" (manual)
- Communications timeline (last 10): "Welcome email" (90d ago, opened),
  "March newsletter" (15d ago, opened+clicked)
- No active follow-up

### Step 1.3 — Alice schedules a follow-up call

Clicks "Schedule follow-up" button. Modal opens:
- Due date: in 3 days
- Note: "Call about partner upgrade — discuss 2026 retreat sponsorship"
- Assign to: Alice (default)

Submit → Appsmith calls
`POST /rpc/audience_admin_create_followup` with `(actor_id, due_at, note,
assigned_to)`.

Behind the scenes:
- RPC inserts a row in `ai_tasks` (task_type='follow_up', assigned_to=Alice's
  user_id, due_at=now+3d)
- Logs to `audit_journal` (area='crm_ops', action='create_followup')

Toast: "Follow-up scheduled for Mar 26, assigned to you."

### Step 1.4 — Alice tags Bob with "potential-partner"

Inline tag input on actor detail. Types "potential-partner", hits Enter.

Behind the scenes:
- Appsmith calls `POST /rpc/audience_tag_resource` with
  `(tag='potential-partner', resource_type='actor', resource_id=<bob_uuid>)`
- RPC inserts row in `story_labels` (polymorphic — same table used for
  story tags, event tags, etc.)
- ON CONFLICT DO NOTHING → idempotent

## Scenario 2: See "my queue"

### Step 2.1 — Alice opens Follow-up Queue

Switches to template "Audience: Follow-up Queue" (template
`followup-queue.json`).

Behind the scenes:
- `GET /audience_admin_followup_queue_v?assigned_to=eq.<alice_uuid>&order=due_at.asc`
- View JOINs `ai_tasks + profiles + audience_actor_tier_v + audience_actor_overlay_v`

She sees:
```
Due in       Actor            Tier        Note                                Tags
Today        Frank Costa      registered  "Onboard Q&A"                       cohort-2026
Today        Grace Lin        active      "Renewal reminder"                  yoga
3 days       Bob Adams        qualified   "Call about partner upgrade…"       potential-partner, yoga
1 week       Hannah Watt      partner     "Quarterly check-in"                vip
```

### Step 2.2 — Alice completes Frank's task

Clicks Frank → calls happens off-platform → marks task complete.

Appsmith: `POST /rpc/audience_admin_complete_followup` (would be added; for
now alice updates via PATCH on ai_tasks). Row removed from queue view (view
filter: `WHERE completed_at IS NULL`).

Logged to `audit_journal` (area='crm_ops', action='complete_followup').

## Scenario 3: Bulk operations on a cohort

### Step 3.1 — Alice creates a new cohort

Opens "Audience: Cohort Manager" (template `cohort-manager.json`).

Behind the scenes — cohorts are stored in existing `studies` table with
`study_type = 'marketing_segment'` (ENUM extended in migration
`20260523100500_audience_cohort_aliases.sql`). View `audience_cohort_overview_v`
aliases studies + counts + recent engagement.

Alice clicks "New cohort from filter". Modal:
- Name: "Yoga retreat 2026 invitees"
- Filter criteria: tier ≥ active AND tags contains 'yoga' AND audience_size > 20
- Auto-register matching actors: yes

Submit → `POST /rpc/audience_admin_create_cohort_from_filter`
with `(name, filter)` JSONB.

Behind the scenes:
- RPC inserts a row in `studies` (study_type='marketing_segment')
- For each matching actor (query against contact_directory_v):
  - Insert a row in `study_registrations` (linked to the new study + user)
- Logged in `audit_journal`

She sees the new cohort with row count: "37 actors registered."

### Step 3.2 — Alice sends test campaign to the cohort

In cohort detail, clicks "Send test campaign". Picks template "March yoga
retreat invite" from `notification_campaigns`.

Behind the scenes:
- `POST /rpc/audience_admin_send_test_campaign` with `(campaign_id, recipient_user_id=<self>)`
- RPC inserts in `openclaw_notifications` via `audience_route_campaign_to_openclaw()`
- Triggers existing aisha notification infrastructure — n8n scanner picks it
  up within 30s

Alice gets the test email in her inbox 30 seconds later, confirms layout
looks right.

### Step 3.3 — Alice schedules full campaign send

Opens "Audience: Campaign Performance" (template `campaign-performance.json`).
Picks the test campaign she just verified, clicks "Send to cohort".

Behind the scenes:
- Cross-product: each cohort registrant × each campaign channel
- For each (recipient, channel), RPC `audience_route_campaign_to_openclaw`
  inserts a row in `openclaw_notifications`
- Per-recipient delivery tracking flows into `notification_campaign_recipient`

## Scenario 4: AI-assisted prospect research

### Step 4.1 — Alice asks AI about Bob's profile

Back on Bob's detail page, sidebar has "AI Insights" button. Clicks it.

Behind the scenes:
- `POST /rpc/audience_start_actor_ai_session(focus_actor_id=<bob_uuid>, mode='research')`
- RPC creates a row in `chat_conversations` + `story_ai_sessions` (with
  `focus_actor_id` set)
- Returns `conversation_id`

A chat panel opens. Alice types: "Suggest a partner upgrade pitch tailored
to Bob."

Behind the scenes:
- aisha-llm-gateway receives the chat message
- Context profile `audience_ai_actor_assistant` (seeded by migration
  `20260523100400`) gates this AI mode: requires `manage_actor_audience`
  permission + tier ≥ qualified
- RAG retrieval filter: `WHERE source_type IN ('actor_overlay', 'audit_journal')
  AND metadata->>'actor_user_id' = '<bob_uuid>'` — pulls in Alice's notes,
  past communications, signal events about Bob
- LLM responds with a tailored pitch draft

Alice copies the draft into her email.

## Scenario 5: Marketer self-service via Appsmith customization

Six weeks in, Alice realizes she wants a new dashboard: "Members at risk"
— high-tier users whose `last_active_at` is >30 days old.

She doesn't ask engineering. In Appsmith:

1. Creates new query: `GET /audience_admin_contact_directory_v?tier=in.(qualified,partner)&last_active_at=lt.now()-30d`
2. Drops a Table widget bound to the query
3. Adds a "Send re-engagement campaign" button bound to
   `POST /rpc/audience_admin_send_test_campaign`
4. Saves as new page "At Risk"

No code change in any aisha repo. This is the entire point of the Appsmith
template architecture — the data substrate is rich enough that any analytical
view a marketer can dream up is one query + one widget away.

## What the marketer never sees

- The 12 SQL migrations
- The svc-source-broker microservice (it just works)
- The Keycloak Token Exchange handshake (happens at login)
- The HMAC-signed webhook ingestion (continuous background process)
- The scheduler's circuit breaker (only visible when source-api is down,
  and only as "no new data" — not as errors)

This is by design: the audience module is *operational substrate*. The
operator's mental model is "people, tags, follow-ups, campaigns". The fact that
it's polymorphic, federated, RLS-gated, idempotent, etc. is invisible at the
use-case level.
