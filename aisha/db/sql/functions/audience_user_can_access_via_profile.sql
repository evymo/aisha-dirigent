-- Function: audience_user_can_access_via_profile

CREATE OR REPLACE FUNCTION public.audience_user_can_access_via_profile(p_profile_slug text, p_target_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile public.context_profiles%ROWTYPE;
  v_scope_filter TEXT;
BEGIN
  SELECT * INTO v_profile FROM public.context_profiles WHERE slug = p_profile_slug AND is_active = true;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Tier gate
  IF v_profile.tier_required IS NOT NULL THEN
    IF NOT public.audience_user_meets_tier_requirement(v_profile.tier_required) THEN
      RETURN false;
    END IF;
  END IF;

  -- Permission gate
  IF v_profile.permission_required IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM unnest(public.get_user_permissions()) AS perm
      WHERE perm = v_profile.permission_required
    ) THEN
      RETURN false;
    END IF;
  END IF;

  -- Scope filter evaluation
  v_scope_filter := v_profile.data_scope_rule->>'filter';
  IF v_scope_filter IS NULL OR v_scope_filter = '' THEN
    RETURN true;
  END IF;

  -- Known filter patterns
  IF v_scope_filter = 'creator_user_id = auth.uid()' THEN
    RETURN p_target_user_id IS NULL OR p_target_user_id = auth.uid();
  END IF;

  IF v_scope_filter = 'target_user_id = auth.uid()' THEN
    RETURN p_target_user_id IS NULL OR p_target_user_id = auth.uid();
  END IF;

  IF v_scope_filter LIKE '%scope_member_of%' THEN
    RETURN public.audience_user_can_see_creator_stats(p_target_user_id);
  END IF;

  IF v_scope_filter = 'is_admin_or_staff()' THEN
    RETURN is_admin_or_staff();
  END IF;

  -- Deny by default for unknown patterns
  RETURN false;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_user_can_access_via_profile(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_user_can_access_via_profile(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_user_can_access_via_profile(text,uuid) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_user_can_access_via_profile(text,uuid) TO service_role;
