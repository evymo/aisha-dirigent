# Mobile App — Comprehensive Capability Map & Build-out Plan

> Holistic analysis of what the mobile app **should** be, grounded in the **current `main`
> backend stack** (DB source-of-truth `aisha/db/sql`, `services/svc-*`, gateway route table).
> Generated 2026-06-02 from a parallel backend sweep; every RPC/table cited was verified to
> exist in `aisha/db`.

> Status update 2026-07-03: the mobile app now calls **63 distinct RPCs** plus gateway
> functions through the shared API client. The Kanban spine, story timeline, study
> questionnaires, admin metrics, entitlements, privacy, and Sentry monitor route-table
> wiring are present in code; this document remains the broader capability backlog.

## Headline

The mobile app calls **63 distinct RPCs**. The backend exposes a **member-facing surface of ~150+
functions** (verified counts in DB SoT: **79 `get_my_*`, 159 `*_audited`, 15 `submit_*`,
11 `*_mobile`**; ~1,259 functions total). The app now surfaces more of the production
spine, but entire backend-complete domains are still partially surfaced.

This is not "build new features" — per the platform's *capability-applied-not-new* rule, it
is **wiring existing backend capability into the app**. Where a genuine backend piece is
missing it is flagged as a backend story, not stubbed.

## The visibility / capability model (confirms the product vision)

> *"What we see is based on what we have access to; what we can and can't do is resolved
> logically by the backend; what we want is verified against the whole."* — confirmed.

Access is decided **server-side**, in layers, exactly as envisioned:

1. **Keycloak JWT** → roles (`admin`/`staff`/`member`) carried in `KcUser.roles` (already
   parsed by the app).
2. **RLS** (~715 policies) — row isolation (`user_id = auth.uid()`); admins get bypass policies.
3. **SECURITY DEFINER + REVOKE/GRANT** on ~all RPCs — members call functions that return only
   their own data; `is_admin_or_staff()` gates operator functions.
4. **Audit journal** (`write_audit_journal`, `*_audited` RPCs) — every PHI/sensitive read is logged.
5. **Rate limits**, **consent gates** (`study_consent_acceptances`, `data_sharing_consents`),
   **subscription tier** (`memberships.tier`), **product access** (`product_access`).

**Implication for the app:** it is a *pure renderer of backend truth*. It never needs its own
permission logic — it shows what the RPC returns (member sees their slice, admin sees more from
the same endpoints). This is the design contract for everything below.

---

## Domain capability map (vision pillar → backend → surfaced? → gap)

### 1. Stories = projects + **auto-populated Kanban** (the spine) — backend COMPLETE, app surfaces the core spine
The user's "auto-filled kanban that records what was done / how / when, automatically" **is the
real backend model**:
- **Tables:** `partner_stories` (status = kanban column, `last_activity_at`, `delivery_status`,
  `project_preview` jsonb), `workflow_statuses` (columns: `inbox → in_progress → blocked →
  review → done → archived`, i18n labels, swimlane colors), `workflow_status_transitions`
  (legal moves, role-gated), `story_entries` (manual timeline), `ai_trace_events`
  (auto: every LLM/tool/agent action), `integration_events` (auto: GitHub/Stripe/deploy
  webhooks → resolved to `story_id`), `rollback_history` (auto: blue/green switches).
- **Auto-population:** `story_timeline(story_id)` **UNIONs** ai_trace_events + rollback_history +
  bg_switch + manual entries → one merged, time-sorted feed. Events arrive via webhooks/agent
  runs and append automatically; a trigger bumps `last_activity_at`. **This is the "automatic
  kanban" — already built.**
- **RPCs:** `kanban_stories_view()` (one row/story + status metadata → swimlanes),
  `story_timeline()`, `update_story_status_audited()` (drag-drop, transition-validated),
  `get_allowed_kanban_transitions()`, `create_story_audited`, `toggle_story_star_audited`,
  `get_story_participants_audited`, `create_story_reminder_audited`, `get_integration_events_for_story`.
- **App today:** `kanban_stories_view` (swimlanes), `get_allowed_kanban_transitions`,
  `update_story_status_audited`, `get_story_detail_audited`, `story_timeline`, and
  `add_timeline_entry_audited`. Status transitions are queued for replay while offline.
