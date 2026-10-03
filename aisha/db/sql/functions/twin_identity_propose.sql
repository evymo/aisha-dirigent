-- Calling-convention wrapper: single-jsonb entrypoint over the scalar
-- twin_identity_propose_binding, so AISHA can propose bindings through the
-- agent_tools contract (dispatcher calls pgrestUser.rpc(handler_ref,{p_params:{...}})).
--
-- Glue only — it unwraps p_params and delegates. ALL logic (idempotence, conflict
-- handling, "never overwrite a confirmed binding", auth) stays in the scalar
-- twin_identity_propose_binding. If domain logic ever creeps in here, that's the
-- recycling anti-pattern (a second proposer) — keep this a pure shape adapter.
--
-- Confirmation is deliberately NOT wrapped: twin_identity_confirm_binding stays a
-- human UI act (pověření), never an AISHA tool. AISHA only proposes.

create or replace function public.twin_identity_propose(p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  return public.twin_identity_propose_binding(
    (p_params->>'twin_id')::uuid,
    p_params->>'source',
    p_params->>'source_key',
    p_params->>'ref_kind',
    coalesce(nullif(p_params->>'proposed_by', ''), 'rule:aisha'),
    nullif(p_params->>'confidence', '')::numeric,
    nullif(p_params->>'note', '')
  );
end;
$$;

revoke all on function public.twin_identity_propose(jsonb) from public, anon;
grant execute on function public.twin_identity_propose(jsonb) to authenticated, service_role;
