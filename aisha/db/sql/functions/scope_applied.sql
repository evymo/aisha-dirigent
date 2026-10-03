-- scope_applied — the block's OWN statement that it honoured a lens coordinate.
--
-- The extranet lens (surface_scope_axes, get_scope_options) sends the picked
-- value to EVERY block of the section as p_params->>'<dim>'. A block whose data
-- RPC does not read that key used to answer with ALL rows, looking exactly like a
-- filtered one — measured 2026-09-28 on the contracts section: 5 of 10 blocks
-- (units, tenants, the contracts KPI, identification, obligations) ignored the
-- company and the operator could not tell. "A filter that shows and does nothing
-- is worse than no filter" (see scope_effective, the vouching half).
--
-- WHY THE RPC SAYS IT, NOT A DECLARATION: whether a block honours a dim can
-- depend on the block's configuration (get_twin_register honours owner_company
-- only when source_params.scope_map maps it), so a per-RPC capability flag would
-- lie for one of two blocks sharing the RPC. The RPC calls this ONLY in the branch
-- where it actually filtered; the client compares its lens with
-- provenance.scope_effective and labels every block that stayed silent.
--
-- Shape is the existing contract coordinate (packages/surface-blocks schemas.ts
-- scopeCoordinate): origin 'user_pick' — the lens is the only producer of these
-- keys — and resolver 'none': this RPC matched a value, it did not vouch for a
-- node (that is scope_effective's job).
--
-- Returns {} when the dim is absent or blank, so `provenance || scope_applied(…)`
-- leaves an unscoped call byte-identical.
--
-- Contract: (jsonb, text) -> jsonb {} | {scope_effective:[coordinate]}.
create or replace function public.scope_applied(p_params jsonb, p_dim text)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    -- Same emptiness test as the consumers (`nullif(p_params->>'<dim>', '')`),
    -- so "filtered" and "reported as filtered" can never disagree.
    when nullif(p_params->>p_dim, '') is null then '{}'::jsonb
    else jsonb_build_object('scope_effective', jsonb_build_array(jsonb_build_object(
           'dim',        p_dim,
           'value',      p_params->>p_dim,
           'origin',     'user_pick',
           'confidence', 1,
           'resolver',   'none')))
  end;
$$;

comment on function public.scope_applied(jsonb, text) is
  'Provenance fragment a data RPC appends when it FILTERED by lens dim p_dim: {scope_effective:[{dim,value,origin:user_pick,confidence:1,resolver:none}]}, or {} when the dim is absent. The client labels blocks that do not return it as unfiltered.';

revoke all on function public.scope_applied(jsonb, text) from public, anon;
grant execute on function public.scope_applied(jsonb, text) to authenticated, service_role;
