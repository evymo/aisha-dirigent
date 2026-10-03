-- ============================================================================
-- Trigger: trg_sync_reprice_proposal
-- Popis: Fires when the canonical gate stamps a reprice decision onto a
--        reprice_proposal story_entry — syncs hub_reprice_proposal.status.
--        Guarded on the reprice.status actually changing (no churn on other
--        metadata edits).
-- Pár: aisha/db/migrations/20260627200000_reprice_canonical_gate.sql
-- ============================================================================

DROP TRIGGER IF EXISTS trg_sync_reprice_proposal ON public.story_entries;
CREATE TRIGGER trg_sync_reprice_proposal
  AFTER UPDATE OF metadata ON public.story_entries
  FOR EACH ROW
  WHEN (NEW.entry_type = 'reprice_proposal'
        AND NEW.metadata->'reprice'->>'status' IS DISTINCT FROM OLD.metadata->'reprice'->>'status')
  EXECUTE FUNCTION public.hub_sync_reprice_proposal_from_entry();
