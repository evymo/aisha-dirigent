-- =============================================================================
-- Function: get_design_profile — Occipitum: fetch design DNA for a partner
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_design_profile(
  p_partner_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', dp.id,
    'partner_id', dp.partner_id,
    'brand_dna', dp.brand_dna,
    'ux_persona', dp.ux_persona,
    'style_preferences', dp.style_preferences,
    'design_constraints', dp.design_constraints,
    'profile_version', dp.profile_version,
    'created_at', dp.created_at,
    'updated_at', dp.updated_at
  ) INTO v_result
  FROM public.design_profiles dp
  WHERE dp.partner_id = p_partner_id;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found', 'partner_id', p_partner_id);
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'profile', v_result);
END;
$$;

COMMENT ON FUNCTION public.get_design_profile(uuid) IS
  'Occipitum: returns design DNA profile for a partner. RLS-enforced (SECURITY INVOKER).';

-- Permissions: SECURITY INVOKER → must grant explicitly. Frontend caller:
-- src/hooks/useDesignProfile.ts (aisha.rpc("get_design_profile", ...)).
REVOKE ALL ON FUNCTION public.get_design_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_design_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_design_profile(uuid) TO service_role;
