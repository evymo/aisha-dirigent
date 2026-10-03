-- Grants: agent_knowledge_source_secrets — domov pověření integrací (šifrovaně, bytea)
--
-- ⛔ PŘÍMO TABULKU NEČTE ŽÁDNÁ ROLE kromě vlastníka (zpevnění (b), rozbor pověření
-- 2026-09-28 §4 bod 1). Čtenáři i zapisovatelé jsou výhradně SECURITY DEFINER funkce
-- (set_data_source_secrets, get_data_source_secret_status, get_plugin_runtime_config),
-- které běží jako vlastník a samy hlídají volajícího + auditují. service_role má
-- BYPASSRLS — RLS bez politiky ho nezastaví, zastaví ho jen chybějící grant.
-- Naměřeno 2026-09-28 na riq: granty jen vlastník (správně); tenhle soubor to drží
-- VÝSLOVNĚ, aby plošný grant (fix_missing_table_grants) ani ruční GRANT nevrátil
-- přístup potichu. Hlídá brána tajemstvi-bez-grantu-a-bez-kopie + runtime test.

REVOKE ALL ON TABLE public.agent_knowledge_source_secrets FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  -- nocodb_app (datový editor) má na některých instancích S/I/U/D přes plošný grant
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nocodb_app') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.agent_knowledge_source_secrets FROM nocodb_app';
  END IF;
END $$;
