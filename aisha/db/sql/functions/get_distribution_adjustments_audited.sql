-- Function: public.get_distribution_adjustments_audited
-- Arguments: p_member_token text DEFAULT NULL::text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_distribution_adjustments_audited(p_member_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_admin_or_staff(v_user_id) AND NOT has_role(v_user_id, 'consultant') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(da.*)), '[]'::jsonb)
  INTO v_result
  FROM distribution_adjustments da
  WHERE (p_member_token IS NULL OR da.member_token = p_member_token);

  INSERT INTO audit_journal (user_id, action_type, area, entity_type, summary, severity)
  VALUES (v_user_id, 'view', 'admin', 'distribution_adjustment', 'Viewed distribution adjustments', 'info');

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_distribution_adjustments_audited(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_distribution_adjustments_audited(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_distribution_adjustments_audited(text) TO service_role;
