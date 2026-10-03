-- ============================================================================
-- Source of Truth: hub_sync_reprice_proposal_from_entry (trigger fn)
-- Popis: Reflect a reprice decision STAMPED on the story_entry (by the canonical
--        gate respond_to_story_block_audited) into the hub_reprice_proposal
--        projection. The entry is the source of the decision; this is the
--        executor-reads-stamp half (same shape as the Flowboard resume). Only
--        a still-pending proposal is moved — confirm/reject is terminal.
-- Bezpečnost: SECURITY DEFINER (runs on the SECURITY-DEFINER gate's UPDATE).
-- Pár: aisha/db/migrations/20260627200000_reprice_canonical_gate.sql
--      aisha/db/sql/triggers/trg_sync_reprice_proposal.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_sync_reprice_proposal_from_entry()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_status text; v_proposal uuid;
BEGIN
  v_status := NEW.metadata->'reprice'->>'status';
  v_proposal := NULLIF(NEW.metadata->>'proposal_id', '')::uuid;
  IF v_proposal IS NULL OR v_status NOT IN ('confirmed', 'rejected') THEN
    RETURN NEW;
  END IF;

  UPDATE public.hub_reprice_proposal SET
    status      = v_status,
    decided_by  = NULLIF(NEW.metadata->'reprice'->>'responded_by', '')::uuid,
    decided_at  = now(),
    updated_at  = now()
  WHERE id = v_proposal AND status = 'pending';

  RETURN NEW;
END; $$;

-- Trigger function (fired by the story_entries trigger, runs as owner) — no
-- direct-invocation grants; REVOKE keeps it uncallable via PostgREST.
REVOKE ALL ON FUNCTION public.hub_sync_reprice_proposal_from_entry() FROM PUBLIC;
