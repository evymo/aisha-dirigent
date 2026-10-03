-- ============================================================================
-- Source of Truth: fn_check_and_consume_llm_quota_audited
-- Phase 12 WP 2.3 — LLM token rate limit per JWT.sub
--
-- Pre-LLM-call quota gate. Called from svc-ai-chat (and any other service
-- that issues LLM calls on behalf of an authenticated user) BEFORE actually
-- dispatching to the LLM provider. The RPC:
--
--   1. Lazy-creates the user's llm_quota row from llm_tier_defaults('free')
--      on first call
--   2. Resets daily counters if last_reset_at is from a previous day
--   3. Checks both token + cost budgets
--   4. If allowed: increments the counters atomically, returns ok
--   5. If denied: writes an audit_journal entry (security signal — repeated
--      denials = compromised account or runaway script), returns 429 envelope
--
-- IMPORTANT: This is called per LLM call (not per chat turn). The token + cost
-- estimates are PRE-call values; the caller may over-estimate slightly to be
-- safe. Future WP will reconcile post-call actuals via a separate
-- fn_reconcile_llm_consumption RPC (not in this PR).
--
-- Security: SECURITY DEFINER, GRANT EXECUTE TO authenticated + service_role. The function
-- gates on the END-USER identified by p_user_id rather than on the calling service's own
-- token — that is the point of the RPC, and why `authenticated` keeps the grant. What
-- changed on 2026-07-15 is that a non-service caller may now only assert THEMSELVES as
-- p_user_id (see the guard in the body).
--
-- Audit: INSERT INTO audit_journal on DENIAL only. Metadata: tier, reason,
-- requested + consumed counters, limits. NO PII (no user email, no prompt).
-- ============================================================================

-- The third parameter was renamed p_cost_usd → p_cost when hardcoded currency
-- literals were removed from the schema. The SIGNATURE is unchanged
-- (uuid, int, numeric), so CREATE OR REPLACE matches the existing function and
-- then fails — Postgres cannot rename an input parameter in place:
--
--   ERROR: cannot change name of input parameter "p_cost_usd"
--   HINT:  Use DROP FUNCTION fn_check_and_consume_llm_quota_audited(...) first.
--
-- heals.sql runs on EVERY migrate, so this aborts the whole run (exit 1) on any
-- database created before the rename. A from-baseline database has no prior
-- function and never hits it — which is exactly why it stayed invisible: the
-- fresh-DB path is green and only UPGRADING installs break.
--
-- Same DROP-first convention as get_study_detail.sql / import_story_bundle.sql.
-- Dropping clears the privileges, which the REVOKE/GRANT/COMMENT block at the
-- end of this file re-applies on every run.
DROP FUNCTION IF EXISTS public.fn_check_and_consume_llm_quota_audited(uuid, int, numeric);

