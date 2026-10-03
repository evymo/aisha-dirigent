-- ============================================================================
-- Source of Truth: tc_record_import_audited
-- Popis: Životní cyklus importního běhu svc-tcars nad tc_import_log.
--        p_action='start' otevře běh (status running, vrací {import_id});
--        p_action='finish' běh uzavře (status/finished_at/počty/chyba/details).
--        Doplněno 2026-07-25: sync.ts tuto RPC volal, ale v SoT chyběla
--        (import běhy #813 by padly na první RPC).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: tc_import.started / tc_import.finished (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tc_record_import_audited(
  p_action  text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := public.is_service_role();
  v_import_id  uuid;
  v_type       text;
  v_status     text;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_action = 'start' THEN
    v_type := p_payload->>'import_type';
    IF v_type IS NULL THEN
      RAISE EXCEPTION 'p_payload.import_type is required for start';
    END IF;

    INSERT INTO public.tc_import_log (import_type, status, started_at)
    VALUES (v_type, 'running', now())
    RETURNING id INTO v_import_id;

    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (auth.uid(), 'tc_import.started',
            jsonb_build_object('import_id', v_import_id, 'import_type', v_type));

    RETURN jsonb_build_object('import_id', v_import_id);

  ELSIF p_action = 'finish' THEN
    v_import_id := (p_payload->>'import_id')::uuid;
    v_status    := p_payload->>'status';
    IF v_import_id IS NULL THEN
      RAISE EXCEPTION 'p_payload.import_id is required for finish';
    END IF;
    IF v_status NOT IN ('success', 'error') THEN
      RAISE EXCEPTION 'p_payload.status must be success or error';
    END IF;

    UPDATE public.tc_import_log SET
      status           = v_status,
      finished_at      = now(),
      records_total    = COALESCE((p_payload->>'records_total')::integer, records_total),
      records_upserted = COALESCE((p_payload->>'records_upserted')::integer, records_upserted),
      records_failed   = COALESCE((p_payload->>'records_failed')::integer, records_failed),
      error_message    = COALESCE(p_payload->>'error_message', error_message),
      details          = COALESCE(p_payload->'details', details)
    WHERE id = v_import_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'import run % not found', v_import_id;
    END IF;

    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (auth.uid(), 'tc_import.finished',
            jsonb_build_object('import_id', v_import_id, 'status', v_status));

    RETURN jsonb_build_object('import_id', v_import_id, 'status', v_status);
  END IF;

  RAISE EXCEPTION 'p_action must be start or finish';
END;
$$;

REVOKE ALL ON FUNCTION public.tc_record_import_audited(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tc_record_import_audited(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tc_record_import_audited(text, jsonb) TO service_role;
