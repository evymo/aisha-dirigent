-- scope_story_id — which STORY a run under this scope belongs to.
--
-- "Every run belongs to a story. Not usually — always." (fn_ai_runs_default_story)
-- ai_runs.story_id is NOT NULL, so the schema already insists that a run stands
-- on a node in the network of relations. This function says WHICH node, and —
-- when it cannot say — makes that audible instead of letting the answer quietly
-- collapse into the one bucket everything currently shares.
--
-- Resolution, strongest first:
--   1. an explicit, VOUCHED story coordinate (resolver='story') → that story.
--   2. otherwise NULL + a reason. The BEFORE INSERT trigger then anchors the run
--      to the stack-default story, which is a perfectly ordinary story, and the
--      reason travels in the run's metadata so "this scope has no story yet" is
--      a readable fact rather than a silence.
--
-- WHY NO DERIVATION FROM A COMPANY/OBJECT COORDINATE (yet): measured on
-- production 2026-07-30 — li_links has 0 rows and no table binds a twin to a
-- document, so there is nothing to join a company node to the documents whose
-- story_id we would inherit. Writing a derivation over a substrate that is
-- provably empty would produce a rule that cannot fire and therefore reports
-- neither a relation nor a gap. The seam is named here so that when the binding
-- lands, this is the ONE place that learns it.
--
-- WHAT THIS FUNCTION MUST NEVER DO: create a story. A story per viewpoint is a
-- ratification — a human act on data — and a read path that mints nodes as a
-- side effect of someone changing a dropdown would make the network of relations
-- a landfill.
--
-- Contract: (jsonb) -> jsonb {story_id (uuid|null), origin, detail}.

create or replace function public.scope_story_id(p_scope jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_res   jsonb := public.scope_effective(p_scope);
  v_story text;
  v_dims  text;
begin
  select c->>'value' into v_story
  from jsonb_array_elements(v_res->'effective') c
  where c->>'dim' = 'story' and c->>'resolver' = 'story'
  limit 1;

  if v_story is not null then
    return jsonb_build_object(
      'story_id', v_story,
      'origin',   'scope_explicit',
      'detail',   'story coordinate vouched by scope_effective');
  end if;

  select string_agg(distinct c->>'dim', ',' order by c->>'dim') into v_dims
  from jsonb_array_elements(v_res->'effective') c;

  return jsonb_build_object(
    'story_id', null,
    'origin',   case when v_dims is null then 'no_scope' else 'no_binding' end,
    -- Names the dimensions that were present but could not be turned into a
    -- node. This string is the gap report: it is what tells a reader later that
    -- the answer was anchored to the default story, and why.
    'detail',   case when v_dims is null
                     then 'no scope requested'
                     else 'scope dims [' || v_dims || '] have no story binding (li_links empty, no twin→document link)' end);
end;
$$;

comment on function public.scope_story_id(jsonb) is
  'Resolves a scope vector to the story a run belongs to: an explicit vouched story coordinate wins, otherwise NULL plus the reason (the ai_runs trigger then anchors to the stack-default story). Never creates a story — that is a ratification, not a read.';

revoke all on function public.scope_story_id(jsonb) from public, anon;
grant execute on function public.scope_story_id(jsonb) to authenticated, service_role;
