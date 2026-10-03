-- ============================================================================
-- Source of Truth: get_batch_workflow_progress
-- Popis: Průběh běhu: pos = completed/total, state = poslední dosažený milník (zdroj pravdy stavu fyzického procesu), zdroj ovál projekce.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- Pozn.: definice = regenerát z nasazené DB (ověřeno provozním testem 07-25).
--
-- ČASY NA KROCÍCH (2026-08-05): `steps` vydává i `started_at`/`completed_at`.
-- Věž z nich počítá „jak dlouho to v téhle fázi stojí" (`ent`) a „jak dlouho
-- trvaly hotové fáze" (`done`) — dokud je krok nevydával, neměla je odkud vzít
-- a StoryLoopMC kreslil statickou desku. Sloupce v tabulce EXISTUJÍ odjakživa
-- (started_at, completed_at); jen se nepromítaly ven.
--
-- ⚠️ Vydává se ČAS, ne spočítaná délka. Kdo měří, ať měří u sebe: délka fáze
-- závisí na tom, kdy se ptáš (běžící fáze roste), takže uložit ji do projekce
-- znamená vyrobit číslo, které je v okamžiku doručení už neplatné. NULL je tu
-- legitimní odpověď — krok, který nezačal, prostě nemá kdy začít.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_batch_workflow_progress(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_visible boolean;
  v_story_id uuid;
  v_result jsonb;
begin
  if v_uid is null and not is_service_role() then
    return jsonb_build_object('ok',false,'error','not authenticated');
  end if;
  -- visibility: admin/staff/service, or the batch has a step visible to me
  -- (assigned · role · twin binding) — same predicate family as completion.
  -- Viditelnost přes SDÍLENÝ predikát (žádná inline kopie twin logiky).
  v_visible := is_service_role() or is_admin_or_staff(v_uid) or exists (
    select 1 from production_workflow_steps s
    where s.batch_id = p_batch_id
      and public.workflow_step_visible_to(v_uid, s.assigned_user_id, s.assigned_role, s.input_data)
  );
  if not v_visible then
    return jsonb_build_object('ok',false,'error','not visible');
  end if;
  select b.story_id into v_story_id from production_batches b where b.id = p_batch_id;
  select jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'story_id', v_story_id,
    'total', count(*),
    'completed', count(*) filter (where status='completed'),
    'failed', count(*) filter (where status='failed'),
    'pos', round(coalesce(count(*) filter (where status='completed')::numeric
                 / nullif(count(*),0), 0), 2),
    'state', coalesce((select s2.step_code from production_workflow_steps s2
                       where s2.batch_id = p_batch_id and s2.status='completed'
                       order by s2.step_order desc limit 1), 'created'),
    'current_step', (select jsonb_build_object('code',s3.step_code,'name',s3.step_name,'order',s3.step_order)
                     from production_workflow_steps s3
                     where s3.batch_id = p_batch_id and s3.status not in ('completed','failed')
                     order by s3.step_order limit 1),
    'steps', coalesce(jsonb_agg(jsonb_build_object(
               'code',step_code,'name',step_name,'order',step_order,'status',status,
               -- Syrové časy pro měření fází; viz hlavička (délku počítá čtenář).
               'started_at',started_at,'completed_at',completed_at,
               -- Čím se popíše BRÁNA (krok čekající na člověka): co se po něm chce
               -- a čí je to práce. `assigned_role` je ROLE, ne jméno — na věž se
               -- osobní údaj nedostane ani oklikou.
               'description',description,'assigned_role',assigned_role)
               order by step_order), '[]'::jsonb)
  ) into v_result
  from production_workflow_steps where batch_id = p_batch_id;
  return v_result;
end $function$;

REVOKE ALL ON FUNCTION public.get_batch_workflow_progress(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_batch_workflow_progress(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_batch_workflow_progress(uuid) TO service_role;
