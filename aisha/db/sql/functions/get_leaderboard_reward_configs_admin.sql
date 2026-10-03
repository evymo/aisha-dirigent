-- get_leaderboard_reward_configs_admin: List all leaderboard reward configurations
CREATE OR REPLACE FUNCTION public.get_leaderboard_reward_configs_admin()
RETURNS TABLE (
  bonus_token_type text,
  bonus_tokens integer,
  created_at timestamptz,
  id uuid,
  is_active boolean,
  period_type text,
  product_name text,
  rank_from integer,
  rank_to integer,
  updated_at timestamptz,
  voucher_product_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.bonus_token_type,
    c.bonus_tokens,
    c.created_at,
    c.id,
    c.is_active,
    c.period_type,
    COALESCE(p.name, '') AS product_name,
    c.rank_from,
    c.rank_to,
    c.updated_at,
    c.voucher_product_id
  FROM public.leaderboard_reward_config c
  LEFT JOIN public.products p ON p.id = c.voucher_product_id
  ORDER BY c.period_type, c.rank_from;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_leaderboard_reward_configs_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_reward_configs_admin() TO authenticated;
