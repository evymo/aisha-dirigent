-- Function: public.append_inbound_comm_entry_audited
-- Generic inbound-communication ingest primitive. Appends an externally-received
-- message (email, chat, webhook, ...) onto a RESOLVED story as a system-provenance
-- story_entry. This is the service-role entry point that inbound adapters / n8n call
-- AFTER resolving the target story (via resolve_story_from_* or the stack default
-- inbox story).
--
-- Why a new function: create_story_entry_audited is auth.uid()-gated (cannot run for a
-- system-initiated message) and add_system_timeline_entry is restricted to a fixed
-- system-type allow-list on the user's PRIMARY story only. This fills that gap with
-- created_by = NULL (system) provenance + idempotent dedup by (channel, external_id).
--
-- Composes with promote_entry_to_story_audited: an inbound item lands as an entry in
-- the resolved/inbox story and can later be branched into its own child story —
-- "co email to story, pokud to není email zařazený do existující story".
--
-- Security: SECURITY DEFINER, service_role ONLY (bypasses story-ownership checks).
-- @audit: required

CREATE OR REPLACE FUNCTION public.append_inbound_comm_entry_audited(
  p_story_id        uuid,
  p_channel         text,
  p_external_id     text,
  p_from            text DEFAULT NULL::text,
  p_subject         text DEFAULT NULL::text,
  p_body            text DEFAULT NULL::text,
  p_parent_entry_id uuid DEFAULT NULL::uuid,
  p_metadata        jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entry_type text;
  v_existing   uuid;
  v_entry_id   uuid;
BEGIN
  -- System ingestion path: service_role only. Inbound messages carry no auth.uid().
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'append_inbound_comm_entry_audited is service-role only' USING ERRCODE = '42501';
  END IF;

  IF p_channel IS NULL OR btrim(p_channel) = '' THEN
    RAISE EXCEPTION 'p_channel is required' USING ERRCODE = '22023';
  END IF;
  IF p_external_id IS NULL OR btrim(p_external_id) = '' THEN
    RAISE EXCEPTION 'p_external_id is required (idempotency key)' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_stories WHERE id = p_story_id) THEN
    RAISE EXCEPTION 'Target story not found: %', p_story_id USING ERRCODE = '22023';
  END IF;

  v_entry_type := 'inbound_' || lower(p_channel);

  -- Idempotency: same provider message already ingested → return the existing entry.
  SELECT id INTO v_existing
    FROM public.story_entries
   WHERE entry_type = v_entry_type
     AND metadata->>'external_id' = p_external_id
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('entry_id', v_existing, 'story_id', p_story_id, 'deduped', true);
  END IF;

  -- Explicit envelope fields are authoritative (merged last so they win over p_metadata).
  INSERT INTO public.story_entries (
    story_id, parent_id, entry_type, content, metadata, is_internal, created_by
  ) VALUES (
    p_story_id, p_parent_entry_id, v_entry_type, p_body,
    COALESCE(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
           'channel',     lower(p_channel),
           'external_id', p_external_id,
           'from',        p_from,
           'subject',     p_subject,
           'is_system',   true
         ),
    false,   -- visible to partner; not internal
    NULL     -- system provenance
  )
  RETURNING id INTO v_entry_id;

  UPDATE public.partner_stories SET last_activity_at = now() WHERE id = p_story_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (NULL, 'COMM_INBOUND_ENTRY',
    jsonb_build_object(
      'area',        'communication',
      'severity',    'info',
      'entity_type', 'story_entries',
      'entity_id',   v_entry_id,
      'story_id',    p_story_id,
      'channel',     lower(p_channel),
      'external_id', p_external_id));

  RETURN jsonb_build_object('entry_id', v_entry_id, 'story_id', p_story_id, 'deduped', false);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.append_inbound_comm_entry_audited(uuid, text, text, text, text, text, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.append_inbound_comm_entry_audited(uuid, text, text, text, text, text, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.append_inbound_comm_entry_audited(uuid, text, text, text, text, text, uuid, jsonb) TO service_role;
