-- Function: public.deactivate_distribution_adjustment_audited
-- Arguments: p_adjustment_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.deactivate_distribution_adjustment_audited(p_adjustment_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_admin_or_staff(v_user_id) AND NOT has_role(v_user_id, 'consultant') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE distribution_adjustments
  SET is_active = false, updated_at = now()
  WHERE id = p_adjustment_id;

  INSERT INTO audit_journal (user_id, action_type, area, entity_type, entity_id, summary, severity)
  VALUES (v_user_id, 'update', 'admin', 'distribution_adjustment', p_adjustment_id::text, 'Deactivated distribution adjustment', 'info');

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.deactivate_distribution_adjustment_audited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_distribution_adjustment_audited(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_distribution_adjustment_audited(uuid) TO service_role;
