-- award_leaderboard_rewards: Process token and voucher rewards for a completed leaderboard period
CREATE OR REPLACE FUNCTION public.award_leaderboard_rewards(
  p_period_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_period record;
  v_entry record;
  v_config record;
  v_awarded_count integer := 0;
  v_vouchers_created integer := 0;
  v_voucher_code text;
  v_voucher_id uuid;
  v_attempt integer;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Get period info
  SELECT * INTO v_period
  FROM public.leaderboard_periods
  WHERE id = p_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period not found' USING ERRCODE = 'P0001';
  END IF;

  -- Process each ranked entry
  FOR v_entry IN
    SELECT le.user_id, le.rank, le.total_points
    FROM public.leaderboard_entries le
    WHERE le.period_id = p_period_id
      AND le.rank IS NOT NULL
    ORDER BY le.rank ASC
  LOOP
    -- Find matching reward configs
    FOR v_config IN
      SELECT *
      FROM public.leaderboard_reward_config
      WHERE period_type = v_period.period_type
        AND is_active = true
        AND v_entry.rank >= rank_from
        AND v_entry.rank <= rank_to
    LOOP
      -- Award bonus tokens
      IF v_config.bonus_tokens > 0 THEN
        PERFORM public.award_tokens(
          v_entry.user_id,
          v_config.bonus_token_type,
          v_config.bonus_tokens,
          'leaderboard_reward',
          p_period_id,
          'Leaderboard rank #' || v_entry.rank || ' reward'
        );
        v_awarded_count := v_awarded_count + 1;
      END IF;

      -- Create voucher if product configured
      IF v_config.voucher_product_id IS NOT NULL THEN
        FOR v_attempt IN 1..10 LOOP
          v_voucher_code := upper(substring(md5(gen_random_uuid()::text || clock_timestamp()::text) FROM 1 FOR 8));
          BEGIN
            INSERT INTO public.product_vouchers (
              code, product_id, user_id, status, points_cost, expires_at, metadata
            ) VALUES (
              v_voucher_code,
              v_config.voucher_product_id,
              v_entry.user_id,
              'active',
              0,
              now() + interval '1 year',
              jsonb_build_object(
                'type', 'leaderboard_reward',
                'period_id', p_period_id,
                'rank', v_entry.rank,
                'created_by', v_admin_id
              )
            ) RETURNING product_vouchers.id INTO v_voucher_id;
            v_vouchers_created := v_vouchers_created + 1;
            EXIT;
          EXCEPTION
            WHEN unique_violation THEN NULL;
          END;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- Audit log
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_admin_id, 'LEADERBOARD_REWARDS_AWARDED', jsonb_build_object(
    'area', 'admin',
    'severity', 'info',
    'period_id', p_period_id,
    'period_type', v_period.period_type,
    'tokens_awarded', v_awarded_count,
    'vouchers_created', v_vouchers_created
  ));

  RETURN jsonb_build_object(
    'success', true,
    'tokens_awarded', v_awarded_count,
    'vouchers_created', v_vouchers_created
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.award_leaderboard_rewards(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_leaderboard_rewards(uuid) TO authenticated;
