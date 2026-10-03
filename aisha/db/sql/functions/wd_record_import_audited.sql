-- ============================================================================
-- Source of Truth: wd_record_import_audited
-- Popis: Životní cyklus záznamu ve wd_import_log. Volá svc-webdispecink:
--        p_action='start'  → založí běh (import_type), vrátí import_id
--        p_action='finish' → uzavře běh (status, počty, chyba)
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: wd_import.started / wd_import.finished
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_record_import_audited(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Canonical boolean-NOT-NULL service check (is_service_role.sql, #588): the
  -- prior inline claims idiom folds to SQL NULL without a role claim and the
  -- negative deny-guard below then fails OPEN. is_service_role() COALESCEs to
  -- false, so the guard is total (fails CLOSED).
  v_is_service boolean := public.is_service_role();
  v_import_id uuid;
  v_status text;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_action = 'start' THEN
    IF p_payload->>'import_type' IS NULL THEN
      RAISE EXCEPTION 'import_type required';
    END IF;

    INSERT INTO public.wd_import_log (import_type, status, started_at)
    VALUES (p_payload->>'import_type', 'running', now())
    RETURNING id INTO v_import_id;

    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'wd_import.started',
      jsonb_build_object(
        'import_id', v_import_id,
        'import_type', p_payload->>'import_type'
      )
    );

    RETURN jsonb_build_object('import_id', v_import_id);
  END IF;

  IF p_action = 'finish' THEN
    IF p_payload->>'import_id' IS NULL THEN
      RAISE EXCEPTION 'import_id required';
    END IF;

    v_import_id := (p_payload->>'import_id')::uuid;
    v_status := COALESCE(p_payload->>'status', 'success');
    IF v_status NOT IN ('success', 'error') THEN
      RAISE EXCEPTION 'status must be success or error';
    END IF;

    UPDATE public.wd_import_log SET
      status           = v_status,
      finished_at      = now(),
      records_total    = (p_payload->>'records_total')::integer,
      records_upserted = (p_payload->>'records_upserted')::integer,
      records_failed   = (p_payload->>'records_failed')::integer,
      error_message    = p_payload->>'error_message',
      details          = p_payload->'details'
    WHERE id = v_import_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Import run % not found', v_import_id;
    END IF;

    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'wd_import.finished',
      jsonb_build_object(
        'import_id', v_import_id,
        'status', v_status,
        'records_total', (p_payload->>'records_total')::integer,
        'records_upserted', (p_payload->>'records_upserted')::integer
      )
    );

    RETURN jsonb_build_object('import_id', v_import_id, 'status', v_status);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$$;

REVOKE ALL ON FUNCTION public.wd_record_import_audited(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_record_import_audited(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_record_import_audited(text, jsonb) TO service_role;
