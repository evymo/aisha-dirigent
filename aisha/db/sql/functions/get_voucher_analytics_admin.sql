-- get_voucher_analytics_admin: Aggregated voucher metrics
CREATE OR REPLACE FUNCTION public.get_voucher_analytics_admin()
RETURNS TABLE (
  active_count bigint,
  avg_points_cost numeric,
  conversion_rate numeric,
  expired_count bigint,
  total_issued bigint,
  total_points_spent bigint,
  used_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Audit log
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'VOUCHER_ANALYTICS_VIEW', jsonb_build_object(
    'area', 'admin',
    'severity', 'info'
  ));

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE v.status = 'active') AS active_count,
    COALESCE(AVG(v.points_cost) FILTER (WHERE v.points_cost > 0), 0) AS avg_points_cost,
    CASE
      WHEN COUNT(*) > 0 THEN
        ROUND((COUNT(*) FILTER (WHERE v.status = 'used'))::numeric / COUNT(*)::numeric * 100, 1)
      ELSE 0
    END AS conversion_rate,
    COUNT(*) FILTER (WHERE v.status = 'expired' OR (v.status = 'active' AND v.expires_at < now())) AS expired_count,
    COUNT(*) AS total_issued,
    COALESCE(SUM(v.points_cost) FILTER (WHERE v.points_cost > 0), 0)::bigint AS total_points_spent,
    COUNT(*) FILTER (WHERE v.status = 'used') AS used_count
  FROM public.product_vouchers v;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_voucher_analytics_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_voucher_analytics_admin() TO authenticated;
