-- Function: public.create_study_admin
-- Arguments: p_code text, p_name text, p_description text, p_study_type text, p_target_condition text, p_duration_weeks integer, p_target_registration integer, p_min_participants integer, p_max_participants integer, p_funding_goal numeric, p_funding_deadline date, p_is_blinded boolean, p_informed_consent_version text, p_informed_consent_special_provisions text, p_is_active boolean, p_is_umbrella boolean, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_protocol_url text, p_products text[], p_name_key text, p_description_key text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:14+01:00

CREATE OR REPLACE FUNCTION public.create_study_admin(p_code text, p_name text, p_description text DEFAULT NULL::text, p_study_type text DEFAULT 'observational'::text, p_target_condition text DEFAULT NULL::text, p_duration_weeks integer DEFAULT NULL::integer, p_target_registration integer DEFAULT NULL::integer, p_min_participants integer DEFAULT 0, p_max_participants integer DEFAULT NULL::integer, p_funding_goal numeric DEFAULT 0, p_funding_deadline date DEFAULT NULL::date, p_is_blinded boolean DEFAULT false, p_informed_consent_version text DEFAULT '1.0'::text, p_informed_consent_special_provisions text DEFAULT NULL::text, p_is_active boolean DEFAULT true, p_is_umbrella boolean DEFAULT false, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_protocol_url text DEFAULT NULL::text, p_products text[] DEFAULT NULL::text[], p_name_key text DEFAULT NULL::text, p_description_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_code text;
  v_name text;
  v_study_type public.study_type;
  v_funding_goal numeric;
  v_protocol_url text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'manage_studies') THEN
    RAISE EXCEPTION 'Access denied: manage_studies permission required';
  END IF;

  v_code := NULLIF(trim(p_code), '');
  v_name := NULLIF(trim(p_name), '');
  IF v_code IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'Invalid input: code and name are required' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_study_type := p_study_type::public.study_type;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Invalid study_type' USING ERRCODE = '22023';
  END;

  v_funding_goal := COALESCE(p_funding_goal, 0);
  IF v_funding_goal < 0 THEN
    RAISE EXCEPTION 'Invalid funding_goal' USING ERRCODE = '22023';
  END IF;

  v_protocol_url := NULLIF(trim(COALESCE(p_protocol_url, '')), '');
  IF v_protocol_url IS NOT NULL AND v_protocol_url !~* '^https?://'
  THEN
    RAISE EXCEPTION 'Invalid protocol_url' USING ERRCODE = '22023';
  END IF;

  IF p_starts_at IS NOT NULL AND p_ends_at IS NOT NULL AND p_ends_at < p_starts_at THEN
    RAISE EXCEPTION 'Invalid timeline: ends_at must be after starts_at' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.studies (
    code,
    name,
    description,
    study_type,
    target_condition,
    products,
    duration_weeks,
    target_registration,
    min_participants,
    max_participants,
    funding_goal,
    funding_deadline,
    funding_status,
    is_blinded,
    is_active,
    is_umbrella,
    starts_at,
    ends_at,
    protocol_url,
    current_registration,
    current_funding,
    informed_consent_version,
    informed_consent_special_provisions,
    name_key,
    description_key
  )
  VALUES (
    v_code,
    v_name,
    p_description,
    v_study_type,
    p_target_condition,
    p_products,
    p_duration_weeks,
    p_target_registration,
    COALESCE(p_min_participants, 0),
    p_max_participants,
    v_funding_goal,
    CASE WHEN p_funding_deadline IS NULL THEN NULL ELSE p_funding_deadline::timestamptz END,
    'draft',
    COALESCE(p_is_blinded, false),
    COALESCE(p_is_active, true),
    COALESCE(p_is_umbrella, false),
    p_starts_at,
    p_ends_at,
    v_protocol_url,
    0,
    0,
    p_informed_consent_version,
    p_informed_consent_special_provisions,
    NULLIF(trim(p_name_key), ''),
    NULLIF(trim(p_description_key), '')
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'studies'::public.journal_area,
      p_details := jsonb_build_object('study_id', v_id),
      p_entity_id := v_id::text,
      p_entity_type := 'studies',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin created study',
      p_tags := ARRAY['admin','studies','create'],
      p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_study_admin(p_code text, p_name text, p_description text, p_study_type text, p_target_condition text, p_duration_weeks integer, p_target_registration integer, p_min_participants integer, p_max_participants integer, p_funding_goal numeric, p_funding_deadline date, p_is_blinded boolean, p_informed_consent_version text, p_informed_consent_special_provisions text, p_is_active boolean, p_is_umbrella boolean, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_protocol_url text, p_products text[], p_name_key text, p_description_key text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_study_admin(p_code text, p_name text, p_description text, p_study_type text, p_target_condition text, p_duration_weeks integer, p_target_registration integer, p_min_participants integer, p_max_participants integer, p_funding_goal numeric, p_funding_deadline date, p_is_blinded boolean, p_informed_consent_version text, p_informed_consent_special_provisions text, p_is_active boolean, p_is_umbrella boolean, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_protocol_url text, p_products text[], p_name_key text, p_description_key text) TO authenticated;
