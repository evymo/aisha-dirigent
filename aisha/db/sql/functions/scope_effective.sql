-- scope_effective — THE SINGLE OWNER of the scope rule.
--
-- Every consumer inherits its verdict; nobody re-implements it. That is the
-- whole point: if each RPC applied the scope its own way, then everyone is
-- responsible for it and therefore nobody is. Same pattern as
-- document_visible_to, the single owner of the sensitivity rule — consumers did
-- not change when that landed, and they must not change when this does.
--
-- WHAT IT IS NOT: an authorization input. The caller controls p_params, so a
-- scope can only ever SUBTRACT from what the identity may already see. The real
-- boundary stays where it is (RLS + relations); running SECURITY INVOKER is what
-- makes that structural rather than promised — the visibility probes below
-- execute as the caller, so an invisible row is invisible here too.
--
-- NOT AN EXISTENCE ORACLE: "no such row" and "not yours" collapse into ONE
-- reason, `not_visible`. A distinguishable answer would turn the lens into a
-- probe for rows the caller cannot read — ask for company X, read the reason,
-- learn whether X exists. Same oracle guard as workflow_step_visible_to.
--
-- WHAT VOUCHING MEANS. Three resolvers, chosen by the SHAPE of the value, so no
-- instance vocabulary leaks into the platform:
--   * story — dim = 'story' and the value is a uuid → must be a visible story.
--   * twin  — any other dim whose value is a uuid → must be a visible twin
--     WHOSE entity_type EQUALS the dim. A company coordinate carrying a
--     vehicle's uuid is not a company; accepting it would let a caller relabel
--     one node as another and get an answer titled with the wrong node.
--   * none  — value is not a uuid (a slug like 'najmy'). Passed through
--     UNVERIFIED and marked as such: this function cannot vouch for an axis it
--     has no substrate for, and pretending otherwise is the lie this mechanism
--     exists to prevent. The CONSUMER then declares whether it honoured the
--     coordinate (block-level scope_applied) — that is where that loop closes.
--
-- Contract: (jsonb) -> jsonb {requested[], effective[], dropped[]}.

create or replace function public.scope_effective(p_scope jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_req  jsonb := public.scope_normalize(p_scope);
  v_c    jsonb;
  v_dim  text;
  v_val  text;
  v_eff  jsonb := '[]'::jsonb;
  v_drop jsonb := '[]'::jsonb;
  v_ok   boolean;
begin
  for v_c in select value from jsonb_array_elements(v_req) loop
    v_dim := v_c->>'dim';
    v_val := v_c->>'value';

    -- uuid by shape, not by cast: a failed cast inside a loop would need an
    -- exception block per coordinate, and this predicate is IMMUTABLE-cheap.
    if v_val !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_eff := v_eff || jsonb_build_array(v_c || jsonb_build_object('resolver', 'none'));
      continue;
    end if;

    if v_dim = 'story' then
      select true into v_ok
      from public.partner_stories s
      where s.id = v_val::uuid
      limit 1;
      if coalesce(v_ok, false) then
        v_eff := v_eff || jsonb_build_array(v_c || jsonb_build_object('resolver', 'story'));
      else
        v_drop := v_drop || jsonb_build_array(
          jsonb_build_object('dim', v_dim, 'value', v_val, 'reason', 'not_visible'));
      end if;
      v_ok := null;
      continue;
    end if;

    select true into v_ok
    from public.twin_entities t
    where t.id = v_val::uuid
      and t.entity_type = v_dim
      and t.status = 'active'
    limit 1;
    if coalesce(v_ok, false) then
      v_eff := v_eff || jsonb_build_array(v_c || jsonb_build_object('resolver', 'twin'));
    else
      -- Covers all three of: no such twin, not visible to this identity, and
      -- visible but of another type. One reason on purpose (see oracle guard).
      v_drop := v_drop || jsonb_build_array(
        jsonb_build_object('dim', v_dim, 'value', v_val, 'reason', 'not_visible'));
    end if;
    v_ok := null;
  end loop;

  return jsonb_build_object('requested', v_req, 'effective', v_eff, 'dropped', v_drop);
end;
$$;

comment on function public.scope_effective(jsonb) is
  'Single owner of the scope rule: canonicalises a scope vector, vouches for uuid coordinates against the story/twin substrate as the CALLER (SECURITY INVOKER, so RLS decides), passes unverifiable slug coordinates through marked resolver=none, and reports drops with one non-oracle reason.';

revoke all on function public.scope_effective(jsonb) from public, anon;
grant execute on function public.scope_effective(jsonb) to authenticated, service_role;
