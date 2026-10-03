-- Function: public.db_self_repair
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:20+01:00

CREATE OR REPLACE FUNCTION public.db_self_repair()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_repairs jsonb := '[]'::jsonb;
  v_repair_count INTEGER := 0;
  v_start_time TIMESTAMPTZ := NOW();
BEGIN
  -- CHECK: Default supported languages
  IF NOT EXISTS (SELECT 1 FROM public.supported_languages WHERE code = 'cs') THEN
    BEGIN
      INSERT INTO public.supported_languages (code, name_native, name_key, is_default, is_active, sort_order)
      VALUES ('cs', 'Čeština', 'languages.czech', false, true, 1);
      v_repairs := v_repairs || jsonb_build_object('type', 'data', 'table', 'supported_languages', 'value', 'cs', 'action', 'inserted');
      v_repair_count := v_repair_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- user_id = auth.uid() (nullable): the '00000000-…0000' sentinel is not a
      -- real aisha_auth.users row → it violated audit_journal_user_id_fkey.
      INSERT INTO audit_journal(user_id, action, metadata)
      VALUES (
        auth.uid(),
        'SELF_REPAIR_FAILED',
        jsonb_build_object(
          'severity', 'error',
          'table', 'supported_languages',
          'value', 'cs',
          'error', SQLERRM
        )
      );
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.supported_languages WHERE code = 'en') THEN
    BEGIN
      INSERT INTO public.supported_languages (code, name_native, name_key, is_default, is_active, sort_order)
      VALUES ('en', 'English', 'languages.english', true, true, 2);
      v_repairs := v_repairs || jsonb_build_object('type', 'data', 'table', 'supported_languages', 'value', 'en', 'action', 'inserted');
      v_repair_count := v_repair_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- user_id = auth.uid() (nullable): the '00000000-…0000' sentinel is not a
      -- real aisha_auth.users row → it violated audit_journal_user_id_fkey.
      INSERT INTO audit_journal(user_id, action, metadata)
      VALUES (
        auth.uid(),
        'SELF_REPAIR_FAILED',
        jsonb_build_object(
          'severity', 'error',
          'table', 'supported_languages',
          'value', 'en',
          'error', SQLERRM
        )
      );
    END;
  END IF;

  -- 'global' is the locale-axis FK sentinel (knowledge_items/chunks/embeddings
  -- default locale='global'). Existing DBs must converge it BEFORE the locale FK
  -- ALTER lands, else every knowledge_* write 23503-fails. Mirrors the cs/en arms.
  IF NOT EXISTS (SELECT 1 FROM public.supported_languages WHERE code = 'global') THEN
    BEGIN
      INSERT INTO public.supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
      VALUES ('global', 'Global', 'languages.global.name', true, false, 0);
      v_repairs := v_repairs || jsonb_build_object('type', 'data', 'table', 'supported_languages', 'value', 'global', 'action', 'inserted');
      v_repair_count := v_repair_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- user_id = auth.uid() (nullable): the '00000000-…0000' sentinel is not a
      -- real aisha_auth.users row → it violated audit_journal_user_id_fkey.
      INSERT INTO audit_journal(user_id, action, metadata)
      VALUES (
        auth.uid(),
        'SELF_REPAIR_FAILED',
        jsonb_build_object(
          'severity', 'error',
          'table', 'supported_languages',
          'value', 'global',
          'error', SQLERRM
        )
      );
    END;
  END IF;

  -- Return summary
  RETURN jsonb_build_object(
    'success', true,
    'repairs_count', v_repair_count,
    'repairs', v_repairs,
    'duration_ms', EXTRACT(MILLISECOND FROM (NOW() - v_start_time)),
    'timestamp', NOW()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.db_self_repair() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.db_self_repair() FROM anon;
REVOKE EXECUTE ON FUNCTION public.db_self_repair() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.db_self_repair() TO aisha_admin;
GRANT EXECUTE ON FUNCTION public.db_self_repair() TO service_role;
