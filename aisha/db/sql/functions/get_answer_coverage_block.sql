-- Pokrytí odpovědního řetězu — které oblasti jsou ověřené a v jakém stavu.
--
-- OBNOVENO ZE ŽIVÉ DATABÁZE (2026-07-28). Tahle funkce běžela v produkci a její
-- definice neexistovala v žádném repu — ani tady, ani v instance-datech, ani
-- v rozpuštěném surfaces repu. Cold start by blok i řádek allowlistu vyrobil
-- a pak zavolal funkci, kterou nikdo nevytvořil.
--
-- Při obnově opraveny tři vady, které měla živá verze:
--
-- 1. PROVENANCE porušovala kontrakt. Vracela {source_slug, kind}, schéma žádá
--    {source_slug, freshness_at, trace_id} a nic navíc. Klient proto CELÝ blok
--    přeskakoval ("block contract violation") — data existovala a nikdo je
--    neviděl.
--
-- 2. INSTANCE LITERÁL v generickém SQL: `context_profile_slug = '<instance>'`. Schéma
--    dědí celý stack, takže tohle je nejdražší možné místo pro jméno instance.
--    Profil teď chodí z `source_params` bloku — tedy generický mechanismus,
--    instanční hodnota (`<instance>/41_surface_blocks.sql` v instančním repu).
--
-- 3. POPISKY bez překladu (`col.oblast`, `col.stav`) — mimo prefix `app.`,
--    takže je i18n brána nevidí. Přejmenováno na `app.cols.*`.
--
-- Bez profilu vrátí PRÁZDNO, ne chybu: prázdný nosič s provenancí je signál
-- „tahle instance pokrytí nedeklaruje", kdežto pád vypadá jako rozbitý blok.

-- 4. BEZ KONTROLY IDENTITY. `security definer` obchází RLS, a živá verze
--    nekontrolovala vůbec nic — kdokoli, kdo se dostal k volání, dostal data.
--    Ostatní blokové RPC mají fail-closed stráž (prázdná obálka bez identity);
--    tahle ji do teď neměla. Doplněno, a proto je funkce plpgsql, ne sql.

create or replace function public.get_answer_coverage_block(p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
SET search_path TO 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Fail-closed: bez identity PRÁZDNO, ne chyba. Prázdný nosič s provenancí je
  -- signál; chyba by vypadala jako rozbitý blok.
  -- ⛔ NÁROK, NE JEN PŘIHLÁŠENÍ (naměřeno 2026-09-11). Guard tu zněl
  -- `uid is null and not is_service_role()` — to ověřuje, že jsi PŘIHLÁŠENÝ,
  -- ne že na to máš nárok. Diferenciální sondou (admin × řidič bez rolí nad
  -- týmiž daty) vycházelo obojí STEJNĚ, tedy kterýkoli řidič dostal admin
  -- pohled. `SECURITY DEFINER` vypne RLS a odpovědnost tím přechází na tělo
  -- funkce; chybějící `if` tu neznamená „zamítnuto", ale plnou odpověď.
  if not (public.is_admin_or_staff() or public.is_service_role()) then
    return jsonb_build_object(
      'data', jsonb_build_object(
        'columns', jsonb_build_array(
          jsonb_build_object('key','oblast','label_key','app.cols.area'),
          jsonb_build_object('key','stav',  'label_key','app.cols.state')),
        'rows', '[]'::jsonb),
      'provenance', jsonb_build_object(
        'source_slug',  'rag_eval_golden',
        'trace_id',     'answer_chain:coverage',
        'freshness_at', now()));
  end if;

  return (select jsonb_build_object(
    'data', jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('key','oblast','label_key','app.cols.area'),
        jsonb_build_object('key','stav',  'label_key','app.cols.state')),
      'rows', coalesce((
        select jsonb_agg(distinct jsonb_build_object(
                 'oblast', tags[3],
                 'stav',   replace(tags[4], 'cov:', '')))
        from public.rag_eval_golden
        where context_profile_slug = nullif(p_params->>'context_profile', '')
          and array_length(tags, 1) >= 4
      ), '[]'::jsonb)),
    'provenance', jsonb_build_object(
      'source_slug',  'rag_eval_golden',
      'trace_id',     'answer_chain:coverage',
      'freshness_at', now())));
end;
$$;

REVOKE ALL ON FUNCTION public.get_answer_coverage_block(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_answer_coverage_block(jsonb) TO authenticated, service_role;
