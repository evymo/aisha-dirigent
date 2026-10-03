-- ============================================================================
-- Source of Truth: workflow_step_open_beat
-- Popis: KLOUB KROK ↔ TAKT (ADR-003, program K2; TWIN_PULSE_MODEL §5, řádek
--        „production milestone"). Otevře TAKT pro jeden lidský uzel běhu:
--        „subjekt běhu dluží akci tohoto uzlu do termínu, dluží ji přiřazený
--        člověk (nebo držitelé role)". Idempotentní podle (source_type=
--        'workflow_step', source_id=krok): otevřený takt téhož kroku se vrací.
--
-- CO JE LIDSKÝ UZEL: má adresáta — assigned_user_id, assigned_role, nebo
-- vazbu na dvojče (input_data.authorized_twin_id). Strojový uzel takt nemá
-- (nikdo nic nedluží); vrací NULL, ne chybu.
--
-- SUBJEKT taktu (v tomto pořadí): input_data.subject_twin_id → subject_actor_id
-- → authorized_twin_id → story běhu. Běh bez subjektu takt nemá (NULL): takt
-- bez subjektu by byl řádek fronty, který nejde vyřešit.
--
-- TERMÍN: input_data.due_at → created_at + input_data.due_in (interval)
-- → production_date běhu (17:00) → created_at + 7 dní. Takt vyžaduje due_at.
--
-- PROČ PŘÍMÝ INSERT a ne create_pulse_beat_audited: to RPC váže autorizaci na
-- SUBJEKT (operátor / vlastní účet). Kloub ale otevírá takt DALŠÍHO uzlu při
-- potvrzení předchozího libovolným oprávněným účastníkem (držitel role,
-- vázaný účet) — ten nad subjektem oprávnění nemá a mít nemusí. Autorizace
-- tady je autorizace BĚHU: volá se jen z DEFINER funkcí běhu
-- (ensure_workflow_run_for_subject, complete_workflow_step), grant má pouze
-- service_role — táž třída jako append_subject_entry_service. Tvar řádku i
-- typový záznam 'pulse_beat_opened' na ose subjektu jsou stejné jako v RPC.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.workflow_step_open_beat(p_step_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_step         public.production_workflow_steps%rowtype;
  v_batch        public.production_batches%rowtype;
  v_subject_type text;
  v_subject_id   uuid;
  v_due          timestamptz;
  v_beat_type    text;
  v_beat_id      uuid;
  v_entry_id     uuid;
  v_caller       uuid := auth.uid();
BEGIN
  SELECT * INTO v_step FROM public.production_workflow_steps WHERE id = p_step_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow step % not found', p_step_id USING ERRCODE = '22023';
  END IF;
  IF v_step.status IS DISTINCT FROM 'pending' THEN
    RETURN NULL;
  END IF;
  IF v_step.assigned_user_id IS NULL
     AND v_step.assigned_role IS NULL
     AND nullif(v_step.input_data->>'authorized_twin_id', '') IS NULL THEN
    RETURN NULL;  -- strojový uzel: nikdo nic nedluží
  END IF;

  -- idempotence: otevřený takt tohoto kroku už existuje
  SELECT b.id INTO v_beat_id
  FROM public.story_pulse_beats b
  WHERE b.source_type = 'workflow_step' AND b.source_id = p_step_id AND b.status = 'open'
  LIMIT 1;
  IF v_beat_id IS NOT NULL THEN
    RETURN v_beat_id;
  END IF;

  SELECT * INTO v_batch FROM public.production_batches WHERE id = v_step.batch_id;

  IF nullif(v_step.input_data->>'subject_twin_id', '') IS NOT NULL THEN
    v_subject_type := 'twin';  v_subject_id := (v_step.input_data->>'subject_twin_id')::uuid;
  ELSIF nullif(v_step.input_data->>'subject_actor_id', '') IS NOT NULL THEN
    v_subject_type := 'actor'; v_subject_id := (v_step.input_data->>'subject_actor_id')::uuid;
  ELSIF nullif(v_step.input_data->>'authorized_twin_id', '') IS NOT NULL THEN
    v_subject_type := 'twin';  v_subject_id := (v_step.input_data->>'authorized_twin_id')::uuid;
  ELSIF v_batch.story_id IS NOT NULL THEN
    v_subject_type := 'story'; v_subject_id := v_batch.story_id;
  ELSE
    RETURN NULL;  -- běh bez subjektu: není komu/za koho dlužit
  END IF;

  v_due := COALESCE(
    nullif(v_step.input_data->>'due_at', '')::timestamptz,
    CASE WHEN nullif(v_step.input_data->>'due_in', '') IS NOT NULL
         THEN v_step.created_at + (v_step.input_data->>'due_in')::interval END,
    CASE WHEN v_batch.production_date IS NOT NULL
         THEN v_batch.production_date::timestamptz + interval '17 hours' END,
    v_step.created_at + interval '7 days');
  v_beat_type := COALESCE(nullif(v_step.input_data->>'beat_type', ''), v_step.step_code, 'step');

  INSERT INTO public.story_pulse_beats (
    subject_type, subject_id, beat_type, status, due_at,
    assigned_to_user_id, source_type, source_id, note, metadata, created_by
  ) VALUES (
    v_subject_type, v_subject_id, v_beat_type, 'open', v_due,
    v_step.assigned_user_id, 'workflow_step', p_step_id,
    COALESCE(nullif(v_step.description, ''), v_step.step_name),
    jsonb_build_object('batch_id', v_step.batch_id, 'step_code', v_step.step_code,
                       'assigned_role', v_step.assigned_role),
    v_caller
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_beat_id;

  IF v_beat_id IS NULL THEN
    -- Tentýž otevřený slot (subjekt, typ, termín, zdroj) už drží jiný řádek.
    SELECT b.id INTO v_beat_id FROM public.story_pulse_beats b
    WHERE b.status = 'open' AND b.subject_type = v_subject_type AND b.subject_id = v_subject_id
      AND b.beat_type = v_beat_type AND b.due_at = v_due
      AND b.source_type = 'workflow_step' AND b.source_id = p_step_id
    LIMIT 1;
    RETURN v_beat_id;
  END IF;

  -- Otevření je samo typový záznam na ose subjektu (jako v create_pulse_beat_audited).
  v_entry_id := public.append_subject_entry_service(
    p_subject_type := v_subject_type,
    p_subject_id   := v_subject_id,
    p_entry_type   := 'pulse_beat_opened',
    p_content      := COALESCE(nullif(v_step.description, ''), v_step.step_name),
    p_metadata     := jsonb_build_object('beat_id', v_beat_id, 'beat_type', v_beat_type,
                        'due_at', v_due, 'assigned_to_user_id', v_step.assigned_user_id,
                        'source_type', 'workflow_step', 'source_id', p_step_id,
                        'batch_id', v_step.batch_id),
    p_created_by   := v_caller,
    p_story_id     := CASE WHEN v_subject_type = 'story' THEN v_subject_id ELSE NULL END,
    p_is_internal  := true,
    p_occurred_at  := now());

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_caller, 'workflow.beat_opened',
          jsonb_build_object('beat_id', v_beat_id, 'step_id', p_step_id,
                             'batch_id', v_step.batch_id, 'entry_id', v_entry_id));
  RETURN v_beat_id;
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_step_open_beat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workflow_step_open_beat(uuid) TO service_role;
