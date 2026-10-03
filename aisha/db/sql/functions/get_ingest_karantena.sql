-- Function: public.get_ingest_karantena
-- Blok povrchu: balíčky, které li-driver ODLOŽIL a čekají na rozhodnutí člověka.
--
-- PROČ TO MÁ BÝT VIDĚT: karanténa vznikla proto, že nezpracovatelný balíček
-- nesmí zastavit frontu. Jenže odložený balíček, o kterém nikdo neví, je jen
-- tišší podoba téhož problému — fronta jede, ale rozhodnutí nikdo neudělá,
-- protože ho nevidí. Naměřeno 2026-08-30: jeden balíček blokoval pět dalších
-- a poznalo se to jen z logu kontejneru.
--
-- Zdrojem je stav driveru (`audience_broker_sync_state.metadata->'karantena'`),
-- ne odvozenina — jediné místo, kde je pravda o tom, co driver odložil.
create or replace function public.get_ingest_karantena(p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
SET search_path TO 'public', 'pg_temp'
as $$
declare
  v_rows jsonb;
  -- ⭐ SLOUPCE JSOU VEŘEJNÉ, OBSAH NE. Fail-closed větev vracela `columns: []`
  -- a maska `table` takový tvar ODMÍTNE (minItems 1) — povrch by odpověď zahodil
  -- a napsal „Zatím není co zobrazit". Odepřený přístup by vypadal jako prázdná
  -- data. Hlavičky proto jdou ven vždy; řádky jen tomu, kdo má nárok.
  v_cols jsonb := jsonb_build_array(
        jsonb_build_object('key','balicek','label_key','app.cols.bundle'),
        jsonb_build_object('key','zdroj',  'label_key','app.cols.source'),
        jsonb_build_object('key','stav',   'label_key','app.cols.state'),
        jsonb_build_object('key','od',     'label_key','app.cols.started'));
  v_prov jsonb := jsonb_build_object(
    'source_slug', 'audience_broker_sync_state',
    'trace_id', 'ingest:karantena',
    'freshness_at', now());
begin
  -- ⛔ NÁROK, ne přihlášení. Funkce běží pod právy vlastníka, takže RLS na ni
  -- NEPLATÍ — kdyby stačilo „je někdo přihlášen", přečetl by registr zdrojů
  -- i řidič. `audience` v rozložení řídí UMÍSTĚNÍ bloku, ne přístup k datům;
  -- ta obrana musí být tady.
  --
  -- PRÁZDNO, ne chyba: kdo nemá nárok, se nemá dozvědět ani to, že se ptal.
  if not (public.is_service_role() or public.is_admin_or_staff()) then
    return jsonb_build_object(
      'data', jsonb_build_object('columns', v_cols, 'rows', '[]'::jsonb),
      'provenance', v_prov);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        b.export_id,
           'balicek',   b.export_id,
           'zdroj',     s.source_slug,
           'stav',      case when s.source_slug is null then 'zdroj neznámý'
                             when s.is_active then 'zdroj aktivní — projde příště'
                             else 'čeká na klasifikaci' end,
           'od',        to_char(s.created_at, 'YYYY-MM-DD HH24:MI')
         ) order by b.export_id), '[]'::jsonb)
    into v_rows
  from public.audience_broker_sync_state st
  cross join lateral jsonb_array_elements_text(
         coalesce(st.metadata->'karantena', '[]'::jsonb)) as b(export_id)
  -- Zdroj se k balíčku váže jen VOLNĚ: karanténa nese id balíčku, ne slug.
  -- Návrh zdroje (proposed_by='ingest') je nejpravděpodobnější důvod odložení.
  left join public.agent_knowledge_sources s
         on s.config->>'proposed_by' = 'ingest'
  where st.source_slug = 'local-ingest';

  return jsonb_build_object(
    'data', jsonb_build_object(
      'columns', v_cols,
      'rows', v_rows,
      'row_kind', 'ingest_bundle'),
    'provenance', v_prov);
end $$;

REVOKE ALL ON FUNCTION public.get_ingest_karantena(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ingest_karantena(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ingest_karantena(jsonb) TO service_role;
