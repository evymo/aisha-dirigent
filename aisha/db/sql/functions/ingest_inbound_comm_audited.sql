-- Function: public.ingest_inbound_comm_audited
-- Atomic production ingest for the inbound-communication QUEUE. This is the single
-- entry point the inbound adapter (svc / n8n) calls per received message. It ties
-- the two existing primitives together with the queue as the AUTHORITATIVE dedup,
-- so we never deduplicate twice:
--
--   1. record_integration_event(event_source, external_id, …)  ← QUEUE + dedup + lifecycle
--      (durable, retry/backoff, status, story_id) — the operational envelope.
--   2. IF the event is a duplicate → return the existing story entry (do NOT create a
--      second one — this is what resolves the dedup duplication between the queue and
--      append_inbound_comm_entry_audited's own idempotency guard).
--   3. ELSE append_inbound_comm_entry_audited(…)              ← STORY view (the content)
--      — the email becomes a story_entry: "mail seen from the story's perspective".
--   4. complete_integration_event(event_id, 'completed')      ← close the ingest stage.
--
-- The event ↔ entry are linked both ways: integration_events.story_id points at the
-- story; the story_entry carries metadata.integration_event_id. The story timeline
-- (get_story_entries_audited) shows the message; get_integration_events_for_story shows
-- the queue/ops status. No separate mail inbox — the STORY is the inbox.
--
-- Scope note: AV malware scan is a PRE-ingest guard and vectorization is a POST-ingest
-- async feed via the existing knowledge_items→Ragnarok pipeline — both are the M2
-- content pipeline and are intentionally NOT part of this event's lifecycle.
--
-- Security: SECURITY DEFINER, service_role ONLY (system ingestion path).
-- @audit: required (delegated — record_integration_event + append both audit)

CREATE OR REPLACE FUNCTION public.ingest_inbound_comm_audited(
  p_channel         text,
  p_external_id     text,
  p_story_id        uuid,
  p_from            text DEFAULT NULL::text,
  p_subject         text DEFAULT NULL::text,
  p_body            text DEFAULT NULL::text,
  p_parent_entry_id uuid DEFAULT NULL::uuid,
  p_routed_to       text DEFAULT NULL::text,
  p_metadata        jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_channel       text := lower(p_channel);
  v_event_source  text;
  v_rec           jsonb;
  v_event_id      uuid;
  v_is_dup        boolean;
  v_entry_id      uuid;
  v_append        jsonb;
BEGIN
  -- System ingestion path: service_role only. Inbound messages carry no auth.uid().
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ingest_inbound_comm_audited is service-role only' USING ERRCODE = '42501';
  END IF;

  IF v_channel IS NULL OR btrim(v_channel) = '' THEN
    RAISE EXCEPTION 'p_channel is required' USING ERRCODE = '22023';
  END IF;
  IF p_external_id IS NULL OR btrim(p_external_id) = '' THEN
    RAISE EXCEPTION 'p_external_id is required (idempotency key)' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_stories WHERE id = p_story_id) THEN
    RAISE EXCEPTION 'Target story not found: %', p_story_id USING ERRCODE = '22023';
  END IF;

  -- Map channel → integration_events.event_source. Only 'email' is wired today
  -- (event_source CHECK). Extend the CHECK + this map when chat/webhook adapters land.
  v_event_source := CASE v_channel WHEN 'email' THEN 'email_inbound' ELSE NULL END;
  IF v_event_source IS NULL THEN
    RAISE EXCEPTION 'unsupported inbound channel: % (extend integration_events.event_source first)', v_channel
      USING ERRCODE = '22023';
  END IF;

  -- (1) Enqueue with the queue's authoritative dedup.
  v_rec      := public.record_integration_event(
                  v_event_source, p_external_id, v_channel || '.inbound',
                  NULL, p_story_id, NULL, p_routed_to, NULL);
  v_event_id := (v_rec->>'event_id')::uuid;
  v_is_dup   := (v_rec->>'is_duplicate')::boolean;

  -- (2) Duplicate → reuse the existing story entry; never create a second one.
  -- (3) Fresh    → create the story-view entry (links back to the queue event) and
  --               close the ingest stage. AV (pre) + vectorization (post, via the
  --               existing knowledge→Ragnarok feed) are the M2 content pipeline,
  --               NOT this event's lifecycle.
  IF v_is_dup THEN
    SELECT id INTO v_entry_id
      FROM public.story_entries
     WHERE entry_type = 'inbound_' || v_channel
       AND metadata->>'external_id' = p_external_id
     LIMIT 1;
  ELSE
    v_append := public.append_inbound_comm_entry_audited(
                  p_story_id, v_channel, p_external_id, p_from, p_subject, p_body, p_parent_entry_id,
                  COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('integration_event_id', v_event_id));
    v_entry_id := (v_append->>'entry_id')::uuid;
    PERFORM public.complete_integration_event(v_event_id, 'completed', NULL, NULL);
  END IF;

  -- (4) Orchestration-level provenance (record_integration_event + append audit too).
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (NULL, 'COMM_INBOUND_INGESTED',
    jsonb_build_object(
      'area',        'communication',
      'severity',    'info',
      'event_id',    v_event_id,
      'entry_id',    v_entry_id,
      'story_id',    p_story_id,
      'channel',     v_channel,
      'external_id', p_external_id,
      'deduped',     v_is_dup));

  RETURN jsonb_build_object(
    'event_id', v_event_id, 'entry_id', v_entry_id,
    'story_id', p_story_id, 'deduped', v_is_dup);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.ingest_inbound_comm_audited(text, text, uuid, text, text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ingest_inbound_comm_audited(text, text, uuid, text, text, text, uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.ingest_inbound_comm_audited(text, text, uuid, text, text, text, uuid, text, jsonb) TO service_role;
