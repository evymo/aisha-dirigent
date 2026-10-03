-- Function: public.cast_governance_vote
-- Custodial cast-vote RPC (LOCKED DECISION D3): records a member's ballot into the
-- LOCAL governance_votes ledger, derives vote WEIGHT server-side from the member's
-- governance token holdings (memberships.tokens_governance — never a client value),
-- recomputes the proposal tally, and BINDS the ballot to the immutable hash chain
-- by inserting a blockchain_audit_records row keyed on
-- reference_table='governance_votes'. One ballot per member per proposal
-- (re-voting updates the same ballot).
-- Security: SECURITY DEFINER, search_path pinned, authenticated members only.

CREATE OR REPLACE FUNCTION public.cast_governance_vote(
  p_proposal_id uuid,
  p_choice text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_proposal public.governance_proposals%ROWTYPE;
  v_weight numeric;
  v_vote_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_choice NOT IN ('for', 'against', 'abstain') THEN
    RAISE EXCEPTION 'Invalid choice "%": allowed = for|against|abstain', p_choice
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_proposal
  FROM public.governance_proposals
  WHERE id = p_proposal_id
  FOR UPDATE;

  IF v_proposal.id IS NULL THEN
    RAISE EXCEPTION 'Unknown proposal %', p_proposal_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_proposal.status <> 'open' THEN
    RAISE EXCEPTION 'Proposal % is not open for voting (status=%)', p_proposal_id, v_proposal.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_proposal.closes_at IS NOT NULL AND v_proposal.closes_at < now() THEN
    RAISE EXCEPTION 'Voting has closed for proposal %', p_proposal_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Vote weight DERIVES from governance token holdings (not a client-supplied
  -- number). memberships has UNIQUE(user_id).
  SELECT COALESCE(tokens_governance, 0) INTO v_weight
  FROM public.memberships
  WHERE user_id = v_user_id;
  v_weight := COALESCE(v_weight, 0);

  IF v_weight <= 0 THEN
    RAISE EXCEPTION 'No governance token holdings — cannot vote'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.governance_votes (proposal_id, user_id, choice, weight)
  VALUES (p_proposal_id, v_user_id, p_choice, v_weight)
  ON CONFLICT (proposal_id, user_id) DO UPDATE
    SET choice = EXCLUDED.choice,
        weight = EXCLUDED.weight,
        created_at = now()
  RETURNING id INTO v_vote_id;

  -- Recompute the running tally from the ballots (quorum evaluated by callers).
  UPDATE public.governance_proposals p
     SET tally = (
       SELECT jsonb_build_object(
         'for',     COALESCE(SUM(v.weight) FILTER (WHERE v.choice = 'for'), 0),
         'against', COALESCE(SUM(v.weight) FILTER (WHERE v.choice = 'against'), 0),
         'abstain', COALESCE(SUM(v.weight) FILTER (WHERE v.choice = 'abstain'), 0),
         'voter_count', COUNT(*)
       )
       FROM public.governance_votes v
       WHERE v.proposal_id = p_proposal_id
     ),
     updated_at = now()
   WHERE p.id = p_proposal_id;

  -- Anchor the ballot into the immutable hash chain (D3: each ballot writes a
  -- blockchain_audit_records row keyed on governance_votes). Idempotent per ballot.
  INSERT INTO public.blockchain_audit_records (
    record_type, data, status, reference_table, reference_id
  ) VALUES (
    'governance_vote',
    jsonb_build_object(
      'proposal_id', p_proposal_id,
      'user_id', v_user_id,
      'choice', p_choice,
      'weight', v_weight
    ),
    'queued',
    'governance_votes',
    v_vote_id
  )
  ON CONFLICT (reference_table, reference_id) WHERE reference_id IS NOT NULL
  DO NOTHING;

  PERFORM public.write_audit_journal(
    p_action_type := 'create'::journal_action_type,
    p_area := 'blockchain'::journal_area,
    p_details := jsonb_build_object('proposal_id', p_proposal_id, 'choice', p_choice, 'weight', v_weight),
    p_entity_id := v_vote_id::text,
    p_entity_type := 'governance_vote',
    p_severity := 'info'::journal_severity,
    p_summary := 'Governance ballot cast',
    p_user_id := v_user_id
  );

  RETURN jsonb_build_object(
    'vote_id', v_vote_id,
    'proposal_id', p_proposal_id,
    'choice', p_choice,
    'weight', v_weight
  );
END;
$function$;

COMMENT ON FUNCTION public.cast_governance_vote(uuid, text) IS
  'D3 custodial cast-vote: local governance_votes ballot + token-derived weight + '
  'tally recompute + blockchain_audit_records anchor (reference_table=governance_votes).';

REVOKE ALL ON FUNCTION public.cast_governance_vote(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cast_governance_vote(uuid, text) TO authenticated, service_role;
