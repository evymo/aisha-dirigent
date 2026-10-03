-- Data RPC for a 'review_queue' block: flow-map nodes the INGEST measured and
-- proposed (propose_production_flow_node), awaiting the human act that puts them
-- into production. This is the surface-side of the flow-map seam — the queue where
-- "the corpus says these places are nodes of your process, ratify them".
--
-- WHAT THE REVIEWER SEES IS THE MEASUREMENT, not an opinion: observations, in/out
-- degree, self-loops and the measured role travel with the item, because that is
-- the whole evidence for the proposal. A reviewer who cannot see why something is
-- proposed can only guess, and a guessed ratification is worse than none.
--
-- ORDERED BY EVIDENCE, not by name: with hundreds of places measured from a real
-- corpus, alphabetical order buries the quarry that carries thousands of movements
-- under one-off delivery addresses. Strongest first is the only order in which a
-- partial pass through the queue is still worth something.
--
-- DECIDED PROPOSALS NEVER COME BACK. The filter is the ABSENCE of a verdict, not
-- `is_active = false`: a rejected node stays inactive forever, so filtering on
-- activity alone would resurrect it on every re-drain and the queue would never
-- converge. (Symmetric to the rejection branch in submit_evidence_review_audited.)
--
-- Only INGEST proposals are queued (metadata ? 'proposal'). A node an operator
-- created by hand is not awaiting anyone's ratification and must not be presented
-- as if a machine had suggested it.
--
-- Access degrades gracefully: non-staff callers get an empty queue (not an error),
-- so get_block_data never 500s for a normal extranet user — mirrors
-- get_twin_identity_queue.
--
-- Contract: (jsonb) -> jsonb {data:{entity_kind:'flow_node', items[], actions[]}, provenance}.

create or replace function public.get_flow_node_queue(p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_limit int   := coalesce(nullif(p_params->>'limit', '')::int, 100);
begin
  if public.is_admin_or_staff() then
    select coalesce(jsonb_agg(x.item order by x.observations desc, x.node_name), '[]'::jsonb)
      into v_items
    from (
      select
        n.node_name,
        coalesce((n.metadata->'proposal'->'measured'->>'observations')::numeric, 0) as observations,
        jsonb_build_object(
          'id',           n.id,
          'title',        n.node_name,
          'subtitle_key', 'app.flow.review.proposed',
          'state',        'needs_review',
          'fields', jsonb_build_array(
            jsonb_build_object('key', 'node_type',    'label_key', 'app.flow.field.node_type',
                               'value', n.node_type),
            jsonb_build_object('key', 'role',         'label_key', 'app.flow.field.role',
                               'value', n.metadata->'proposal'->'measured'->>'role'),
            jsonb_build_object('key', 'observations', 'label_key', 'app.flow.field.observations',
                               'value', n.metadata->'proposal'->'measured'->>'observations'),
            jsonb_build_object('key', 'in_out',       'label_key', 'app.flow.field.in_out',
                               'value', concat(coalesce(n.metadata->'proposal'->'measured'->>'in', '0'),
                                               ' / ',
                                               coalesce(n.metadata->'proposal'->'measured'->>'out', '0'))),
            jsonb_build_object('key', 'self_loop',    'label_key', 'app.flow.field.self_loop',
                               'value', n.metadata->'proposal'->'measured'->>'self_loop'),
            jsonb_build_object('key', 'proposed_by',  'label_key', 'app.flow.field.proposed_by',
                               'value', n.metadata->'proposal'->>'proposed_by')
          )
        ) as item
      from public.production_flow_nodes n
      where n.metadata ? 'proposal'                        -- jen návrhy ingestu
        and not (n.metadata->'proposal' ? 'decision')      -- ještě nerozhodnuté
        and not n.is_active
      limit v_limit
    ) x;
  end if;

  return jsonb_build_object(
    'data', jsonb_build_object(
      'entity_kind', 'flow_node',
      'items', v_items,
      'actions', jsonb_build_array(
        jsonb_build_object('action_key', 'app.flow.action.activate', 'decision', 'confirmed', 'intent', 'approve'),
        jsonb_build_object('action_key', 'app.flow.action.dismiss',  'decision', 'rejected',  'intent', 'reject')
      )
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'local-ingest',
      'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'flow-node-queue'
    )
  );
end;
$$;

revoke all on function public.get_flow_node_queue(jsonb) from public, anon;
grant execute on function public.get_flow_node_queue(jsonb) to authenticated, service_role;
