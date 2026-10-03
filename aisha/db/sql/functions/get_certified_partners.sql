-- Function: public.get_certified_partners
-- Arguments: p_include_availability BOOLEAN, p_randomize BOOLEAN, p_limit INTEGER
-- Description: Returns certified partners with optional availability data, randomization, and limit.
-- Restored 2026-01-08: Full parameterized version from migration 20251220030000.
-- Security: SECURITY DEFINER, public access (seznam partnerů na /partners je veřejný)

CREATE OR REPLACE FUNCTION public.get_certified_partners(
  p_include_availability BOOLEAN DEFAULT FALSE,
  p_randomize BOOLEAN DEFAULT FALSE,
  p_limit INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $function$
DECLARE
  v_result JSONB;
  v_partners JSONB;
  v_availability JSONB;
BEGIN
  -- Get certified partners from partner_profiles
  SELECT jsonb_agg(row_to_json(p)::jsonb)
  INTO v_partners
  FROM (
    SELECT 
      pp.id,
      pp.user_id,
      pp.certification_level,
      pp.is_production_provider,
      pp.business_name,
      pp.display_name,
      pp.description,
      pp.notes_for_visitors,
      pp.languages,
      pp.city,
      pp.country,
      pp.website,
      pp.services,
      pp.is_visible,
      pp.accepts_online_appointments,
      pp.accepts_in_person_appointments,
      pp.certification_passed_at,
      pp.certification_score,
      pp.avatar_url,
      pp.created_at,
      pp.updated_at
    FROM partner_profiles pp
    WHERE pp.certification_passed_at IS NOT NULL
      AND pp.is_visible = TRUE
    ORDER BY 
      CASE WHEN p_randomize THEN RANDOM() ELSE 0 END,
      pp.certification_score DESC NULLS LAST
    LIMIT p_limit
  ) p;

  IF v_partners IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  -- Include availability if requested
  IF p_include_availability THEN
    SELECT jsonb_object_agg(partner_id, slots)
    INTO v_availability
    FROM (
      SELECT 
        pa.partner_id,
        jsonb_agg(jsonb_build_object(
          'id', pa.id,
          'partner_id', pa.partner_id,
          'day_of_week', pa.day_of_week,
          'start_time', pa.start_time,
          'end_time', pa.end_time,
          'is_online', pa.is_online,
          'created_at', pa.created_at
        )) AS slots
      FROM partner_availability pa
      WHERE pa.partner_id IN (SELECT (p->>'id')::UUID FROM jsonb_array_elements(v_partners) p)
      GROUP BY pa.partner_id
    ) a;

    -- Merge availability into partners
    SELECT jsonb_agg(
      p || jsonb_build_object(
        'availability', COALESCE(v_availability->(p->>'id'), '[]'::JSONB),
        'hasAvailability', v_availability->(p->>'id') IS NOT NULL 
          AND jsonb_array_length(COALESCE(v_availability->(p->>'id'), '[]'::JSONB)) > 0
      )
    )
    INTO v_result
    FROM jsonb_array_elements(v_partners) p;
    
    RETURN COALESCE(v_result, '[]'::JSONB);
  END IF;

  -- Add hasAvailability: false to all if not including availability
  SELECT jsonb_agg(
    p || jsonb_build_object('hasAvailability', FALSE, 'availability', '[]'::JSONB)
  )
  INTO v_result
  FROM jsonb_array_elements(v_partners) p;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$;

COMMENT ON FUNCTION public.get_certified_partners(boolean, boolean, integer) IS 
  'Get certified partners with optional availability, randomization, and limit. RPC-only.';

-- Permissions (PUBLIC: seznam partnerů na /partners je veřejný)
REVOKE ALL ON FUNCTION public.get_certified_partners(BOOLEAN, BOOLEAN, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_certified_partners(BOOLEAN, BOOLEAN, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION public.get_certified_partners(BOOLEAN, BOOLEAN, INTEGER) TO authenticated;
