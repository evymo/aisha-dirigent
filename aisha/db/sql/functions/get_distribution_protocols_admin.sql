-- Function: public.get_distribution_protocols_admin
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_distribution_protocols_admin()
 RETURNS TABLE(arm_code text, created_at timestamptz, description text, description_key text, dose_amount numeric, dose_timing text[], dose_unit text, doses_per_day integer, id uuid, is_active boolean, name text, name_key text, product_id uuid, product_name text, study_code text, study_id uuid, study_name text, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  INSERT INTO audit_journal (
    action, user_id, action_type, entity_type, area, severity, summary
  ) VALUES (
    'GET_DOSAGE_PROTOCOLS_ADMIN', auth.uid(), 'read'::journal_action_type, 'distribution_protocols',
    'studies'::journal_area, 'info'::journal_severity,
    'Admin viewed distribution protocols list'
  );

  RETURN QUERY
  SELECT
    dp.arm_code,
    dp.created_at,
    dp.description,
    dp.description_key,
    dp.dose_amount,
    dp.dose_timing,
    dp.dose_unit,
    dp.doses_per_day,
    dp.id,
    dp.is_active,
    dp.name,
    dp.name_key,
    dp.product_id,
    p.name AS product_name,
    s.code AS study_code,
    dp.study_id,
    s.name AS study_name,
    dp.updated_at
  FROM public.distribution_protocols dp
  LEFT JOIN public.studies s ON dp.study_id = s.id
  LEFT JOIN public.products p ON dp.product_id = p.id
  ORDER BY dp.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_distribution_protocols_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_distribution_protocols_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_distribution_protocols_admin() TO service_role;
