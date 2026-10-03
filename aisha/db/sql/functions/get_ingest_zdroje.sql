-- Function: public.get_ingest_zdroje
-- Blok povrchu: registr zdrojů ingestu — co je aktivní, co čeká na klasifikaci.
--
-- PROČ: zdroj musí být registrovaný a AKTIVNÍ, jinak obsah nemá kontext a
-- KB pruh fail-closed padá. Do 2026-08-30 se to dalo zjistit jedině dotazem
-- do databáze; operátor tedy nevěděl, že se někde hlásí zdroj čekající na
-- rozhodnutí. Tenhle blok dělá ten stav viditelným.
--
-- ⛔ POVĚŘENÍ SE NEVYDÁVÁ, ANI ČÁSTEČNĚ. Vydává se jen ANO/NE, jestli je
-- odkaz na tajemství nastavený. Povrch je čtený lidmi i klienty v šesti
-- jazycích; hodnota tajemství tam nemá co dělat v žádné podobě — ani
-- zkrácená, ani maskovaná (maskovaná hodnota pořád prozrazuje délku a tvar).
create or replace function public.get_ingest_zdroje(p_params jsonb default '{}'::jsonb)
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
        jsonb_build_object('key','zdroj',      'label_key','app.cols.source'),
        jsonb_build_object('key','stav',       'label_key','app.cols.state'),
        jsonb_build_object('key','klasifikace','label_key','app.cols.classification','align','center'),
        jsonb_build_object('key','citlivost',  'label_key','app.cols.sensitivity'),
        jsonb_build_object('key','povereni',   'label_key','app.cols.credentials'),
        jsonb_build_object('key','story',      'label_key','app.cols.story','align','center'),
        jsonb_build_object('key','namespace',  'label_key','app.cols.namespace'));
  v_prov jsonb := jsonb_build_object(
    'source_slug', 'agent_knowledge_sources',
    'trace_id', 'ingest:zdroje',
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
           'id',      s.id::text,
           'zdroj',   s.source_slug,
           'stav',    case when s.is_active then 'aktivní'
                           when s.config->>'proposed_by' is not null then 'návrh z ingestu'
                           else 'neaktivní' end,
           'namespace', s.namespace,
           -- Klasifikace jako POČET z pěti: aktivovat jde jen s úplnou, takže
           -- „4/5" je přesně ta informace, kvůli které zdroj nejde spustit.
           -- Klíče = závora agent_knowledge_sources_activation_guard (kontrakt
           -- §1 + vlastník §3); musí s ní souhlasit, jinak výpis hlásí úplnou
           -- klasifikaci zdroji, který závora nepustí (2026-09-24).
           'klasifikace', (
              (case when s.config ? 'source_type'      then 1 else 0 end)
            + (case when s.config ? 'data_sensitivity' then 1 else 0 end)
            + (case when s.config ? 'retention_class'  then 1 else 0 end)
            + (case when s.config ? 'legal_basis'      then 1 else 0 end)
            + (case when s.config ? 'owner'            then 1 else 0 end))::text || '/5',
           'citlivost', coalesce(s.config->>'data_sensitivity', '—'),
           -- ⛔ Jen PŘÍTOMNOST odkazu, nikdy hodnota.
           'povereni', case when s.config ? 'secret_ref' or s.config ? 'credentials_ref'
                            then 'nastaveno' else '—' end,
           'story',   case when s.story_id is null then '—' else 'ano' end
         ) order by s.is_active desc, s.source_slug), '[]'::jsonb)
    into v_rows
  from public.agent_knowledge_sources s;

  return jsonb_build_object(
    'data', jsonb_build_object(
      'columns', v_cols,
      'rows', v_rows,
      'row_kind', 'ingest_source'),
    'provenance', v_prov);
end $$;

REVOKE ALL ON FUNCTION public.get_ingest_zdroje(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ingest_zdroje(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ingest_zdroje(jsonb) TO service_role;
