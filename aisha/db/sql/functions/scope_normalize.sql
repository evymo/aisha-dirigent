-- scope_normalize — canonical form of a SCOPE VECTOR.
--
-- A scope is a vector, not a boolean filter: an ordered set of coordinates
--   {dim, value, origin, confidence, detail?}
-- naming WHICH node the reader stands on and — the part that carries
-- accountability — WHO supplied that coordinate.
--
-- WHY A VECTOR AND NOT A FILTER STRING: with a filter you can only ask "is it
-- on"; with a vector you can ask "who says so, and how sure are they". Those are
-- the two questions an answer has to survive a month later. The alternative
-- (scope guessed per call from the wording of a question) is already measured in
-- this repo: answer_verified_facts picks a company by matching tokens of 1194
-- twin labels against the question text, which is how "kolik je hodin?" returned
-- a tenant overview with coverage FULL (production, 2026-07-29). Two sources of
-- truth about scope is noise by construction, and the accidental one wins.
--
-- WHY `origin` IS CLOSED: responsibility cannot be an open string. A coordinate
-- the user picked, one a detector derived and one guessed from wording are three
-- different liabilities, and only a closed vocabulary keeps them apart in the
-- record. The free-text specifics (which detector, which heuristic) ride in
-- `detail`, so naming them never dilutes the four responsibilities.
-- `dim` is open text for the mirror reason: a new axis must be DATA (a row, a
-- derivation), never a release — same doctrine as surface_layouts.surface.
--
-- STRICT, NOT FORGIVING: an unparsable coordinate raises. A scope that silently
-- drops what it did not understand would let the UI claim a narrowing that never
-- happened — the failure class this whole mechanism exists to prevent.
--
-- INPUT SANITATION: `resolver` is an OUTPUT of scope_effective and is stripped
-- here. The caller controls p_params, so a caller-supplied "resolver":"twin"
-- would be a claim of having been vouched for, made by the party that needs
-- vouching.

create or replace function public.scope_normalize(p_scope jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_in    jsonb := coalesce(p_scope, '[]'::jsonb);
  v_c     jsonb;
  v_dim   text;
  v_value text;
  v_origin text;
  v_conf  numeric;
  v_out   jsonb := '[]'::jsonb;
begin
  -- An empty object is the natural "no scope" a JSON client sends; treat it as
  -- the empty vector rather than an error, but anything else non-array is a bug
  -- in the caller and says so.
  if v_in = '{}'::jsonb or v_in = 'null'::jsonb then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(v_in) <> 'array' then
    raise exception 'scope_normalize: scope must be a JSON array of coordinates, got %', jsonb_typeof(v_in)
      using errcode = '22023';
  end if;

  for v_c in select value from jsonb_array_elements(v_in) loop
    if jsonb_typeof(v_c) <> 'object' then
      raise exception 'scope_normalize: coordinate must be an object, got %', jsonb_typeof(v_c)
        using errcode = '22023';
    end if;

    v_dim   := btrim(coalesce(v_c->>'dim', ''));
    v_value := btrim(coalesce(v_c->>'value', ''));
    v_origin := coalesce(nullif(btrim(coalesce(v_c->>'origin', '')), ''), 'user_pick');

    if v_dim !~ '^[a-z][a-z0-9_]*$' then
      raise exception 'scope_normalize: dim % is not a slug ([a-z][a-z0-9_]*)', coalesce(nullif(v_dim, ''), '<empty>')
        using errcode = '22023';
    end if;
    if v_value = '' then
      raise exception 'scope_normalize: coordinate % has an empty value', v_dim using errcode = '22023';
    end if;
    if v_origin not in ('user_pick', 'derived', 'guessed_from_text', 'system') then
      raise exception 'scope_normalize: unknown origin % (closed vocabulary)', v_origin using errcode = '22023';
    end if;

    -- Certainty: a human pick and a platform-imposed coordinate are certain by
    -- definition; a derivation or a guess MUST state how sure it is, because
    -- that number is what a later reader weighs the answer by.
    if v_c ? 'confidence' and jsonb_typeof(v_c->'confidence') = 'number' then
      v_conf := (v_c->>'confidence')::numeric;
    elsif v_origin in ('user_pick', 'system') then
      v_conf := 1.0;
    else
      raise exception 'scope_normalize: origin % on dim % requires an explicit confidence', v_origin, v_dim
        using errcode = '22023';
    end if;
    if v_conf < 0 or v_conf > 1 then
      raise exception 'scope_normalize: confidence % on dim % is outside 0..1', v_conf, v_dim
        using errcode = '22023';
    end if;
    -- A guess is never certain. Allowing 1.0 here would let the weakest origin
    -- masquerade as the strongest and win the dedup below.
    if v_origin = 'guessed_from_text' and v_conf >= 1 then
      raise exception 'scope_normalize: a guessed coordinate (dim %) cannot have confidence 1', v_dim
        using errcode = '22023';
    end if;

    v_out := v_out || jsonb_build_array(
      jsonb_build_object('dim', v_dim, 'value', v_value, 'origin', v_origin, 'confidence', v_conf)
      || case when nullif(btrim(coalesce(v_c->>'detail', '')), '') is null
              then '{}'::jsonb
              else jsonb_build_object('detail', btrim(v_c->>'detail')) end
    );
  end loop;

  -- ONE coordinate per dimension, and the strongest ORIGIN wins before
  -- confidence does: an explicit human pick outranks a system default, which
  -- outranks a derivation, which outranks a guess. Confidence only breaks ties
  -- inside one origin — otherwise a detector reporting 0.99 could quietly
  -- overrule the person who said "I want to look at this company".
  -- Sorted by dim so the same scope is byte-identical every time: a vector that
  -- is recorded, compared and read back has to be canonical, not merely correct.
  select coalesce(jsonb_agg(c order by c->>'dim'), '[]'::jsonb)
    into v_out
  from (
    select distinct on (c->>'dim') c
    from jsonb_array_elements(v_out) c
    order by c->>'dim',
             case c->>'origin'
               when 'user_pick' then 4 when 'system' then 3
               when 'derived' then 2 else 1 end desc,
             (c->>'confidence')::numeric desc
  ) s(c);

  return v_out;
end;
$$;

comment on function public.scope_normalize(jsonb) is
  'Canonical form of a scope vector: validates {dim,value,origin,confidence}, strips caller-claimed resolver, keeps one coordinate per dim (strongest origin first) and sorts by dim so the vector is byte-stable for recording and comparison.';

revoke all on function public.scope_normalize(jsonb) from public, anon;
grant execute on function public.scope_normalize(jsonb) to authenticated, service_role;
