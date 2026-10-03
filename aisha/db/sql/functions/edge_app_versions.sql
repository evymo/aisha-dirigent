-- Function: public.edge_app_versions
-- Purpose: Edge-safe mobile app version reads.

CREATE OR REPLACE FUNCTION public.edge_app_versions(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_platform text;
  v_row jsonb;
BEGIN
  IF p_action = 'get_platform' THEN
    v_platform := lower(COALESCE(p_payload ->> 'platform', 'ios'));
    IF v_platform NOT IN ('ios', 'android') THEN
      v_platform := 'ios';
    END IF;

    SELECT jsonb_build_object(
      'created_at', a.created_at,
      'features', a.features,
      'id', a.id,
      'latest_version', a.latest_version,
      'maintenance_enabled', a.maintenance_enabled,
      'maintenance_end', a.maintenance_end,
      'maintenance_message', a.maintenance_message,
      'min_version', a.min_version,
      'platform', a.platform,
      'store_url', a.store_url,
      'updated_at', a.updated_at
    )
    INTO v_row
    FROM public.app_versions a
    WHERE a.platform = v_platform
    LIMIT 1;

    RETURN jsonb_build_object('row', v_row);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_app_versions(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_app_versions(text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.edge_app_versions(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edge_app_versions(text, jsonb) TO service_role;
