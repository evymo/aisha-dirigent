-- get_surface_layout_ui — UI METADATA bloků sekce: čím smí uživatel blok ovládat.
--
-- Blok smí vzít od klienta parametry, které jeho konfigurace deklaruje
-- (`source_params.client_params`, viz surface_client_params_filter), jenže extranet
-- o nich nevěděl — měsíc knihy faktur, „jen nad rok“ u pohledávek ani hledání nešlo
-- nikde nastavit (2026-09-29, náčrtek majitele „Smlouvy a nájmy“). Tahle funkce shellu
-- řekne, JAK blok nabídnout: deklarace parametrů (typ, druh ovladače, popisky),
-- výchozí řazení tabulky a zda nad ní ukázat hledání.
--
-- ⭐ SAMOSTATNÁ FUNKCE, NE KLÍČ V LAYOUTU. Schéma layoutu je uzavřené a Ajv je
-- all-or-nothing: nový klíč u bloku by starší nasazený shell přinutil zahodit CELÝ
-- layout sekce. Starý shell tuhle funkci nevolá, takže pořadí nasazení DB × extranet
-- je v obou směrech bezpečné.
--
-- Vydává JEN deklarativní klíče (client_params, default_sort, search) — nikdy celou
-- konfiguraci bloku (ta smí nést věci, které klient vidět nemá).
--
-- SECURITY INVOKER: tytéž řádky jako get_surface_layout (RLS + publikum layoutu).
--
-- Contract: (text) -> jsonb {schema_version:1, surface, blocks:{<block_slug>:{client_params?, default_sort?, search?}}}.
create or replace function public.get_surface_layout_ui(p_surface text)
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
      jsonb_object_agg(
        b.block_slug,
        jsonb_strip_nulls(jsonb_build_object(
          'client_params', case when jsonb_typeof(b.source_params->'client_params') = 'object'
                                then b.source_params->'client_params' end,
          'default_sort',  case when jsonb_typeof(b.source_params->'default_sort') = 'object'
                                then b.source_params->'default_sort' end,
          'search',        case when b.source_params->'search' = 'true'::jsonb
                                then true end
        ))
      ) filter (where b.source_params ?| array['client_params', 'default_sort', 'search']),
      '{}'::jsonb
    )
  )
  from public.surface_layouts l
  join public.surface_blocks b on b.id = l.block_id and b.is_active
  where l.surface = p_surface
    and l.is_active;
$$;

comment on function public.get_surface_layout_ui(text) is
  'UI metadata of a section''s blocks for the shell: declared client_params (typed controls), default_sort and search flag. Separate from get_surface_layout so an older shell never sees an unknown layout key.';

revoke all on function public.get_surface_layout_ui(text) from public, anon;
grant execute on function public.get_surface_layout_ui(text) to authenticated, service_role;
