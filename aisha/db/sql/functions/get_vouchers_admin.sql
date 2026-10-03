-- get_vouchers_admin: Admin list of all vouchers with filtering and pagination
CREATE OR REPLACE FUNCTION public.get_vouchers_admin(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_status text DEFAULT NULL
)
RETURNS TABLE (
  code text,
  created_at timestamptz,
  expires_at timestamptz,
  id uuid,
  metadata jsonb,
  points_cost integer,
  product_id uuid,
  product_name text,
  status text,
  updated_at timestamptz,
  used_at timestamptz,
  user_email text,
  user_id uuid
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
  VALUES (v_user_id, 'VOUCHER_ADMIN_LIST', jsonb_build_object(
    'area', 'admin',
    'severity', 'info',
    'limit', p_limit,
    'offset', p_offset,
    'status_filter', p_status
  ));

  RETURN QUERY
  SELECT
    v.code,
    v.created_at,
    v.expires_at,
    v.id,
    v.metadata,
    v.points_cost::integer,
    v.product_id,
    COALESCE(p.name, '') AS product_name,
    v.status,
    v.updated_at,
    v.used_at,
    COALESCE(u.email, '') AS user_email,
    v.user_id
  FROM public.product_vouchers v
  LEFT JOIN public.products p ON p.id = v.product_id
  LEFT JOIN aisha_auth.users u ON u.id = v.user_id
  WHERE (p_status IS NULL OR v.status = p_status)
  ORDER BY v.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_vouchers_admin(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vouchers_admin(integer, integer, text) TO authenticated;
