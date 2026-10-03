-- Dispatcher: zavolá datové RPC konfigurované v bloku, VÝHRADNĚ přes allowlist
-- surface_data_rpcs (format %I — žádný passthrough libovolného jména). SECURITY INVOKER:
-- blok i cílové RPC běží pod právy volajícího (RLS rozhoduje).

create or replace function public.get_block_data(
  p_block_slug text,
  p_params     jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_block  public.surface_blocks%rowtype;
  v_result jsonb;
begin
  select * into v_block
  from public.surface_blocks
  where block_slug = p_block_slug
    and is_active;
  if not found then
    raise exception 'unknown or inactive block' using errcode = 'P0002';
  end if;

  -- allowlist gate (běhová pojistka nad FK): RPC musí být aktivní řádek allowlistu
  perform 1 from public.surface_data_rpcs
   where rpc_name = v_block.source_rpc and is_active;
  if not found then
    raise exception 'data rpc not allowlisted' using errcode = '42501';
  end if;

  -- ⛔ PUBLIKUM JE HRANICE DAT, NE JEN VÝPISU (naměřeno 2026-09-03, audit U4-5).
  -- `audience` v surface_layouts dosud hlídalo jen list_surface_sections;
  -- sem se dalo přijít rovnou se slugem bloku a data dostat, i když sekce
  -- byla jen pro admin/staff. Blok, který volající nesmí VIDĚT, nesmí ani
  -- ČÍST: musí existovat aktivní umístění, jehož publikum ho pustí. Blok bez
  -- umístění nemá koho pustit — proto nic (service role je výjimka: seedy
  -- a doktor blok čtou bez sekce).
  if not public.is_service_role() then
    perform 1
      from public.surface_layouts l
     where l.block_id = v_block.id
       and l.is_active
       and public.surface_audience_allows(auth.uid(), coalesce(l.audience, '{}'::jsonb));
    if not found then
      raise exception 'block not available to caller' using errcode = '42501';
    end if;
  end if;

  -- Klient smí konfiguraci DOPLNIT — kalendář nad frontou to potřebuje
  -- (absolutní den přebíjí `due='today'`, viz heals 2026-08-05). U bloku
  -- s citlivostí `restricted` je ale konfigurace autoritativní: `columns`
  -- a `event_type` od klienta by nad SECURITY DEFINER zdrojem znamenaly
  -- čtení libovolných sloupců napříč RLS (W4, audit U4-5).
  --
  -- ⭐ KONTRAKT KLIENTSKÝCH PARAMETRŮ (ADR-003 K3, 2026-09-05). Restricted blok
  -- bere od klienta JEN klíče, které jeho konfigurace výslovně deklaruje
  -- v `source_params.client_params` (typ ověřen, kolize s konfigurací
  -- zahozena) — surface_client_params_filter. Tím dostal detail záznamu,
  -- hledání a osa pohledu legální cestu; do té doby šlo parametr protlačit
  -- jen snížením citlivosti bloku, což bylo obcházení, ne návrh.
  -- Samotná deklarace se RPC nepředává (není to parametr dotazu).
  execute format('select public.%I($1)', v_block.source_rpc)
    into v_result
    using case
      when v_block.sensitivity = 'restricted'
        then (coalesce(v_block.source_params, '{}'::jsonb) - 'client_params')
             || public.surface_client_params_filter(v_block.source_params, p_params)
      else (coalesce(v_block.source_params, '{}'::jsonb) - 'client_params')
             || coalesce(p_params, '{}'::jsonb)
    end;

  if v_result is null then
    raise exception 'data rpc returned null' using errcode = 'P0002';
  end if;

  -- Obálka bloku: kontraktní pole doplní hodnoty z definice (data + provenance dodává RPC).
  return v_result || jsonb_build_object(
    'schema_version', v_block.schema_version,
    'block_slug',     v_block.block_slug,
    'block_type',     v_block.block_type,
    'title_key',      v_block.title_key,
    'sensitivity',    v_block.sensitivity
  );
end;
$$;

-- Kontrakt na cílová RPC (dokumentační): přijímají jsonb, vracejí jsonb s poli
-- 'data' a 'provenance' {source_slug, freshness_at, trace_id}; SECURITY INVOKER; RLS-safe.

-- Grants: authenticated + service_role (NOT anon, #566 floor); RLS on the underlying
-- tables is the real access boundary (SECURITY INVOKER — runs as the caller).
REVOKE ALL ON FUNCTION public.get_block_data(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_block_data(text, jsonb) TO authenticated, service_role;