- **Remaining gap:** richer per-card agent/deploy drilldown and broader automation controls.

### 2. Studies = clusters / areas of interest + questionnaires + cohort metrics — backend COMPLETE, app surfaces ~1 slice
- **Tables:** `studies` (umbrella/child tree, `target_condition`, `products[]`, funding),
  `study_registrations` (enrollment status, arm/group, baseline), `study_questionnaires`
  (scheduled: daily/weekly/monthly + rewards), `questionnaire_responses`, study-linked real data
  (`health_check_ins`, `lab_results`, `dosing_logs`), cohort views (`study_cohort_statistics`,
  `_trends`, `_lab_trends`; Safe-Harbor n≥5), `study_consent_items/_acceptances`, `study_ratings`,
  `study_contributions`, `study_consultants`.
- **RPCs (member):** `get_study_questionnaires_mobile()` ← **the primary mobile study endpoint**
  (frequency/availability/due-dates/rewards, pending vs completed), `enroll_in_study()`,
  `get_my_study_registrations()`, `get_study_detail()`, `get_umbrella_study()`,
  `get_combined_study_consents()` + `submit_study_consent_acceptance()` + `get_my_consents()`
  (full informed-consent flow), `submit_study_rating()`, `get_my_contributions()`.
  Research/operator: `get_study_cohort_statistics/_trends/_lab_trends`.
- **App today:** `useQuestionnaires` + `submit_questionnaire_response` (generic, study-agnostic).
- **Gap:** study discovery → consent → enrollment → **scheduled** questionnaires
  (`get_study_questionnaires_mobile`) → cohort progress. An entire member journey, fully
  backend-ready, essentially absent.

### 3. Health real-data metrics — backend deep, app surfaces the 7-day summary only
- **RPCs:** `get_mobile_dashboard_data` (7-day pain/sleep/energy/mood/steps/HR + trend) — *used*;
  but also `get_my_health_check_ins_audited`, `get_health_trends`/`get_health_summary`,
  `get_health_metrics_history_audited`, `get_my_lab_results_audited`, `get_my_dosing_logs_audited`,
  `get_my_ongoing_symptoms_audited`, `get_my_operational_assessments_audited`,
  `get_my_health_documents_audited`, `submit_longevity_assessment_audited`,
  `submit_health_document_ocr_audited`. `create_health_check_in` — *used (write)*.
- **Gap:** history/trend charts (the app ships `victory-native` but renders no charts), lab
  results, dosing compliance, symptom tracking, document OCR/upload, longevity assessment.

### 4. Services-as-products / consumption / entitlements — backend PARTIAL & FRAGMENTED (the one real gap)
The vision: "backend services are products that are consumed/metered." The stack has the
*pieces* but **no single unified consumption/entitlement ledger**:
- **Catalogs:** `products` + `product_catalog` (physical/health products + reward shop),
  `subscription_packages` (Stripe tiers + token bundles), `ai_provider_registry` /
  `mcp_server_registry` (backend service/tool catalog — infra-facing, not a user product list).
- **Real metering that exists:** `llm_quota` + `llm_tier_defaults` + `fn_check_and_consume_llm_quota_audited`
  (per-user **daily LLM token/cost budget** — the truest "service consumption"), `token_transactions` +
  `token_burns` (reward economy), `member_product_logs` (product adherence).
- **Entitlement:** `memberships.tier`, `member_subscriptions`, `product_access` +
  `get_product_access_level()`.
- **RPCs (member, unsurfaced):** `get_my_subscriptions()`, `get_my_product_access()`,
  `get_subscription_packages(locale)`, `get_token_reward_rules_localized()`, `get_my_wallet_balance`.
- **App today:** `get_my_membership` (tier + balances) + `get_my_token_transactions`.
- **Genuine gap (backend story, do NOT invent in app):** there is no single RPC that presents
  "services consumed as products" as one metered ledger. Options: (a) surface the existing
  fragmented pieces (subscriptions + product access + LLM quota remaining) as a "Services &
  Consumption" view, or (b) open a backend story for a unified `get_my_consumption_overview()`
  that merges quota + subscription entitlements + token spend. **Recommend (a) now, (b) as a
  backend story.**

