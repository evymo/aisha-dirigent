-- ============================================================================
-- Source of Truth: fn_get_llm_quota_status
-- Phase 12 WP 2.3 — LLM token rate limit per JWT.sub (read-only companion)
--
-- Returns the caller's own quota status WITHOUT consuming anything. Used by
-- the workbench to display "X tokens remaining today" + tier badge on the
-- chat surface header.
--
-- If the caller has no llm_quota row yet (never made an LLM call), returns
-- the FREE tier defaults — same value the next fn_check_and_consume call
-- would lazy-create. No write side-effect.
--
-- Security: SECURITY DEFINER + GRANT EXECUTE TO authenticated. Returns own
-- row only (auth.uid() filter); admin can pass p_user_id to query any user.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_llm_quota_status(
  p_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_target_id uuid;
  v_quota     public.llm_quota%ROWTYPE;
  v_default   public.llm_tier_defaults%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  -- Auth-first: default to auth.uid(), promote to p_user_id ONLY after an
  -- explicit role check. This pattern prevents the parameter-first
  -- vulnerability where a malicious caller passes p_user_id to bypass
  -- auth.uid() before the admin guard fires.
  v_target_id := auth.uid();
  IF p_user_id IS NOT NULL AND p_user_id != auth.uid() THEN
    IF public.get_jwt_role() NOT IN ('admin', 'staff', 'service_role') THEN
      RAISE EXCEPTION 'Forbidden: only admin/staff may query other users'
        USING ERRCODE = '42501';
    END IF;
    v_target_id := p_user_id;
  END IF;

  SELECT * INTO v_quota
  FROM public.llm_quota
  WHERE user_id = v_target_id;

  IF NOT FOUND THEN
    -- No row yet → return free-tier defaults shape WITHOUT side effect
    SELECT * INTO v_default
    FROM public.llm_tier_defaults
    WHERE tier = 'free';

    RETURN jsonb_build_object(
      'user_id',               v_target_id,
      'tier',                  COALESCE(v_default.tier, 'free'),
      'daily_token_limit',     COALESCE(v_default.daily_token_limit, 0),
      'daily_cost_limit',  COALESCE(v_default.daily_cost_limit, 0),
      'consumed_tokens_today', 0,
      'consumed_cost_today',   0,
      'remaining_tokens',      COALESCE(v_default.daily_token_limit, 0),
      'remaining_cost',    COALESCE(v_default.daily_cost_limit, 0),
      'last_reset_at',         date_trunc('day', now()),
      'reset_at',              date_trunc('day', now()) + interval '1 day',
      'lazy_only',             true
    );
  END IF;

  -- Mid-day phantom reset for callers (counters reset at midnight UTC by
  -- pg_cron — but if cron hasn't fired yet and last_reset_at is from
  -- yesterday, surface the post-reset values so the UI doesn't show stale
  -- "0 remaining" on the dot.
  IF v_quota.last_reset_at < date_trunc('day', now()) THEN
    RETURN jsonb_build_object(
      'user_id',               v_target_id,
      'tier',                  v_quota.tier,
      'daily_token_limit',     v_quota.daily_token_limit,
      'daily_cost_limit',  v_quota.daily_cost_limit,
      'consumed_tokens_today', 0,
      'consumed_cost_today',   0,
      'remaining_tokens',      v_quota.daily_token_limit,
      'remaining_cost',    v_quota.daily_cost_limit,
      'last_reset_at',         date_trunc('day', now()),
      'reset_at',              date_trunc('day', now()) + interval '1 day',
      'lazy_only',             false
    );
  END IF;

  RETURN jsonb_build_object(
    'user_id',               v_quota.user_id,
    'tier',                  v_quota.tier,
    'daily_token_limit',     v_quota.daily_token_limit,
    'daily_cost_limit',  v_quota.daily_cost_limit,
    'consumed_tokens_today', v_quota.consumed_tokens_today,
    'consumed_cost_today',   v_quota.consumed_cost_today,
    'remaining_tokens',      GREATEST(0, v_quota.daily_token_limit - v_quota.consumed_tokens_today),
    'remaining_cost',    GREATEST(0, v_quota.daily_cost_limit - v_quota.consumed_cost_today),
    'last_reset_at',         v_quota.last_reset_at,
    'reset_at',              v_quota.last_reset_at + interval '1 day',
    'lazy_only',             false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_llm_quota_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_llm_quota_status(uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_get_llm_quota_status(uuid) IS
  'Phase 12 WP 2.3 — read-only LLM quota status for self (auth.uid()) or any user (admin only). No write side-effect.';
