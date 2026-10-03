-- SECURITY INVOKER: o viditelnosti rozhoduje RLS (default deny). Uživatel bez grantu dostane
-- prázdný layout, ne chybu (acceptance kritérium multi-surface spec §3 — nevyzrazovat existenci).

create or replace function public.get_surface_layout(p_surface text)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'surface', p_surface,
    'blocks', coalesce(
      jsonb_agg(
        -- strip_nulls: blok bez deklarované prezentace klíč vůbec nenese —
        -- starší nasazený shell (schema bez 'presentation') by na null spadl
        -- a s additionalProperties:false by zahodil CELÝ layout.
        jsonb_strip_nulls(jsonb_build_object(
          'block_slug', b.block_slug,
          'block_type', b.block_type,
          'title_key',  b.title_key,
          'position',   l.position,
          -- Uspořádání je vlastnost KONFIGURACE bloku (DATA), ne kódu: shell
          -- dostane nápovědu a neznámou hodnotu ignoruje (degradace na default).
          'presentation', b.source_params->>'presentation'
        ))
        -- Tiebreak block_slug: bez něj je pořadí při shodné position nedeterministické
        -- (naměřeno 07-27 — 4 kolize na tehdejší 'mobile' skládce, layout se mohl
        -- přeskládat mezi voláními).
        order by l.position, b.block_slug
      ) filter (where b.id is not null),
      '[]'::jsonb
    )
  )
  from public.surface_layouts l
  join public.surface_blocks b on b.id = l.block_id and b.is_active
  where l.surface = p_surface
    and l.is_active;
$$;

-- Grants: authenticated + service_role (NOT anon, #566 floor); RLS on the underlying
-- tables is the real access boundary (SECURITY INVOKER — runs as the caller).
REVOKE ALL ON FUNCTION public.get_surface_layout(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_surface_layout(text) TO authenticated, service_role;
