-- ============================================================================
-- Source of Truth: add_story_system_entry
-- Popis: Story-cílený systémový zápis narace (tracking_event/system/action).
--        Doplňuje add_system_timeline_entry (per-user routing) o story-target pro
--        procesní fakta; dedup + provenance metadata. ACL: jen service_role —
--        volán interně z definer RPC (award_tokens vzor).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- Pozn.: definice = regenerát z nasazené DB (ověřeno provozním testem 07-25).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.add_story_system_entry(p_story_id uuid, p_entry_type text, p_content text, p_metadata jsonb DEFAULT NULL::jsonb, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_source_table text DEFAULT NULL::text, p_source_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_allowed text[] := array['tracking_event','system','action'];
  v_entry_id uuid;
begin
  if not (p_entry_type = any(v_allowed)) then
    return jsonb_build_object('ok',false,'error',
      format('entry type %s not allowed (allowed: %s)', p_entry_type, v_allowed::text));
  end if;
  if not exists (select 1 from partner_stories where id = p_story_id) then
    return jsonb_build_object('ok',false,'error','story not found');
  end if;
  -- dedup: same source fact within 1 minute (trigger re-fire protection)
  if p_source_table is not null and p_source_id is not null then
    if exists (
      select 1 from story_entries se
      where se.story_id = p_story_id
        and se.entry_type = p_entry_type
        and se.content = p_content
        and se.metadata->>'source_table' = p_source_table
        and (se.metadata->>'source_id')::uuid = p_source_id
        and se.created_at > now() - interval '1 minute'
    ) then
      return jsonb_build_object('ok',false,'reason','duplicate');
    end if;
  end if;
  insert into story_entries (story_id, entry_type, content, metadata, occurred_at, created_by, is_internal)
  values (
    p_story_id, p_entry_type, p_content,
    jsonb_build_object('source_table',p_source_table,'source_id',p_source_id,'is_system',true)
      || coalesce(p_metadata,'{}'::jsonb),
    coalesce(p_occurred_at, now()),
    null,   -- system entry
    false
  ) returning id into v_entry_id;
  update partner_stories set last_activity_at = now(), updated_at = now() where id = p_story_id;
  return jsonb_build_object('ok',true,'entry_id',v_entry_id);
end $function$;

REVOKE ALL ON FUNCTION public.add_story_system_entry(uuid,text,text,jsonb,timestamp with time zone,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_story_system_entry(uuid,text,text,jsonb,timestamp with time zone,text,uuid) TO service_role;
