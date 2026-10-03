# Knowhow Audit and Change Proposals (2026-01-16)

## Scope
- Directories reviewed: src/**, supabase/sql/**
- Methods: ripgrep search plus targeted file inspection
- Tests executed: none (audit only)

> **Poznámka (2026-03):** Původní audit zahrnoval i `mobile-app/**`, která byla od té doby přesunuta do samostatného repozitáře. Findings týkající se mobile-app jsou ponechány pro historický kontext, ale nejsou relevantní pro tento repozitář.

## Current Consistency Utilities (Observed)
- RPC-only enforcement: src/tests/architecture/code-standards.test.ts
- DB/RPC validation: src/tests/db/rpc-runtime-validation.test.ts, src/tests/db/db-frontend-consistency.test.ts, src/tests/security/rpc-function-security.test.ts, src/tests/gates/security.gate.test.ts
- Logging safety: src/lib/security/safeLogger.ts (sanitized, dev-only, Sentry in prod)
- Permission system: src/hooks/usePermissions.ts, src/components/session/RequirePermission.tsx (role fallback via useUserRole)
- i18n: src/i18n/segments + docs/I18N_STANDARDS.md; mobile-app uses a separate custom i18n hook

## Findings (by severity)

### Critical
- Mobile app logs sensitive data or secrets:
  - mobile-app/src/app/(auth)/login.tsx logs email and full auth result.
  - mobile-app/src/config/supabase.ts logs anon key, URL, and expo extra.
  - mobile-app/src/services/** uses console.* with raw errors (may include user data).
  - mobile-app/src/services/health/index.ts logs check-in activity.

### High
- Web i18n violations (hardcoded strings or fallback usage):
  - src/components/ui/data-table/DataTable.tsx: "Search...", "View", "No results."
  - src/components/ui/data-table/DataTableColumnHeader.tsx: "Asc", "Desc", "Hide"
  - src/components/gamification/RewardNotification.tsx: hardcoded text and t(key, fallback)
  - src/components/gamification/AchievementBadge.tsx: t(key, fallback)
  - src/components/member-diary/ActivityStateList.tsx: t(key, fallback)
  - src/components/member-diary/DashboardGrid.tsx: t(key, fallback)
  - src/pages/member/MemberDiary.tsx: t(key, fallback)
  - src/components/storyloop/StoryComposer.tsx: t(key, fallback)
  - src/pages/Story.tsx: i18n.exists usage (disallowed)
  - src/components/session/RequireAuth.tsx: "Loading..." hardcoded

- Mobile app i18n violations:
  - mobile-app/src/app/_layout.tsx, mobile-app/src/app/(auth)/login.tsx, mobile-app/src/services/notifications/index.ts have hardcoded UI strings.
  - mobile-app/src/hooks/useTranslation.ts supports a fallback parameter and returns fallback or key, which conflicts with repo i18n rules.

### Medium
- SQL explicit-column policy: SELECT * or row_to_json(table.*) in RPCs
  - supabase/sql/functions/get_my_partner_certification.sql
  - supabase/sql/functions/get_my_qualification_results.sql
  - supabase/sql/functions/get_user_lab_results_audited.sql
  - supabase/sql/functions/get_shipments_admin_audited.sql
  - supabase/sql/functions/get_study_cohort_trends_secure.sql
  - supabase/sql/functions/get_study_cohort_lab_trends_secure.sql
  - supabase/sql/functions/get_study_cohort_statistics_secure.sql
  - supabase/sql/functions/get_all_supported_languages.sql
  - supabase/sql/functions/get_partner_profile.sql (row_to_json(pp.*))
  - supabase/sql/functions/get_plan_adjustments_audited.sql (row_to_json(da.*))
  - supabase/sql/functions/get_mobile_api_stats.sql (row_to_json(active_sessions.*), rate_limit_stats.*)
  - Additional SELECT * INTO occurrences exist (lower risk but still opaque).

- Mobile app RPC type safety: pervasive `supabase.rpc('fn' as any, ...)` usage in mobile-app/src/services/api/client.ts and mobile-app/src/services/notifications/index.ts.

- Permissions and roles:
  - Some routes use RequireAuth without explicit permission (e.g., /member/leaderboard).
  - usePermissions fallback does not map roles beyond admin/staff/member/partner/practitioner/evaluator (consultant, researcher, production roles).

### Low
- RequireAuth loading state text not translated.

## Positive Findings
- No direct supabase.from() usage found in src/** or mobile-app/** (RPC-only compliance).
- All functions with GRANT TO anon in supabase/sql/functions have SECURITY DEFINER and SET search_path.
- security-known-issues.ts allowlists are empty for anon grants and restricted tables without RLS.

## Proposed Changes (no code applied)

### Logging and sensitive-data
- Replace mobile-app console.* with a safe logger (port src/lib/security/safeLogger.ts or create mobile equivalent).
- Remove any logs that include email, tokens, or auth responses.
- Gate remaining debug logs behind __DEV__ and ensure redaction.

### i18n Consistency
- Web: move DataTable and RewardNotification strings into i18n keys in src/i18n/segments/en/*.json.
- Remove t(key, fallback) usage; enforce canonical keys only.
- For dynamic keys (e.g., healthStates), add explicit "unknown" keys instead of fallback values.
- Remove i18n.exists usage; prefer dedicated keys for optional text.
- Mobile: replace hardcoded UI text with useTranslation keys; align mobile i18n behavior with I18N_STANDARDS.md (no fallback values).

### Permissions
- Replace RequireAuth on member-only routes with RequirePermission where appropriate (confirm intended access for /member/leaderboard and /partner/:partnerId).
- Consider exposing get_user_permissions in mobile app and gating tabs/screens by permission.

### SQL and Grants
- Replace SELECT * and row_to_json(table.*) with explicit column lists for RPC returns.
- Add a static lint/test to flag SELECT * in supabase/sql/functions (similar to code-standards.test.ts).

### Type Safety
- Regenerate or extend mobile-app Supabase types so RPC names are typed and remove `as any`.
- Add runtime schema validation for mobile RPC responses (zod or shared schemas) to align with web hooks.

### Tests and Tooling
- Enable console.log enforcement in src/tests/architecture/code-standards.test.ts and extend to mobile-app.
- Add tests for DataTable and RequireAuth loading text i18n keys.
- Add a lint/script to detect i18n fallback usage (t(key, fallback), i18n.exists).

## Open Questions
- Is /member/leaderboard intended for any authenticated user, or only for members with view_studies?
- Is the mobile app strictly member-only? If not, which roles should it support?
