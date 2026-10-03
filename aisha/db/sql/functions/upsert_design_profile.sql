-- =============================================================================
-- Function: upsert_design_profile — Occipitum: create/update design DNA
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_design_profile(
  p_brand_dna jsonb DEFAULT NULL,
  p_design_constraints jsonb DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL,
  p_style_preferences jsonb DEFAULT NULL,
  p_ux_persona jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id uuid;
  v_partner_owner uuid;
  v_profile_id uuid;
  v_version integer;
BEGIN
  v_caller_id := auth.uid();

  SELECT user_id INTO v_partner_owner
  FROM public.partner_profiles
  WHERE id = p_partner_id;

  IF v_partner_owner IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Partner not found');
  END IF;

  IF v_caller_id != v_partner_owner AND NOT is_admin_or_staff() THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Unauthorized');
  END IF;

  INSERT INTO public.design_profiles (partner_id, brand_dna, ux_persona, style_preferences, design_constraints)
  VALUES (
    p_partner_id,
    COALESCE(p_brand_dna, '{}'::jsonb),
    COALESCE(p_ux_persona, '{}'::jsonb),
    COALESCE(p_style_preferences, '{}'::jsonb),
    COALESCE(p_design_constraints, '{}'::jsonb)
  )
  ON CONFLICT (partner_id) DO UPDATE SET
    brand_dna = COALESCE(p_brand_dna, design_profiles.brand_dna),
    ux_persona = COALESCE(p_ux_persona, design_profiles.ux_persona),
    style_preferences = COALESCE(p_style_preferences, design_profiles.style_preferences),
    design_constraints = COALESCE(p_design_constraints, design_profiles.design_constraints),
    profile_version = design_profiles.profile_version + 1,
    updated_at = now()
  RETURNING id, profile_version INTO v_profile_id, v_version;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_caller_id,
    'DESIGN_PROFILE_UPSERT',
    jsonb_build_object(
      'area', 'occipitum',
      'severity', 'info',
      'entity_type', 'design_profile',
      'entity_id', v_profile_id,
      'partner_id', p_partner_id,
      'version', v_version
    )
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'profile_id', v_profile_id,
    'profile_version', v_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_design_profile(jsonb, jsonb, uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_design_profile(jsonb, jsonb, uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_design_profile(jsonb, jsonb, uuid, jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.upsert_design_profile(jsonb, jsonb, uuid, jsonb, jsonb) IS
  'Occipitum: create or update design DNA profile with audit logging.';
