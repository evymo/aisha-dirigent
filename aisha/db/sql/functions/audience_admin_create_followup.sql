-- Function: audience_admin_create_followup
--
-- Follow-up je BĚH z jednouzlové šablony `follow-up` (ADR-003 K2, D4): práce je
-- vždy krok běhu, ne řádek úkolové tabulky. Otevření běhu otevře takt prvního
-- lidského uzlu (kloub workflow_step_open_beat), takt nese subjekt = dvojče
-- aktéra (má-li ho) nebo aktér sám, adresát = přiřazený operátor. Vrací ID
-- TAKTU — to je klíč řádku fronty (audience_admin_followup_queue_v.task_id).
--
-- PROČ UŽ ŽÁDNÝ ai_tasks řádek: dvě pravdy o téže práci (takt + úkol) byly
-- kompatibilita pro fronty čtoucí ai_tasks; fronta i overlay teď čtou takty.
-- audience_admin_complete_followup umí uzavřít i staré takty se zdrojem
-- 'ai_task', takže nic rozdělaného se neztratí.
--
-- PROČ ŠABLONA JMÉNEM: instance smí pojmenovat vlastní běhy jak chce, ale
-- audience modul potřebuje jeden generický jednouzlový běh — dodává ho seed
-- jádra (aisha/db/seed/core/17_workflow_templates_generic.sql). Chybí-li,
-- selhání je hlasité a pojmenované, nikdy tichý návrat k úkolové tabulce.
CREATE OR REPLACE FUNCTION public.audience_admin_create_followup(p_actor_id uuid, p_due_at timestamp with time zone, p_note text, p_assigned_to uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run      jsonb;
  v_batch_id uuid;
  v_beat_id  uuid;
  v_twin_id  uuid;
  v_run_code text;
  v_assignee uuid := COALESCE(p_assigned_to, auth.uid());
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_actor_id IS NULL OR p_due_at IS NULL THEN
    RAISE EXCEPTION 'actor and due_at are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = p_actor_id) THEN
    RAISE EXCEPTION 'Subject not found: actor %', p_actor_id USING ERRCODE = '22023';
  END IF;

  -- identita: dvojče účtu, má-li ho (před backfillem NULL → subjekt = aktér)
  SELECT r.twin_id INTO v_twin_id
  FROM public.twin_external_refs r
  WHERE r.ref_kind = 'account' AND r.source_key = p_actor_id::text
    AND r.state = 'confirmed' AND r.valid_to IS NULL
  LIMIT 1;

  v_run_code := 'follow-up:' || p_actor_id::text || ':' || gen_random_uuid()::text;

  v_run := public.ensure_workflow_run_for_subject(
    p_template_name := 'follow-up',
    p_run_code      := v_run_code,
    p_subject_label := COALESCE(nullif(btrim(p_note), ''), 'follow-up'),
    p_due_date      := p_due_at::date,
    p_subject       := jsonb_build_object(
                         'subject_actor_id', p_actor_id,
                         'subject_twin_id',  v_twin_id,
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
    -- kloub takt neotevřel (např. uzel bez adresáta) — řekni to, netvař se hotově
    RAISE EXCEPTION 'follow-up run % opened but no beat was issued for its first node', v_batch_id;
  END IF;

  PERFORM public.audience_log_event(
    'create_followup',
    'audience_admin_create_followup',
    'story_pulse_beat',
    v_beat_id,
    format('Scheduled follow-up for actor %s', p_actor_id),
    jsonb_build_object('actor_id', p_actor_id, 'twin_id', v_twin_id, 'due_at', p_due_at,
                       'note', p_note, 'batch_id', v_batch_id, 'beat_id', v_beat_id)
  );
  RETURN v_beat_id;
END;
$function$
;
REVOKE ALL ON FUNCTION audience_admin_create_followup(uuid,timestamp with time zone,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_admin_create_followup(uuid,timestamp with time zone,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_admin_create_followup(uuid,timestamp with time zone,text,uuid) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_admin_create_followup(uuid,timestamp with time zone,text,uuid) TO service_role;
