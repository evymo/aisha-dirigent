-- Function: get_active_ai_model_for_tier

CREATE OR REPLACE FUNCTION public.get_active_ai_model_for_tier(p_provider text DEFAULT NULL::text)
 RETURNS TABLE(provider text, model_id text, display_name text, is_admin_active boolean)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL AND public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied: authentication required for get_active_ai_model_for_tier'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.provider,
    r.model_id,
    r.display_name,
    r.is_admin_active
  FROM public.ai_model_registry r
  WHERE r.is_admin_active = true
    AND r.is_available = true
    AND r.is_deprecated = false
    AND (p_provider IS NULL OR r.provider = p_provider)
  ORDER BY r.updated_at DESC;
END;
$function$

;

REVOKE ALL ON FUNCTION get_active_ai_model_for_tier(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_active_ai_model_for_tier(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_ai_model_for_tier(text) TO service_role;
