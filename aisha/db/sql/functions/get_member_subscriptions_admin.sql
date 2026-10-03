-- Function: public.get_member_subscriptions_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:50+01:00

CREATE OR REPLACE FUNCTION public.get_member_subscriptions_admin()
 RETURNS TABLE(amount_paid numeric, created_at timestamptz, currency text, id uuid, membership_id uuid, package_id uuid, package_name text, package_period text, package_tier text, period_end timestamptz, period_start timestamptz, status text, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Check admin/staff permission
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: Admin or staff access required';
  END IF;

  -- Log audit trail with correct enum value
  INSERT INTO audit_journal (action, 
    user_id,
    action_type,
    area,
    entity_type,
    severity,
    summary
  ) VALUES ('GET_MEMBER_SUBSCRIPTIONS_ADMIN', 
    auth.uid(),
    'read',
    'subscriptions',
    'member_subscriptions',
    'info',
    'Admin viewed member subscriptions list'
  );

  RETURN QUERY
  SELECT 
    ms.amount_paid,
    ms.created_at::text,
    ms.currency::text,
    ms.id,
    ms.membership_id,
    ms.package_id,
    COALESCE(sp.name, 'Unknown') AS package_name,
    COALESCE(sp.period::text, 'monthly') AS package_period,
    COALESCE(sp.tier::text, 'basic') AS package_tier,
    COALESCE(ms.period_end::text, '') AS period_end,
    COALESCE(ms.period_start::text, '') AS period_start,
    ms.status::text,
    ms.user_id
  FROM member_subscriptions ms
  LEFT JOIN subscription_packages sp ON ms.package_id = sp.id
  ORDER BY ms.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_member_subscriptions_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_subscriptions_admin() TO authenticated;
