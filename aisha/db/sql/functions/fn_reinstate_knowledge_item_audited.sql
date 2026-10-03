-- Source of Truth: fn_reinstate_knowledge_item_audited (Step 4 admin override)
-- Migration: aisha/db/migrations/20260518240000_ingestion_safety.sql

CREATE OR REPLACE FUNCTION public.fn_reinstate_knowledge_item_audited(
  p_item_id uuid,
  p_reason  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated user required'; END IF;
  IF NOT public.is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Admin/staff required to reinstate quarantined items' USING ERRCODE = '42501';
  END IF;

  UPDATE public.knowledge_items
     SET quarantine_status = 'reinstated',
         quarantine_reason = p_reason
   WHERE id = p_item_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'ingestion.knowledge_item_reinstated',
    jsonb_build_object('item_id', p_item_id, 'reason', p_reason));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reinstate_knowledge_item_audited(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_reinstate_knowledge_item_audited(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reinstate_knowledge_item_audited(uuid, text) TO service_role;
