-- Source of Truth: fn_record_safety_scan_audited (Step 4)
-- Used by services/svc-mcp-knowledge ingestion-safety scanner.
-- Migration: aisha/db/migrations/20260518240000_ingestion_safety.sql
--
-- ⛔ 2026-10-07 (F2, add_knowledge): položka, kterou zapsal člověk nebo jeho agent přes MCP,
--    čeká na lidské ověření (quarantine_metadata.ceka_na_cloveka = true, stav 'flagged').
--    Automatický sken běží při každém dopočtu vektoru a čistý výsledek by ji přepnul na
--    'clear' — nedůvěryhodný obsah by se do hledání dostal bez člověka. U takové položky
--    teď sken stav jen ZPŘÍSNÍ (flagged → quarantined), na 'clear' ji pustí jen správa
--    (fn_reinstate_knowledge_item_audited). Značka i výsledek posledního skenu zůstávají.

CREATE OR REPLACE FUNCTION public.fn_record_safety_scan_audited(
  p_item_id  uuid,
  p_metadata jsonb,
  p_reason   text,
  p_score    numeric,
  p_status   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_item_id IS NULL THEN RAISE EXCEPTION 'p_item_id is required'; END IF;
  IF p_status NOT IN ('clear', 'flagged', 'quarantined') THEN
    RAISE EXCEPTION 'p_status must be clear, flagged, or quarantined';
  END IF;
  IF p_score IS NULL OR p_score < 0 OR p_score > 1 THEN
    RAISE EXCEPTION 'p_score must be in [0, 1]';
  END IF;

  UPDATE public.knowledge_items ki
     SET quarantine_status   = CASE
                                 WHEN ki.quarantine_metadata->>'ceka_na_cloveka' = 'true'
                                  AND ki.quarantine_status IN ('flagged', 'quarantined')
                                  AND p_status = 'clear'
                                 THEN ki.quarantine_status
                                 ELSE p_status
                               END,
         quarantine_reason   = CASE
                                 WHEN ki.quarantine_metadata->>'ceka_na_cloveka' = 'true'
                                  AND ki.quarantine_status IN ('flagged', 'quarantined')
                                  AND p_status = 'clear'
                                 THEN ki.quarantine_reason
                                 ELSE p_reason
                               END,
         quarantine_metadata = CASE
                                 WHEN ki.quarantine_metadata->>'ceka_na_cloveka' = 'true'
                                 THEN ki.quarantine_metadata || jsonb_build_object('posledni_sken', COALESCE(p_metadata, '{}'::jsonb))
                                 ELSE COALESCE(p_metadata, '{}'::jsonb)
                               END,
         safety_scanned_at   = now(),
         safety_score        = p_score
   WHERE ki.id = p_item_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'ingestion.safety_scan_completed',
    jsonb_build_object('item_id', p_item_id, 'status', p_status, 'score', p_score, 'reason', p_reason));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_safety_scan_audited(uuid, jsonb, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_record_safety_scan_audited(uuid, jsonb, text, numeric, text) TO service_role;
