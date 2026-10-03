-- ============================================================================
-- Source of Truth: complete_workflow_step
-- Popis: Dokončení milníku člověkem (kanonické jméno — autorizace má 3 cesty a je interní věc). Narace + nudge při odchylce + odměna deklarovaná NA UZLU šablony + goal re-evaluace. FOR UPDATE = double-award guard.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- Pozn.: definice = regenerát z nasazené DB (ověřeno provozním testem 07-25).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_workflow_step(p_step_id uuid, p_output_data jsonb DEFAULT '{}'::jsonb, p_notes text DEFAULT NULL::text, p_has_deviation boolean DEFAULT false, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_step production_workflow_steps%rowtype;
  v_uid uuid := auth.uid();
  -- F2: odbavení z TABLETU (účet zařízení). kid je ověřený proti průkazu účtu
  -- (current_device_kid), jinak NULL — člověk nebo podvržený claim.
  v_device_kid text := public.current_device_kid();
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_status text;
  v_reward jsonb;
  v_award jsonb := null;
  v_amount int;
  v_story_id uuid;
  v_beat_id uuid;
  v_beat_subject_type text;
  v_beat_subject_id uuid;
  v_beat_type text;
  v_beat_entry uuid;
  v_beat_next uuid;
  v_beat_outcome text;
begin
  if v_uid is null then
    return jsonb_build_object('ok',false,'error','not authenticated');
  end if;
  select * into v_step from production_workflow_steps where id = p_step_id for update;
  if not found then
    return jsonb_build_object('ok',false,'error','workflow step not found');
  end if;
  -- Kód kroku z ŘÁDKU (p_step_code) — jen pro pátou cestu (tablet); jinak beze změny.
  if not (workflow_step_visible_to(v_uid, v_step.assigned_user_id, v_step.assigned_role, v_step.input_data,
                                   null, v_step.step_code)
          or is_admin_or_staff(v_uid)) then
    return jsonb_build_object('ok',false,'error','not allowed to complete this step (not assigned, missing role '||coalesce(v_step.assigned_role,'?')||', and no confirmed twin binding)');
  end if;
  if v_step.status = 'completed' then
    return jsonb_build_object('ok',false,'error','step already completed');
  end if;
  v_status := case when p_has_deviation then 'failed' else 'completed' end;
  update production_workflow_steps set
    status = v_status, completed_by = v_uid, completed_at = v_at,
    output_data = coalesce(p_output_data,'{}'::jsonb),
    has_deviation = p_has_deviation,
    deviation_notes = case when p_has_deviation then p_notes else deviation_notes end,
    notes = coalesce(p_notes, notes), updated_at = now()
  where id = p_step_id;

  -- ── twin puls, KLOUB KROK ↔ TAKT (ADR-003 K2) ──────────────────────────────
  -- Potvrzení kroku uzavírá jeho takt (s typovým záznamem na ose subjektu) a
  -- otevírá takt dalšího lidského uzlu běhu. Vedlejší účinek nesmí zničit akt
  -- (Z7): selhání se zapíše do audit_journal, krok zůstává dokončený.
  v_beat_outcome := case when v_status = 'failed' or coalesce(p_output_data->>'outcome','') = 'cancelled'
                         then 'cancelled' else 'done' end;
  begin
    -- Na krok připadá nejvýš JEDEN otevřený takt (idempotence kloubu drží
    -- partial UNIQUE + lookup podle zdroje), takže stačí jeden UPDATE.
    update story_pulse_beats b
       set status = v_beat_outcome, closed_at = v_at, closed_by = v_uid, updated_at = now()
     where b.source_type = 'workflow_step' and b.source_id = p_step_id and b.status = 'open'
    returning b.id, b.subject_type, b.subject_id, b.beat_type
      into v_beat_id, v_beat_subject_type, v_beat_subject_id, v_beat_type;

    if v_beat_id is not null then
      v_beat_entry := append_subject_entry_service(
        p_subject_type := v_beat_subject_type,
        p_subject_id   := v_beat_subject_id,
        p_entry_type   := 'pulse_beat_closed',
        p_content      := coalesce(p_notes, v_step.step_name),
        p_metadata     := jsonb_strip_nulls(jsonb_build_object('beat_id', v_beat_id, 'beat_type', v_beat_type,
                            'outcome', v_beat_outcome, 'step_id', p_step_id, 'batch_id', v_step.batch_id,
                            'device_kid', v_device_kid)),
        p_created_by   := v_uid,
        p_story_id     := case when v_beat_subject_type = 'story' then v_beat_subject_id else null end,
        p_is_internal  := false,
        p_occurred_at  := v_at);
      update story_pulse_beats set closing_entry_id = v_beat_entry where id = v_beat_id;
    end if;

    -- Další lidský uzel běhu dluží od teď.
    select s.id into v_beat_next
      from production_workflow_steps s
     where s.batch_id = v_step.batch_id and s.status = 'pending' and s.step_order > v_step.step_order
     order by s.step_order, s.created_at
     limit 1;
    if v_beat_next is not null then
      perform workflow_step_open_beat(v_beat_next);
    end if;
  exception when others then
    insert into audit_journal (user_id, action, metadata)
    values (v_uid, 'workflow.beat_joint_failed',
            jsonb_build_object('step_id', p_step_id, 'batch_id', v_step.batch_id, 'error', SQLERRM));
  end;
  select b.story_id into v_story_id from production_batches b where b.id = v_step.batch_id;
  if v_story_id is not null then
    perform add_story_system_entry(
      v_story_id, 'tracking_event',
      case when p_has_deviation then 'workflow.timeline.step_deviation'
           else 'workflow.timeline.step_completed' end,
      jsonb_build_object('step_code',v_step.step_code,'step_name',v_step.step_name,
                         'step_order',v_step.step_order,'status',v_status,
                         'has_deviation',p_has_deviation,'batch_id',v_step.batch_id,
                         'completed_by',v_uid)
        -- Na KTERÉM tabletu k předání došlo (F2); u člověka klíč chybí.
        || case when v_device_kid is null then '{}'::jsonb
                else jsonb_build_object('device_kid', v_device_kid) end,
      v_at, 'production_workflow_steps', p_step_id);
    if p_has_deviation then
      insert into dirigent_nudges (story_id, event_origin, severity, message, metadata, expires_at)
      values (v_story_id, 'compliance_engine', 'warn', 'workflow.nudge.step_deviation',
              jsonb_build_object('step_id',p_step_id,'step_code',v_step.step_code,
                                 'batch_id',v_step.batch_id,'notes',p_notes),
              now() + interval '48 hours');
    end if;
  end if;
  -- ⛔ Odměnu NEdostane účet zařízení (F2): tablet není člověk a tokeny na něm by
  -- nic neznamenaly (a šly by zneužít). Komu odměna u odbavení z tabletu patří
  -- (řidiči podle vazby?), je otevřené rozhodnutí — do té doby se nevyplácí, s důvodem.
  -- Rozhoduje ÚČET (vazba průkazu), ne claim v tokenu — ten by mohl chybět.
  if v_status = 'completed'
     and exists (select 1 from knock_device_credentials d where d.ucet_id = v_uid) then
    v_award := jsonb_build_object('success', false, 'skipped', 'device', 'kid', v_device_kid);
  elsif v_status = 'completed' then
    v_reward := v_step.input_data->'reward';
    if v_reward is not null and v_reward ? 'token_type' then
      begin
        v_amount := floor((v_reward->>'amount')::numeric)::int;
        if v_amount > 0 then
          v_award := award_tokens(v_uid, v_reward->>'token_type', v_amount,
                                  'workflow_step', p_step_id, v_step.step_name);
        end if;
      exception when others then
        v_award := jsonb_build_object('success',false,'error',SQLERRM);
      end;
    end if;
  end if;
  -- story-loop: re-evaluate the goal (non-fatal side effect)
  if v_story_id is not null then
    begin
      perform evaluate_story_process_goal(v_story_id);
        exception when others then
      -- goal re-evaluation is a side effect and must never roll back the
      -- operational fact — but the failure is LOGGED, never swallowed
      insert into audit_journal (user_id, action, metadata)
      values (auth.uid(), 'workflow.goal_evaluation_failed',
              jsonb_build_object('error', SQLERRM));
    end;
  end if;
  return jsonb_build_object('ok',true,'step_id',p_step_id,'status',v_status,
    'completed_by',v_uid,'completed_at',v_at,'step_name',v_step.step_name,
    'story_id',v_story_id,'reward',v_award);
end $function$;

REVOKE ALL ON FUNCTION public.complete_workflow_step(uuid,jsonb,text,boolean,timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_workflow_step(uuid,jsonb,text,boolean,timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_workflow_step(uuid,jsonb,text,boolean,timestamp with time zone) TO service_role;
