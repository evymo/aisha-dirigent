-- Function: public.get_my_partner_availability
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:00+01:00

CREATE OR REPLACE FUNCTION public.get_my_partner_availability()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_user_id UUID;
  v_partner_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT id INTO v_partner_id FROM partner_profiles WHERE user_id = v_user_id;
  IF v_partner_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT jsonb_agg(row_to_json(pa)::jsonb ORDER BY pa.day_of_week, pa.start_time)
  INTO v_result
  FROM partner_availability pa
  WHERE pa.partner_id = v_partner_id;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_partner_availability() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_partner_availability() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_partner_availability() TO authenticated;
