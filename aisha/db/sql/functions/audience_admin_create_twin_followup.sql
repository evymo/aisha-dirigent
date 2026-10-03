-- ============================================================================
-- Source of Truth: audience_admin_create_twin_followup
-- Popis: Follow-up nad DVOJČETEM — i nad entitou bez účtu (kontakt z Raynetu,
--        organizace, externí člověk). Týž běh `follow-up` jako
--        audience_admin_create_followup, jen subjekt taktu je dvojče.
--
-- ⛔ PROČ (naměřeno 2026-09-15 v demu extranetu): akce „Naplánovat follow-up"
-- brala `target.user_id`; u dvojčete bez účtu je NULL → dispečer 22023. Tak se
-- nedalo pracovat s NIKÝM z 907 záznamů převzatých z Raynetu — přesně s těmi,
-- kvůli kterým migrace vznikla. Kloub workflow_step_open_beat subjekt dvojče
-- umí odjakživa (subject_twin_id má přednost); chyběla jen zápisová cesta.
--
-- Účet, má-li ho dvojče, jde do subjektu jako subject_actor_id — fronta
-- (audience_admin_followup_queue_v) pak ukáže jméno profilu, jinak jméno dvojčete.
-- Vrací ID TAKTU (klíč řádku fronty).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audience_admin_create_twin_followup(
  p_twin_id uuid,
  p_due_at timestamp with time zone,
  p_note text,
  p_assigned_to uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run      jsonb;
  v_batch_id uuid;
  v_beat_id  uuid;
  v_actor_id uuid;
  v_label    text;
  v_assignee uuid := COALESCE(p_assigned_to, auth.uid());
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_twin_id IS NULL OR p_due_at IS NULL THEN
    RAISE EXCEPTION 'twin and due_at are required' USING ERRCODE = '22023';
  END IF;
  SELECT t.label INTO v_label FROM public.twin_entities t WHERE t.id = p_twin_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subject not found: twin %', p_twin_id USING ERRCODE = '22023';
  END IF;

  -- účet dvojčete, má-li ho (jinak NULL — subjektem je dvojče samo)
  SELECT r.source_key::uuid INTO v_actor_id
  FROM public.twin_external_refs r
  WHERE r.twin_id = p_twin_id AND r.ref_kind = 'account' AND r.state = 'confirmed'
    AND r.valid_to IS NULL
    AND r.source_key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ORDER BY r.confirmed_at DESC NULLS LAST
  LIMIT 1;

  v_run := public.ensure_workflow_run_for_subject(
    p_template_name := 'follow-up',
    p_run_code      := 'follow-up:twin:' || p_twin_id::text || ':' || gen_random_uuid()::text,
    p_subject_label := COALESCE(nullif(btrim(p_note), ''), v_label, 'follow-up'),
    p_due_date      := p_due_at::date,
    p_subject       := jsonb_build_object(
                         'subject_twin_id',  p_twin_id,
                         'subject_actor_id', v_actor_id,
                         'due_at',           p_due_at,
                         'note',             p_note),
    p_node_bindings := jsonb_build_object(
                         'follow_up', jsonb_build_object('assigned_user_id', v_assignee)));

  IF NOT COALESCE((v_run->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'follow-up run not opened: %', COALESCE(v_run->>'error', 'unknown');
  END IF;
  v_batch_id := (v_run->>'batch_id')::uuid;
  v_beat_id  := nullif(v_run->>'first_beat_id', '')::uuid;
  IF v_beat_id IS NULL THEN
    RAISE EXCEPTION 'follow-up run % opened but no beat was issued for its first node', v_batch_id;
  END IF;

  PERFORM public.audience_log_event(
    'create_followup',
    'audience_admin_create_twin_followup',
    'story_pulse_beat',
    v_beat_id,
    format('Scheduled follow-up for twin %s', p_twin_id),
    jsonb_build_object('twin_id', p_twin_id, 'actor_id', v_actor_id, 'due_at', p_due_at,
                       'note', p_note, 'batch_id', v_batch_id, 'beat_id', v_beat_id));
  RETURN v_beat_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.audience_admin_create_twin_followup(uuid, timestamp with time zone, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audience_admin_create_twin_followup(uuid, timestamp with time zone, text, uuid) TO authenticated, service_role;
