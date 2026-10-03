-- Function: public.get_my_distribution_plans
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_my_distribution_plans()
 RETURNS TABLE(id uuid, protocol_id uuid, starts_at timestamptz, ends_at timestamptz, custom_dose_amount numeric, custom_doses_per_day integer, custom_instructions text, status text, compliance_target numeric, is_vip boolean, compensation_percentage numeric, protocol jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Return empty result if no distribution_plans table exists yet
  -- This allows the component to work without errors
  RETURN QUERY
  SELECT 
    se.id,
    NULL::UUID as protocol_id,
    se.enrolled_at as starts_at,
    se.completed_at as ends_at,
    NULL::NUMERIC as custom_dose_amount,
    NULL::INTEGER as custom_doses_per_day,
    NULL::TEXT as custom_instructions,
    se.status::TEXT,
    0.9::NUMERIC as compliance_target,
    false as is_vip,
    0::NUMERIC as compensation_percentage,
    jsonb_build_object(
      'dose_amount', 5,
      'dose_unit', 'ml',
      'doses_per_day', 3,
      'dose_timing', ARRAY['morning', 'noon', 'evening'],
      'take_with_food', false,
      'instructions_key', 'distribution.default_instructions',
      'product', jsonb_build_object('name', s.name),
      'study', jsonb_build_object('name', s.name, 'code', s.code)
    ) as protocol
  FROM study_registrations se
  JOIN studies s ON s.id = se.study_id
  WHERE se.user_id = auth.uid()
    AND se.status IN ('enrolled', 'active')
  ORDER BY se.enrolled_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_distribution_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_distribution_plans() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_distribution_plans() TO service_role;