CREATE OR REPLACE FUNCTION public.fn_check_and_consume_llm_quota_audited(
  p_user_id  uuid,
  p_tokens   int,
  p_cost numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_quota   public.llm_quota%ROWTYPE;
  v_default public.llm_tier_defaults%ROWTYPE;
  v_allowed boolean;
  v_reason  text;
BEGIN
  -- AUTHORIZATION FIRST. The old guard here had two defects (2026-07-15 IDOR audit,
  -- docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md):
  --
  --  (a) It asked only "is SOMEONE authenticated?", never "is p_user_id actually them?".
  --      Combined with the `authenticated` GRANT, any logged-in user could bill their own
  --      LLM spend to a victim's daily quota — raising their effective limit while denying
  --      the victim service, and poisoning the victim's audit trail with the denials.
  --  (b) It read the role GUC directly. NOT a fail-open — an earlier version of the audit claimed
  --      `current_setting('role', true) != 'service_role'` folds to NULL, and that is FALSE:
  --      `role` is a BUILT-IN GUC and returns 'none', never NULL, so the old guard fired correctly.
  --      (Only DOTTED custom GUCs like request.jwt.claims fold to NULL; PostgreSQL rejects undotted
  --      custom GUCs outright.) is_service_role() is used here because it is the canonical reader —
  --      one place that knows the legacy-GUC/JSON-claims compatibility and the SET ROLE case — not
  --      because the old expression was unsafe.
  --
  -- The p_user_id pin below IS the fix. The `authenticated` grant stays (WP 2.3 gates an end user
  -- on their own quota, per JWT.sub) — a grant is not a defect, a grant without an ownership check is.
  IF NOT public.is_service_role()
     AND NOT public.is_admin_or_staff()
     AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid())
  THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Validate inputs
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_tokens IS NULL OR p_tokens < 0 THEN
    RAISE EXCEPTION 'p_tokens must be >= 0' USING ERRCODE = '22023';
  END IF;
  IF p_cost IS NULL OR p_cost < 0 THEN
    RAISE EXCEPTION 'p_cost must be >= 0' USING ERRCODE = '22023';
  END IF;

  -- Lock the row (or upsert from 'free' tier defaults)
  SELECT * INTO v_quota
  FROM public.llm_quota
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Lazy create from free tier defaults
    SELECT * INTO v_default
    FROM public.llm_tier_defaults
    WHERE tier = 'free';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'llm_tier_defaults seed missing — free tier not configured'
        USING ERRCODE = '42704';
    END IF;

    INSERT INTO public.llm_quota (
      user_id, tier, daily_token_limit, daily_cost_limit
    ) VALUES (
      p_user_id, 'free', v_default.daily_token_limit, v_default.daily_cost_limit
    )
    RETURNING * INTO v_quota;
  END IF;

  -- Reset if new day (UTC)
  IF v_quota.last_reset_at < date_trunc('day', now()) THEN
    UPDATE public.llm_quota SET
      consumed_tokens_today = 0,
      consumed_cost_today   = 0,
      last_reset_at         = date_trunc('day', now()),
      updated_at            = now()
    WHERE user_id = p_user_id
    RETURNING * INTO v_quota;
  END IF;

  -- Check limits
  IF v_quota.consumed_tokens_today + p_tokens > v_quota.daily_token_limit THEN
    v_allowed := false;
    v_reason  := 'token_limit_exceeded';
  ELSIF v_quota.consumed_cost_today + p_cost > v_quota.daily_cost_limit THEN
    v_allowed := false;
    v_reason  := 'cost_limit_exceeded';
  ELSE
    v_allowed := true;
    v_reason  := 'ok';

    -- Consume atomically (already locked above)
    UPDATE public.llm_quota SET
      consumed_tokens_today = consumed_tokens_today + p_tokens,
      consumed_cost_today   = consumed_cost_today + p_cost,
      updated_at            = now()
    WHERE user_id = p_user_id
    RETURNING * INTO v_quota;
  END IF;

  -- AUDIT on denial only — security signal. No PII (only IDs + numeric stats).
  IF NOT v_allowed THEN
    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (
      p_user_id,
      'llm.quota.denied',
      jsonb_build_object(
        'reason',                v_reason,
        'tier',                  v_quota.tier,
        'requested_tokens',      p_tokens,
        'requested_cost',    p_cost,
        'consumed_tokens_today', v_quota.consumed_tokens_today,
        'consumed_cost_today',   v_quota.consumed_cost_today,
        'daily_token_limit',     v_quota.daily_token_limit,
        'daily_cost_limit',  v_quota.daily_cost_limit
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed',             v_allowed,
    'reason',              v_reason,
    'remaining_tokens',    GREATEST(0, v_quota.daily_token_limit - v_quota.consumed_tokens_today),
    'remaining_cost',  GREATEST(0, v_quota.daily_cost_limit - v_quota.consumed_cost_today),
    'tier',                v_quota.tier,
    'reset_at',            v_quota.last_reset_at + interval '1 day'
  );
END;
$$;

-- The `authenticated` grant is deliberate and part of the WP 2.3 contract (an end user gates
-- their OWN quota per JWT.sub — src/tests/gates/wp-2-3-llm-quota.gate.test.ts asserts it). It was
-- never the defect: the defect was granting it with no check that p_user_id was the caller, which
-- let one user bill their spend to another's ledger. The guard in the body now enforces that, so
-- the grant is safe — an authenticated caller can only ever consume their own quota.
REVOKE ALL ON FUNCTION public.fn_check_and_consume_llm_quota_audited(uuid, int, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_check_and_consume_llm_quota_audited(uuid, int, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_and_consume_llm_quota_audited(uuid, int, numeric) TO service_role;

COMMENT ON FUNCTION public.fn_check_and_consume_llm_quota_audited(uuid, int, numeric) IS
  'Phase 12 WP 2.3 — pre-LLM-call quota gate. Lazy-creates row from free tier, resets daily, atomically consumes, audits denial only. Returns jsonb {allowed, reason, remaining_tokens, remaining_cost, tier, reset_at}.';
