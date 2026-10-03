-- pgTAP schema-contract tests — workbench queue claim LEASE / stale-claim reclaim.
-- ============================================================================
-- claim_pending_workbench_requests is a time-bounded LEASE (fixed 120s constant),
-- not a permanent hold. Beyond claiming 'pending' rows it must RECLAIM 'claimed'
-- rows whose lease expired (claimed_at < now() - 120s) — otherwise a request whose
-- claimant died mid-run (extension crash / machine sleep / persistently failing
-- complete) sits 'claimed' forever and the producer's block-poll loses the work.
--
-- Proven here (each mutating claim is captured into a TEMP table so the function
-- runs exactly once — set_eq/aggregates over the temp are side-effect free):
--   (1) one claim returns pending + STALE-claimed, and EXCLUDES a fresh (within-
--       lease) claim — a still-running claim is never stolen
--   (2) the reclaimed stale row is re-owned by the new session (claimed_by)
--   (3) reclaim RENEWS the lease (claimed_at ~ now)
--   (4) the fresh claim is untouched (claimed_by unchanged)
--   (5) the pending row was claimed
--   (6) an immediate re-claim finds nothing (no pending, no newly-stale)
--   (7) a 90s-old claim (WITHIN the 120s lease) is NOT reclaimed …
--   (8) … but a 130s-old claim (BEYOND the lease) IS reclaimed
--   (9) a claim EXACTLY 120s old is NOT reclaimed (strict '<' boundary)
--  (10) a 'claimed' row with NULL claimed_at IS reclaimed (malformed → never strand)
--
-- Runs against the APPLIED (unseeded) cold-start schema as superuser (fixtures
-- bypass RLS). service_role JWT claim is set so the claim auth guard passes.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(18);

-- service_role so claim_pending_workbench_requests' auth guard passes deterministically
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Parametric row ids (session GUCs)
SELECT set_config('wb.pending', gen_random_uuid()::text, true);
SELECT set_config('wb.stale',   gen_random_uuid()::text, true);
SELECT set_config('wb.fresh',   gen_random_uuid()::text, true);

-- Seed three rows. enqueued_at order (stale oldest → fresh newest) also proves the
-- ORDER BY enqueued_at path. claimed_at is what the lease is measured against.
INSERT INTO workbench_execution_requests (id, request_input, status, claimed_by, claimed_at, enqueued_at)
VALUES
  (current_setting('wb.stale')::uuid,   'stale',   'claimed', 'dead-session', now() - interval '10 minutes', now() - interval '3 minutes'),
  (current_setting('wb.pending')::uuid, 'pending', 'pending', NULL,           NULL,                          now() - interval '2 minutes'),
  (current_setting('wb.fresh')::uuid,   'fresh',   'claimed', 'live-session', now() - interval '5 seconds',  now() - interval '1 minute');

-- ── (1) reclaim pending + stale, exclude fresh ──────────────────────────────
CREATE TEMP TABLE _claim1 ON COMMIT DROP AS
  SELECT id FROM claim_pending_workbench_requests(p_limit => 10, p_session_id => 'reaper');

SELECT set_eq(
  'SELECT id FROM _claim1',
  ARRAY[current_setting('wb.pending')::uuid, current_setting('wb.stale')::uuid],
  '(1) claim returns the pending row + the stale-claimed row, and excludes the fresh (within-lease) claim'
);

-- ── (2)-(5) post-reclaim row state ──────────────────────────────────────────
SELECT is(
  (SELECT claimed_by FROM workbench_execution_requests WHERE id = current_setting('wb.stale')::uuid),
  'reaper', '(2) the reclaimed stale row is now owned by the new session'
);

SELECT ok(
  (SELECT claimed_at FROM workbench_execution_requests WHERE id = current_setting('wb.stale')::uuid) > now() - interval '30 seconds',
  '(3) reclaim renewed the lease (claimed_at ~ now)'
);

SELECT is(
  (SELECT claimed_by FROM workbench_execution_requests WHERE id = current_setting('wb.fresh')::uuid),
  'live-session', '(4) the fresh (within-lease) claim was NOT stolen'
);

SELECT is(
  (SELECT status FROM workbench_execution_requests WHERE id = current_setting('wb.pending')::uuid),
  'claimed', '(5) the pending row was claimed'
);

-- ── (6) nothing left to claim immediately ───────────────────────────────────
CREATE TEMP TABLE _claim2 ON COMMIT DROP AS
  SELECT id FROM claim_pending_workbench_requests(p_limit => 10, p_session_id => 'reaper2');

SELECT is(
  (SELECT count(*)::int FROM _claim2),
  0, '(6) an immediate re-claim finds no pending or newly-stale rows'
);

-- ── (7)-(10) lease boundary (fixed 120s constant) + NULL-claimed_at guard ───
-- Four rows: 90s-old WITHIN lease (kept), 130s-old BEYOND (reclaimed), EXACTLY
-- 120s-old (kept — strict '<'), and a malformed 'claimed' row with NULL
-- claimed_at (reclaimed — never strand). now() is transaction_timestamp (constant
-- within the txn), so the exact-120s INSERT and the predicate's now()-v_lease
-- resolve to the identical instant, making the strict-boundary assertion exact.
-- By now every earlier row is freshly claimed (~now), so the single claim below
-- reclaims ONLY the 130s-old row and the NULL-claimed_at row.
SELECT set_config('wb.within',  gen_random_uuid()::text, true);
SELECT set_config('wb.expired', gen_random_uuid()::text, true);
SELECT set_config('wb.exact',   gen_random_uuid()::text, true);
SELECT set_config('wb.nullts',  gen_random_uuid()::text, true);
INSERT INTO workbench_execution_requests (id, request_input, status, claimed_by, claimed_at, enqueued_at)
VALUES
  (current_setting('wb.within')::uuid,  'within',  'claimed', 'owner', now() - interval '90 seconds',  now() - interval '9 minutes'),
  (current_setting('wb.expired')::uuid, 'expired', 'claimed', 'owner', now() - interval '130 seconds', now() - interval '10 minutes'),
  (current_setting('wb.exact')::uuid,   'exact',   'claimed', 'owner', now() - interval '120 seconds', now() - interval '8 minutes'),
  (current_setting('wb.nullts')::uuid,  'nullts',  'claimed', 'owner', NULL,                           now() - interval '11 minutes');

