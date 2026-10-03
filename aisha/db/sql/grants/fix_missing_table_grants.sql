-- =============================================================================
-- FIX MISSING TABLE GRANTS
-- =============================================================================
-- Purpose: Restore the baseline role grants on public tables after a
--          pg_dump/restore that dropped them.
--
-- LEAST PRIVILEGE (D1 remediation): the `anon` (unauthenticated) role does NOT
-- receive SELECT in bulk. The previous version:
--   (a) set an ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES TO anon, so
--       every future table became world-readable by default, and
--   (b) looped over ALL public tables granting anon SELECT on all-but-N via a
--       NOT LIKE / NOT IN deny-list — default-allow, and it silently RE-GRANTED
--       anon SELECT after the reviewed per-object grant files on every cold-start.
-- Both are removed. anon SELECT is now DEFAULT-DENY: it comes ONLY from
--   (1) the reviewed per-object grant files in aisha/db/sql/grants/ (gated by the
--       anon-grants-select-only gate), and
--   (2) the EXPLICIT allowlist below (genuinely public content surfaces).
-- authenticated / service_role grants are unchanged — those roles are RLS-gated.
-- =============================================================================

-- 1. Default privileges for the RLS-gated roles ONLY (NO anon default grant —
--    a new table must be opted into anon read explicitly, never by default).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;

-- 2. Restore SELECT to authenticated (RLS-gated) + ALL to service_role on every
--    existing public table. anon is deliberately NOT granted here.
DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      -- ⛔ Tabulky s tajemstvími (app_secrets, agent_knowledge_source_secrets…)
      -- čtou JEN SECURITY DEFINER funkce (vlastník). Plošný grant by jim vrátil
      -- SELECT pro authenticated na každém cold startu (naměřeno 2026-09-28:
      -- admin četl app_secrets přes REST). Hlídá brána tajemstvi-bez-grantu-a-bez-kopie.
      AND tablename NOT ILIKE '%secret%'
  LOOP
    -- SELECT to authenticated (required for most SECURITY INVOKER RPCs; RLS-gated).
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', tbl.tablename);
    -- ALL to service_role (trusted backend).
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl.tablename);
  END LOOP;

  RAISE NOTICE 'Granted SELECT to authenticated + ALL to service_role on all public tables (anon excluded — default-deny)';
END $$;

-- 3. EXPLICIT anon allowlist (default-deny) — genuinely public, unauthenticated
--    read surfaces only: public web content + public chat config + public catalog.
--    Every entry is a conscious decision; RLS still applies. To add a table here,
--    justify it (it must contain NO member/PII rows readable by anon). Missing
--    tables are skipped (some are optional per instance).
--
--    PRIVILEGED CLASS NEVER ELIGIBLE FOR THIS ALLOWLIST (invariant I3, SEC-F4b
--    migration 20260610180000 + audit C2): the aggregate-PII audience relations
--    and the invite ledger are reached ONLY via SECURITY DEFINER RPCs
--    (audience_get_my_* / validate_invitation), never by a direct anon table read.
--    Because this loop is default-deny they are excluded simply by their ABSENCE
--    from the allowlist above — there is no blanket loop to opt them out of. For
--    the record, the class that must stay anon-unreadable is:
--        • every relation NOT LIKE 'audience%'   (audience operator views +
--          audience_broker_sync_state — aggregate member PII), and
--        • the cohort/invite relations NOT IN ('cohorts', 'cohort_arms', 'invitations')
--          (cohort membership + invite code/role/email PII).
--    audience_audit_grants() invariant I3 classifies any anon SELECT on these as
--    CRITICAL; keeping them out of the allowlist keeps this restorer aligned with
--    that contract on every cold-start.
DO $$
DECLARE
  anon_public_tables TEXT[] := ARRAY[
    -- Public web content (svc-web-artifact rendered pages / marketing chrome)
    'web_pages',
    'web_page_templates',
    'web_page_versions',
    'hero_slides',
    'featured_products',
    'branding_profiles',
    'branding_hostname_mapping',
    -- Public chat (the unauthenticated public chat widget config surface)
    'public_chat_channels',
    -- Public catalog (question DEFINITIONS only — never the responses)
    'questionnaires',
    'questionnaire_blocks',
    'questionnaire_versions'
  ];
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY anon_public_tables
  LOOP
    BEGIN
      EXECUTE format('GRANT SELECT ON public.%I TO anon', tbl);
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'anon-allowlist table % does not exist, skipping', tbl;
    END;
  END LOOP;
END $$;

-- 4. INSERT/UPDATE/DELETE on user-owned tables (authenticated, RLS-gated).
DO $$
DECLARE
  user_tables TEXT[] := ARRAY[
    'health_check_ins',
    'dosing_logs',
    'lab_results',
    'cart_items',
    'consents',
    'data_sharing_consents',
    'member_health_documents',
    'document_sharing_permissions',
    'study_registrations',
    'questionnaire_responses',
    'partner_appointments',
    'partner_appointment_notes',
    'partner_availability',
    'notifications',
    'user_sessions',
    'profiles',
    'member_wearable_connections',
    'wearables_data',
    'health_data',
    'health_data_sync_log'
  ];
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY user_tables
  LOOP
    BEGIN
      EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
      RAISE NOTICE 'Granted INSERT, UPDATE, DELETE on % to authenticated', tbl;
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'Table % does not exist, skipping', tbl;
    END;
  END LOOP;
END $$;
