-- Source of Truth: fn_list_quarantined_items (Step 4 admin review queue)
-- Used by src/pages/admin/AdminKnowledgeSafety.tsx (future PR)
-- Migration: aisha/db/migrations/20260518240000_ingestion_safety.sql

CREATE OR REPLACE FUNCTION public.fn_list_quarantined_items(
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id                   uuid,
  title                text,
  item_type            text,
  quarantine_status    text,
  quarantine_reason    text,
  quarantine_metadata  jsonb,
  safety_score         numeric,
  safety_scanned_at    timestamptz,
  story_id             uuid,
  created_at           timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated user required'; END IF;
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Admin/staff required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT ki.id, ki.title, ki.item_type, ki.quarantine_status,
         ki.quarantine_reason, ki.quarantine_metadata,
         ki.safety_score, ki.safety_scanned_at, ki.story_id, ki.created_at
    FROM public.knowledge_items ki
   WHERE ki.quarantine_status IN ('flagged', 'quarantined')
   ORDER BY ki.safety_score DESC NULLS LAST, ki.created_at DESC
   LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_list_quarantined_items(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_list_quarantined_items(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_list_quarantined_items(integer, integer) TO service_role;
