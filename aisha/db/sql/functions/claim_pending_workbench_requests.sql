-- Function: claim_pending_workbench_requests
-- The aisha-dirigent extension polls this to atomically CLAIM the oldest pending
-- request(s): the UPDATE … WHERE id IN (… FOR UPDATE SKIP LOCKED) flips pending→claimed in
-- one statement, so two extension windows never grab the same row. Authenticated (the dev
-- user is admin/staff) or service_role. Params alphabetical.
--
-- LEASE / stale-claim recovery: a claim is a time-bounded LEASE, not a permanent hold. A
-- request that is claimed but never completed — the extension crashed / the machine slept
-- mid-run, or complete_workbench_request failed persistently — would otherwise sit 'claimed'
-- forever (this function previously only re-selected 'pending'), leaking the row permanently.
-- This function also reclaims rows whose lease has EXPIRED (status='claimed' AND claimed_at
-- < now() - lease). Its PRIMARY, always-achieved purpose is to FREE that permanently-stuck
-- row: the reclaimed request is re-run and reaches a terminal state (completed/failed) instead
-- of leaking. It re-delivers the result to the ORIGINAL block-polling producer only when that
-- poll window (svc-ai-chat AISHA_WORKBENCH_POLL_TIMEOUT_MS, default 60s) is configured to
-- exceed lease + a re-run (~150s+); under the default 60s the lease (120s) expires AFTER the
-- producer already returned workbench_timeout, so the reclaim serves QUEUE HYGIENE (a later
-- claimant re-runs to a terminal state) rather than the original waiter. These two constants
-- are intentionally decoupled — no single lease can serve a 60s window (a re-run alone is
-- ~32s and the lease floor is >32s to avoid stealing live claims), so recovery-to-waiter is a
-- config choice (raise the poll timeout), while leak-prevention holds unconditionally.
--
-- The lease is a fixed CONSTANT (not a caller parameter): the function is granted to
-- `authenticated`, so a caller-supplied lease would let any dev pass a tiny value and steal
-- everyone's in-flight claims. The constant MUST exceed the longest legitimate run (local
-- edge run ~30s + the extension's complete retries ≈ 32s ceiling); 120s gives a ~4× margin,
-- so a still-running claim is never reclaimed. Reclaim is race-safe (same FOR UPDATE SKIP
-- LOCKED) and corruption-safe (complete_workbench_request only updates pending/claimed rows,
-- so a revived dead claimant's late completion is an idempotent no-op — first writer wins).
-- Reclaiming renews the lease: claimed_by := the new session, claimed_at := now(). Keeping
-- the (integer, text) signature means the generated db types + PostgREST cache are untouched.
--
-- DEAD-LETTER CAP: claim_attempts is incremented on every (re)claim. A request whose
-- claimant reliably dies BEFORE completing (an editor that crashes on a specific clow, a
-- suspend/resume loop) would otherwise be reclaimed and re-run every lease FOREVER, burning
-- local-model compute with no ceiling. So once a stale claim has hit v_max_attempts it is
-- dead-lettered to terminal 'failed' (error_detail.reason='lease_expired_max_attempts')
-- instead of reclaimed. A run that EXECUTES and fails is already marked 'failed' by
-- complete_workbench_request and never reaches the cap — only pre-completion death does.

CREATE OR REPLACE FUNCTION public.claim_pending_workbench_requests(
  p_limit      integer DEFAULT 1,
  p_session_id text    DEFAULT NULL
)
RETURNS SETOF workbench_execution_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Longest legit run (~32s) with a ~4× safety margin. A claim older than this
  -- without completion is treated as abandoned and is reclaimable.
  v_lease constant interval := interval '120 seconds';
  -- Max total (re)claims before a request whose claimant keeps dying BEFORE
  -- completing is dead-lettered to 'failed' instead of re-run forever every lease.
  v_max_attempts constant integer := 5;
BEGIN
  IF auth.uid() IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb ->> 'role') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Dead-letter FIRST: a stale claim that has already exhausted its attempts is
  -- transitioned to terminal 'failed' rather than reclaimed — this bounds the
  -- re-run-forever case for a claimant that reliably dies pre-completion (a run
  -- that executes and FAILS is marked 'failed' by complete_workbench_request and
  -- is never reclaimed, so only pre-completion death reaches here). Dead-lettered
  -- rows are NOT returned for execution; running before the claim excludes a
  -- just-swept row from the reclaim candidate set below.
  UPDATE workbench_execution_requests
  SET status       = 'failed',
      error_detail = jsonb_build_object('reason', 'lease_expired_max_attempts',
                                        'claim_attempts', claim_attempts),
      completed_at = now()
  WHERE status = 'claimed'
    AND (claimed_at IS NULL OR claimed_at < now() - v_lease)
    AND claim_attempts >= v_max_attempts;

  RETURN QUERY
  UPDATE workbench_execution_requests w
  SET status = 'claimed', claimed_by = p_session_id, claimed_at = now(),
      claim_attempts = w.claim_attempts + 1
  WHERE w.id IN (
    SELECT id FROM workbench_execution_requests
    WHERE status = 'pending'
       -- Expired lease: a stale 'claimed' row whose owner never completed it. A
       -- 'claimed' row with NULL claimed_at is malformed (this fn always co-sets
       -- claimed_at); treat it as immediately reclaimable so it can never strand.
       -- Only reclaim BELOW the attempt cap; at/above it the sweep above ended it.
       OR (status = 'claimed'
           AND (claimed_at IS NULL OR claimed_at < now() - v_lease)
           AND claim_attempts < v_max_attempts)
    ORDER BY enqueued_at ASC
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING w.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_workbench_requests(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_workbench_requests(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_workbench_requests(integer, text) TO service_role;

COMMENT ON FUNCTION public.claim_pending_workbench_requests(integer, text) IS
  'PR-J: the extension atomically claims (FOR UPDATE SKIP LOCKED) the oldest pending requests AND reclaims stale claims whose 120s lease expired; a claim that keeps expiring is dead-lettered to failed after 5 attempts. authenticated/service_role.';
