-- Function: public.create_production_release_decision_admin
-- Creates a QA release decision (immutable record)
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.create_production_release_decision_admin(
  p_batch_id uuid DEFAULT NULL,
  p_conditions text DEFAULT NULL,
  p_decision text DEFAULT NULL,
  p_linked_deviation_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_reason text DEFAULT NULL,
  p_review_checklist jsonb DEFAULT NULL,
  p_review_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result_id uuid;
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  IF p_batch_id IS NULL OR p_decision IS NULL THEN
    RAISE EXCEPTION 'batch_id and decision are required';
  END IF;

  -- Release decisions are immutable records (e-signature equivalent)
  INSERT INTO public.production_release_decisions (
    batch_id, decision, decision_at, decided_by,
    reason, linked_deviation_id, conditions,
    review_checklist, review_notes, metadata
  ) VALUES (
    p_batch_id, p_decision, now(), auth.uid(),
    p_reason, p_linked_deviation_id, p_conditions,
    p_review_checklist, p_review_notes, p_metadata
  )
  RETURNING id INTO v_result_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'create'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := v_result_id::text,
    p_entity_type := 'production_release_decision',
    p_new_values := jsonb_build_object('batch_id', p_batch_id, 'decision', p_decision),
    p_old_values := NULL,
    p_severity := 'warning'::public.journal_severity,
    p_summary := format('Admin created release decision: %s for batch %s', p_decision, p_batch_id),
    p_tags := ARRAY['admin', 'production_release_decision', 'qa'],
    p_user_id := auth.uid()
  );

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_production_release_decision_admin(uuid, text, text, uuid, jsonb, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_production_release_decision_admin(uuid, text, text, uuid, jsonb, text, jsonb, text) TO authenticated;
