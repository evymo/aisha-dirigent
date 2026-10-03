-- Function: public.get_my_vouchers
-- Returns the authenticated user's product vouchers (most recent first).

CREATE OR REPLACE FUNCTION public.get_my_vouchers(
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  code text,
  product_id uuid,
  status text,
  points_cost int4,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    pv.id,
    pv.code,
    pv.product_id,
    pv.status,
    pv.points_cost,
    pv.expires_at,
    pv.used_at,
    pv.created_at
  FROM public.product_vouchers pv
  WHERE pv.user_id = v_user_id
  ORDER BY pv.created_at DESC
  LIMIT GREATEST(1, COALESCE(p_limit, 100));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_vouchers(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_vouchers(integer) TO authenticated;
