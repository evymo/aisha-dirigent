-- Function: public.get_production_release_decisions_admin
-- Returns formal QA release decisions per batch
-- SECURITY DEFINER with admin guard and audit log

CREATE OR REPLACE FUNCTION public.get_production_release_decisions_admin(
  p_batch_id uuid DEFAULT NULL,
  p_decision text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  batch_id uuid,
  decision text,
  decision_at timestamptz,
  decided_by uuid,
  reason text,
  linked_deviation_id uuid,
  conditions text,
  review_checklist jsonb,
  review_notes text,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'read'::public.journal_action_type,
    p_area := 'products'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_batch_id::text,
    p_entity_type := 'production_release_decision',
    p_new_values := jsonb_build_object('batch_id', p_batch_id, 'decision', p_decision),
    p_old_values := NULL,
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Admin read production release decisions',
    p_tags := ARRAY['admin', 'production_release_decision'],
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    prd.id, prd.batch_id, prd.decision, prd.decision_at,
    prd.decided_by, prd.reason, prd.linked_deviation_id,
    prd.conditions, prd.review_checklist, prd.review_notes,
    prd.metadata, prd.created_at
  FROM public.production_release_decisions prd
  WHERE (p_batch_id IS NULL OR prd.batch_id = p_batch_id)
    AND (p_decision IS NULL OR prd.decision = p_decision)
  ORDER BY prd.decision_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_production_release_decisions_admin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_release_decisions_admin(uuid, text) TO authenticated;