CREATE TEMP TABLE _claim3 ON COMMIT DROP AS
  SELECT id FROM claim_pending_workbench_requests(p_limit => 10, p_session_id => 'boundary');

SELECT is(
  (SELECT count(*)::int FROM _claim3 WHERE id = current_setting('wb.within')::uuid),
  0, '(7) a 90s-old claim (within the 120s lease) is NOT reclaimed'
);

SELECT is(
  (SELECT count(*)::int FROM _claim3 WHERE id = current_setting('wb.expired')::uuid),
  1, '(8) a 130s-old claim (beyond the 120s lease) IS reclaimed'
);

SELECT is(
  (SELECT count(*)::int FROM _claim3 WHERE id = current_setting('wb.exact')::uuid),
  0, '(9) a claim EXACTLY 120s old is NOT reclaimed (strict < boundary)'
);

SELECT is(
  (SELECT count(*)::int FROM _claim3 WHERE id = current_setting('wb.nullts')::uuid),
  1, '(10) a malformed claimed row with NULL claimed_at IS reclaimed (never strand)'
);

-- ── (11)-(16) attempt cap / dead-letter (max 5 claims) ──────────────────────
-- Three fresh rows: a pending row (attempts 0), a stale row one below the cap
-- (attempts 4), and a stale row AT the cap (attempts 5). One claim call must:
-- increment the pending row to 1, reclaim the below-cap row (4→5, returned), and
-- DEAD-LETTER the at-cap row to 'failed' (not returned).
SELECT set_config('wb.firstclaim', gen_random_uuid()::text, true);
SELECT set_config('wb.nearcap',    gen_random_uuid()::text, true);
SELECT set_config('wb.atcap',      gen_random_uuid()::text, true);
-- atcap_fresh: AT the cap (attempts=5) but a FRESH claim (within lease) — a
-- legitimately-running 5th attempt. It must NOT be dead-lettered (the sweep's
-- staleness guard), proving the cap can never kill live work.
SELECT set_config('wb.atcap_fresh', gen_random_uuid()::text, true);
INSERT INTO workbench_execution_requests (id, request_input, status, claimed_by, claimed_at, enqueued_at, claim_attempts)
VALUES
  (current_setting('wb.firstclaim')::uuid,  'firstclaim',  'pending', NULL,    NULL,                         now() - interval '20 minutes', 0),
  (current_setting('wb.nearcap')::uuid,     'nearcap',     'claimed', 'owner', now() - interval '5 minutes', now() - interval '19 minutes', 4),
  (current_setting('wb.atcap')::uuid,       'atcap',       'claimed', 'owner', now() - interval '5 minutes', now() - interval '18 minutes', 5),
  (current_setting('wb.atcap_fresh')::uuid, 'atcap_fresh', 'claimed', 'live',  now() - interval '5 seconds', now() - interval '17 minutes', 5);

CREATE TEMP TABLE _claim4 ON COMMIT DROP AS
  SELECT id FROM claim_pending_workbench_requests(p_limit => 10, p_session_id => 'capper');

SELECT is(
  (SELECT claim_attempts FROM workbench_execution_requests WHERE id = current_setting('wb.firstclaim')::uuid),
  1, '(11) a first claim increments claim_attempts 0 -> 1'
);

SELECT is(
  (SELECT claim_attempts FROM workbench_execution_requests WHERE id = current_setting('wb.nearcap')::uuid),
  5, '(12) a stale row below the cap is reclaimed and its attempts incremented (4 -> 5)'
);

SELECT is(
  (SELECT count(*)::int FROM _claim4 WHERE id = current_setting('wb.nearcap')::uuid),
  1, '(13) ... and the below-cap reclaim IS returned for execution'
);

SELECT is(
  (SELECT status FROM workbench_execution_requests WHERE id = current_setting('wb.atcap')::uuid),
  'failed', '(14) a stale row AT the cap is dead-lettered to failed (not re-run forever)'
);

SELECT is(
  (SELECT error_detail->>'reason' FROM workbench_execution_requests WHERE id = current_setting('wb.atcap')::uuid),
  'lease_expired_max_attempts', '(15) ... with error_detail.reason = lease_expired_max_attempts'
);

SELECT is(
  (SELECT count(*)::int FROM _claim4 WHERE id = current_setting('wb.atcap')::uuid),
  0, '(16) the dead-lettered row is NOT returned for execution'
);

-- The critical safety proof: a row AT the cap but a FRESH claim (within lease) is a
-- legitimately-running 5th attempt — it must NOT be dead-lettered nor reclaimed.
SELECT is(
  (SELECT status FROM workbench_execution_requests WHERE id = current_setting('wb.atcap_fresh')::uuid),
  'claimed', '(17) an AT-cap but WITHIN-lease claim is NOT dead-lettered (the cap never kills live work)'
);

SELECT is(
  (SELECT count(*)::int FROM _claim4 WHERE id = current_setting('wb.atcap_fresh')::uuid),
  0, '(18) ... and the live at-cap claim is not stolen/returned either'
);

SELECT * FROM finish();
ROLLBACK;
