-- Function: public.get_my_products_audited
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_my_products_audited()
 RETURNS TABLE(category text, created_at timestamptz, created_by uuid, default_dose_amount numeric, default_dose_timing text[], default_dose_unit text, default_doses_per_day integer, description text, id uuid, is_public boolean, name text, package_size numeric, package_unit text, usage_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO audit_journal (user_id, action_type, entity_type, area, severity, summary)
  VALUES (v_user_id, 'read', 'member_products', 'member', 'info', 'Member viewed products');

  RETURN QUERY
  SELECT 
    ms.category,
    ms.created_at,
    ms.created_by,
    ms.default_dose_amount,
    ms.default_dose_timing,
    ms.default_dose_unit,
    ms.default_doses_per_day,
    ms.description,
    ms.id,
    ms.is_public,
    ms.name,
    ms.package_size,
    ms.package_unit,
    ms.usage_count
  FROM member_products ms
  WHERE ms.created_by = v_user_id OR ms.is_public = true
  ORDER BY ms.name;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_products_audited() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_products_audited() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_products_audited() TO service_role;