### 5. Profile / consent / compliance / account — backend COMPLETE, app surfaces ~3
- **RPCs:** `get_my_profile_*` (contact, preferences, phi, completeness, visibility),
  `update_my_profile_*`, `get_my_consents` / `get_my_data_sharing_consents`,
  `get_my_compliance_summary`, `get_my_user_roles`, `get_my_active_sessions` /
  `get_my_mobile_sessions`, `get_my_account_deletion_request`.
- **App today:** `get_profile_completeness`, `get_my_membership`. **Gap:** consent center,
  data-sharing controls, GDPR/compliance summary, session management, account deletion.

### 6. Appointments / partners / orders / wearables / reminders — backend present, app surfaces ~0
- `get_my_appointments` / `create_my_appointment` / `get_my_appointment_notes_audited`;
  `get_my_partner_profile` + certifications + availability; `get_my_orders_audited` /
  `get_my_cart` / `get_my_vouchers`; `get_my_wearable_connections`; `get_my_active_reminders` /
  `get_my_upcoming_reminders_audited` + `update_my_storyloop_ui_preferences`.

### 7. Messaging / voice — backend COMPLETE (svc-matrix, svc-livekit), app has hooks but no UI
- Matrix (`useMatrixClient/Rooms/Messages`, `create_story_matrix_room`), LiveKit voice +
  consultation + PTT (`create_consultation_call`, `create-livekit-token`, `join_ptt_channel`).
  Hooks exist, **no screens**. Needs `@livekit/react-native` for voice.

### 8. Admin / management — backend COMPLETE, must be role-gated (NOT in the member tab set)
- `get_mobile_api_stats`, `get_ai_agent_metrics`, `get_tokenomics_overview`, subscription-package
  management, `sentry-monitor` (`/admin/sentry-monitor`, `is_admin_or_staff`). The app already
  has `KcUser.roles` — surface an **Admin/Operator section visible only when role ∈ {admin,staff}**.

---

## Genuine backend gaps (do not fabricate in the app)
1. **Claimable-rewards list** — `claim-reward.tsx` wants "rewards available to claim by id"; only
   claim *history* (`get_my_reward_claims`) + claim-by-(amount,denom) exist. → backend story
   `get_my_claimable_rewards` OR repurpose screen to claim status.
2. **Unified services-consumption ledger** — see §4(b).

## Information architecture (the current 4 tabs can't hold this)
Today: Home · Stories · Profile · Wallet. Proposed member IA:
- **Today** (dashboard: health 7d, due questionnaires, reminders, active studies)
- **Stories** → upgrade to the **auto-Kanban board** (swimlanes + auto-timeline) — the spine
- **Studies** (discover → consent → enroll → scheduled questionnaires → cohort progress)
- **Health** (check-in + trends/charts + labs + dosing + documents)
- **Wallet & Services** (tokens + subscriptions + product access + LLM consumption)
- **Profile** (consent center, compliance, sessions, settings) + **Admin** section (role-gated)
- Cross-cutting: per-story **chat/voice** (Matrix/LiveKit).

## Phased roadmap (each phase = applied-capability wire-up of existing RPCs)
1. **P1 — Kanban spine (core wired):** `kanban_stories_view` + `story_timeline` (auto-events) +
   `update_story_status_audited`. Continue with richer agent/deploy drilldown.
2. **P2 — Study journey:** `get_study_detail` → `get_combined_study_consents`/`submit_*` →
   `enroll_in_study` → `get_study_questionnaires_mobile` (scheduled) → cohort progress.
3. **P3 — Health depth:** trends/charts (victory-native already a dep), labs, dosing, symptoms.
4. **P4 — Wallet & Services:** `get_my_subscriptions`, `get_my_product_access`,
   `get_subscription_packages`, LLM quota remaining; resolve claimable-rewards gap.
5. **P5 — Profile/consent/compliance + Admin (role-gated)** + appointments/orders/wearables.
6. **P6 — Messaging/voice** (Matrix chat; LiveKit consultation — adds native dep).

Each phase ships independently, is i18n'd (cs/en, DeepL for the rest), tested, and gated by the
backend it renders. None requires new backend except the two flagged gaps.
