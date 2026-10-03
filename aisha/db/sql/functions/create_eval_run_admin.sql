-- create_eval_run_admin: Create an AI evaluation run
-- Called by: discover-models/index.ts for auto-evaluation after model discovery
-- Originally dropped in migration 20260411180000, re-created as needed by edge functions
--
-- Oprava 2026-09-29 (SELF_IMPROVEMENT_LOOP.md §3, K-25) — naměřeno na main 9087ef3df:
--   stráž pouštěla jen is_admin_or_staff(), ale grant má JEN service_role (tam je auth.uid()
--   NULL → is_admin_or_staff() = false). Každé volání proto padlo na 'Admin access required';
--   jediný volající (svc-ai-chat benchmarkRunner.ts:97) chybu spolkne, takže běh hodnocení
--   se nikdy nezaložil a eval_run_id benchmarku byl vždy NULL. Unit test runner mockuje,
--   proto zelený. Teď stráž pustí službu (i správu); grant zůstává jen službě.
CREATE OR REPLACE FUNCTION public.create_eval_run_admin(
  p_trigger_type text,
  p_agent_config_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO ai_eval_runs (trigger_type, agent_config_id, metadata, status)
  VALUES (p_trigger_type, p_agent_config_id, p_metadata, 'pending')
  RETURNING id INTO v_run_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'EVAL_RUN_CREATED',
    jsonb_build_object(
      'area', 'ai',
      'severity', 'info',
      'entity_type', 'ai_eval_run',
      'entity_id', v_run_id,
      'trigger_type', p_trigger_type
    )
  );

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_eval_run_admin(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_eval_run_admin(text, uuid, jsonb) TO service_role;
