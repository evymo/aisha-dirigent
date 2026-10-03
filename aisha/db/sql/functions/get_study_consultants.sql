-- Function: public.get_study_consultants
-- Arguments: p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:33+01:00

CREATE OR REPLACE FUNCTION public.get_study_consultants(p_study_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'id', sc.id,
    'study_id', sc.study_id,
    'partner_id', sc.partner_id,
    'role', sc.role,
    'status', sc.status,
    'max_participants', sc.max_participants,
    'notes', sc.notes,
    'approved_at', sc.approved_at,
    'created_at', sc.created_at,
    'partner', jsonb_build_object(
      'display_name', pp.display_name,
      'business_name', pp.business_name,
      'city', pp.city,
      'is_production_provider', pp.is_production_provider
    )
  ))
  INTO v_result
  FROM study_consultants sc
  LEFT JOIN partner_profiles pp ON pp.id = sc.partner_id
  WHERE sc.study_id = p_study_id
  ORDER BY sc.created_at;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_consultants(p_study_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_study_consultants(p_study_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_study_consultants(p_study_id uuid) TO authenticated;
