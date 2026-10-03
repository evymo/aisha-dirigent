-- Data RPC for a 'review_queue' block: proposed twin-identity bindings awaiting
-- HUMAN ratification (pověření). AISHA proposes cross-source bindings from the
-- sources (twin_identity_propose_binding, state='proposed'); a human confirms or
-- rejects them here. This is the surface-side (consumer) of the binding seam —
-- the queue where "AISHA identified an entity, now authorize its twin".
--
-- Seam, not new domain: it delegates to twin_identity_list_unmatched (the existing
-- DEFINER'd, admin/staff-gated ratification queue — source_key is PII) and merely
-- RESHAPES its bare array into the review_queue {items, actions} contract that
-- get_block_data + BlockRenderer already speak (mirrors get_obligation_queue).
--
-- Access degrades gracefully: non-staff callers get an empty queue (not an error),
-- so get_block_data never 500s for a normal extranet user.
--
-- Contract: (jsonb) -> jsonb {data:{entity_kind:'twin_identity', items[], actions[]}, provenance}.

create or replace function public.get_twin_identity_queue(p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_raw   jsonb := '[]'::jsonb;
  v_items jsonb;
begin
  -- Ratification is admin/staff work (source_key is PII); everyone else sees an
  -- empty queue rather than a 'Unauthorized' exception bubbling through the block.
  if public.is_admin_or_staff() then
    v_raw := public.twin_identity_list_unmatched(
      nullif(p_params->>'entity_type', ''),
      coalesce(nullif(p_params->>'limit', '')::int, 100)
    );
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',           e->>'ref_id',
             'title',        coalesce(nullif(e->>'twin_label', ''), e->>'source_key'),
             'subtitle_key', 'app.twins.review.proposed',
             'state',        'needs_review',
             'fields',       jsonb_build_array(
               jsonb_build_object('key', 'entity_type', 'label_key', 'app.twins.field.entity_type', 'value', e->>'entity_type'),
               jsonb_build_object('key', 'source',      'label_key', 'app.twins.field.source',      'value', e->>'source'),
               jsonb_build_object('key', 'source_key',  'label_key', 'app.twins.field.source_key',  'value', e->>'source_key'),
               jsonb_build_object('key', 'ref_kind',    'label_key', 'app.twins.field.ref_kind',    'value', e->>'ref_kind'),
               jsonb_build_object('key', 'proposed_by', 'label_key', 'app.twins.field.proposed_by', 'value', e->>'proposed_by'),
               jsonb_build_object('key', 'confidence',  'label_key', 'app.twins.field.confidence',  'value', e->>'confidence'),
               -- Převzetí klíče od jiného dvojčete = jiné rozhodnutí než nová vazba.
               -- Text, ne boolean: maska tabulky/fronty boolean nepřipouští.
               jsonb_build_object('key', 'conflict',    'label_key', 'app.twins.field.conflict',
                                  'value', CASE WHEN (e->>'conflict')::boolean THEN 'true' ELSE 'false' END)
             )
           )
           order by e->>'created_at'
         ), '[]'::jsonb)
    into v_items
  from jsonb_array_elements(v_raw) as e;

  return jsonb_build_object(
    'data', jsonb_build_object(
      'entity_kind', 'twin_identity',
      'items', v_items,
      'actions', jsonb_build_array(
        jsonb_build_object('action_key', 'app.twins.action.confirm', 'decision', 'confirmed', 'intent', 'approve'),
        jsonb_build_object('action_key', 'app.twins.action.reject',  'decision', 'rejected',  'intent', 'reject')
      )
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'twin-core',
      'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'twin-identity-queue'
    )
  );
end;
$$;

revoke all on function public.get_twin_identity_queue(jsonb) from public, anon;
grant execute on function public.get_twin_identity_queue(jsonb) to authenticated, service_role;
