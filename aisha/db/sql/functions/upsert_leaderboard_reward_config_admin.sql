-- upsert_leaderboard_reward_config_admin: Create or update leaderboard reward configuration
CREATE OR REPLACE FUNCTION public.upsert_leaderboard_reward_config_admin(
  p_bonus_token_type text DEFAULT 'aisha',
  p_bonus_tokens integer DEFAULT 0,
  p_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_period_type text DEFAULT 'weekly',
  p_rank_from integer DEFAULT 1,
  p_rank_to integer DEFAULT 1,
  p_voucher_product_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_result_id uuid;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.leaderboard_reward_config SET
      bonus_token_type = p_bonus_token_type,
      bonus_tokens = p_bonus_tokens,
      is_active = p_is_active,
      period_type = p_period_type,
      rank_from = p_rank_from,
      rank_to = p_rank_to,
      voucher_product_id = p_voucher_product_id,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_result_id;
  ELSE
    INSERT INTO public.leaderboard_reward_config (
      bonus_token_type,
      bonus_tokens,
      is_active,
      period_type,
      rank_from,
      rank_to,
      voucher_product_id
    ) VALUES (
      p_bonus_token_type,
      p_bonus_tokens,
      p_is_active,
      p_period_type,
      p_rank_from,
      p_rank_to,
      p_voucher_product_id
    )
    RETURNING id INTO v_result_id;
  END IF;

  -- Audit log
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_admin_id, 'LEADERBOARD_REWARD_CONFIG_UPSERT', jsonb_build_object(
    'area', 'admin',
    'severity', 'info',
    'config_id', v_result_id,
    'period_type', p_period_type,
    'rank_from', p_rank_from,
    'rank_to', p_rank_to
  ));

  RETURN v_result_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_leaderboard_reward_config_admin(text, integer, uuid, boolean, text, integer, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_leaderboard_reward_config_admin(text, integer, uuid, boolean, text, integer, integer, uuid) TO authenticated;
