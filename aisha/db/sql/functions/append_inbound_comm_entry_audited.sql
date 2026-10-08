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
-- ⛔ E-MAIL JEN PŘES SKEN (revize integrátora 2026-10-05, příjem pošty mail-sync):
-- dřív tu žádná kontrola antiviru nebyla — komentář slíbil „downstream gate“, ale nikdo ji
-- nevynucoval, takže e-mail šel do story bez ověřeného verdiktu. Pro kanál `email` je proto
-- `p_event_id` POVINNÝ: event fronty (integration_events, event_source = 'email_inbound') se
-- zamkne (FOR UPDATE — dva souběžné appendy téže zprávy dají jeden záznam) a musí:
--   · patřit téže zprávě (external_id) a téže story (story_id eventu, pokud je),
--   · nebýt exhausted,
--   · nést čistý verdikt skenu: metadata.av.verdict = 'clean' (zapsal record_comm_av_scan_audited).
-- Bez verdiktu = nezměřeno = nečisté → výjimka, nic se nezapíše. E-mail je obsah zvenku:
-- záznam je interní (is_internal = true) a do triage jde jako data, ne pokyny. Po zápisu se
-- event uzavře (completed) a nese story_id. Jiné kanály p_event_id nepotřebují; když ho
-- dostanou, platí tytéž kontroly kromě verdiktu.
--
-- Security: SECURITY DEFINER, service_role ONLY (bypasses story-ownership checks).
-- @audit: required

-- Stará signatura (8 argumentů) by vedle nové zůstala volatelná a obešla kontrolu → pryč.
DROP FUNCTION IF EXISTS public.append_inbound_comm_entry_audited(uuid, text, text, text, text, text, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.append_inbound_comm_entry_audited(
  p_story_id        uuid,
  p_channel         text,
  p_external_id     text,
  p_from            text DEFAULT NULL::text,
  p_subject         text DEFAULT NULL::text,
  p_body            text DEFAULT NULL::text,
  p_parent_entry_id uuid DEFAULT NULL::uuid,
  p_metadata        jsonb DEFAULT '{}'::jsonb,
  p_event_id        uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_entry_type text;
  v_channel    text;
  v_existing   uuid;
  v_entry_id   uuid;
  v_event      public.integration_events%ROWTYPE;
  v_internal   boolean := false;
BEGIN
  -- System ingestion path: jen role služby (domov is_service_role: claim role NEBO SET ROLE
  -- service_role; „je někdo přihlášen“ nárok není). Inbound messages carry no auth.uid().
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'append_inbound_comm_entry_audited: jen role služby' USING ERRCODE = '42501';
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

  v_channel    := lower(btrim(p_channel));
  v_entry_type := 'inbound_' || v_channel;

  IF v_channel = 'email' AND p_event_id IS NULL THEN
    RAISE EXCEPTION 'e-mail se do story zapisuje jen s p_event_id — event fronty s čistým verdiktem skenu (record_comm_av_scan_audited)'
      USING ERRCODE = '22023';
  END IF;

  IF p_event_id IS NOT NULL THEN
    -- Zámek eventu serializuje souběžné appendy téže zprávy (druhý počká a uvidí první záznam).
    SELECT * INTO v_event FROM public.integration_events WHERE id = p_event_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'event fronty % neexistuje', p_event_id USING ERRCODE = '22023';
    END IF;
    IF v_event.external_id IS DISTINCT FROM p_external_id THEN
      RAISE EXCEPTION 'event % patří jiné zprávě (external_id %), ne %', p_event_id, v_event.external_id, p_external_id
        USING ERRCODE = '22023';
    END IF;
    IF v_event.story_id IS NOT NULL AND v_event.story_id IS DISTINCT FROM p_story_id THEN
      RAISE EXCEPTION 'event % patří story %, ne %', p_event_id, v_event.story_id, p_story_id USING ERRCODE = '22023';
    END IF;
    IF v_event.status = 'exhausted' THEN
      RAISE EXCEPTION 'event % je exhausted (sken zablokoval nebo vyčerpány pokusy) — nezapisuje se', p_event_id
        USING ERRCODE = '22023';
    END IF;
    IF v_channel = 'email' THEN
      IF v_event.event_source IS DISTINCT FROM 'email_inbound' THEN
        RAISE EXCEPTION 'event % není e-mailový (event_source %)', p_event_id, v_event.event_source USING ERRCODE = '22023';
      END IF;
      IF COALESCE(v_event.metadata->'av'->>'verdict', '') IS DISTINCT FROM 'clean' THEN
        RAISE EXCEPTION 'e-mail bez čistého verdiktu skenu se nezapíše (event %, verdikt %)',
          p_event_id, COALESCE(v_event.metadata->'av'->>'verdict', 'žádný — nezměřeno') USING ERRCODE = '22023';
      END IF;
      v_internal := true;
    END IF;
  END IF;

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
           'channel',     v_channel,
           'external_id', p_external_id,
           'from',        p_from,
           'subject',     p_subject,
           'is_system',   true
         )
      || CASE WHEN p_event_id IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('integration_event_id', p_event_id, 'av', v_event.metadata->'av') END,
    v_internal,  -- e-mail = obsah zvenku → interní; jiné kanály viditelné partnerovi jako dřív
    NULL         -- system provenance
  )
  RETURNING id INTO v_entry_id;

  IF p_event_id IS NOT NULL THEN
    UPDATE public.integration_events SET story_id = COALESCE(story_id, p_story_id) WHERE id = p_event_id;
    PERFORM public.complete_integration_event(p_event_id, 'completed', NULL, NULL);
  END IF;

  UPDATE public.partner_stories SET last_activity_at = now() WHERE id = p_story_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (NULL, 'COMM_INBOUND_ENTRY',
    jsonb_build_object(
      'area',        'communication',
      'severity',    'info',
      'entity_type', 'story_entries',
      'entity_id',   v_entry_id,
      'story_id',    p_story_id,
      'channel',     v_channel,
      'external_id', p_external_id,
      'integration_event_id', p_event_id));

  RETURN jsonb_build_object('entry_id', v_entry_id, 'story_id', p_story_id, 'deduped', false);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.append_inbound_comm_entry_audited(uuid, text, text, text, text, text, uuid, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.append_inbound_comm_entry_audited(uuid, text, text, text, text, text, uuid, jsonb, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_inbound_comm_entry_audited(uuid, text, text, text, text, text, uuid, jsonb, uuid) TO service_role;
