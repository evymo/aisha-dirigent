-- Function: public.update_context_profile_admin
-- Arguments: p_id uuid, p_updates jsonb
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.update_context_profile_admin(p_id uuid, p_updates jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = 'P0003';
  END IF;

  UPDATE context_profiles
  SET
    display_name = COALESCE(p_updates->>'display_name', display_name),
    description = COALESCE(p_updates->>'description', description),
    token_budget = COALESCE((p_updates->>'token_budget')::int, token_budget),
    is_active = COALESCE((p_updates->>'is_active')::boolean, is_active),
    layers = COALESCE(
      CASE WHEN p_updates ? 'layers' THEN p_updates->'layers' ELSE NULL END,
      layers
    )
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Context profile not found: %', p_id USING ERRCODE = 'P0002';
  END IF;

  RETURN p_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_context_profile_admin(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_context_profile_admin(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_context_profile_admin(uuid, jsonb) TO service_role;
