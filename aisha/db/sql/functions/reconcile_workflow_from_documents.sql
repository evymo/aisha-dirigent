-- ============================================================================
-- Source of Truth: reconcile_workflow_from_documents
-- Popis: Proces se srovná s PRAVDOU DOKLADU. Doklad, který účetnictví uzavřelo
--        (`settled=True`), uzavře i svůj procesní krok.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (admin/staff nebo service_role)
--
-- ⛔ PROČ VZNIKLA. Naměřeno 2026-08-31 na produkci: ze 40 863 kroků „předání"
--    bylo pending VŠECH 40 863 — a přitom 20 070 z nich má doklad se
--    `settled=True`. Účetnictví je uzavřelo, proces se to nikdy nedozvěděl,
--    takže „neuzavřené" znamenalo prakticky všechno a nešlo z toho
--    rozhodovat. Skutečně otevřených bylo 522.
--
-- ⭐ SMĚR JE JEDNOZNAČNÝ: doklad je zdroj, proces je odvozenina. Narovnává se
--    tedy proces podle dokladu, NIKDY naopak — a nikdy ručním zápisem do
--    úložiště. Když se doklad znovu natáhne z Money, tahle funkce z něj
--    pravdu převezme; to je celý mechanismus samoopravy.
--
-- ⭐ JEDEN KÓD, DVĚ CESTY: volá ji ingest po každém balíčku (nativně)
--    i administrace na vyžádání. Ne dvě implementace, které se rozejdou.
--
-- ⛔ NEUZAVÍRÁ, CO NEVÍ. Doklad bez údaje `settled` se NECHÁVÁ BÝT. Chybějící
--    údaj není „uzavřeno"; domněnka by tu vyrobila přesně ta falešná data,
--    kvůli kterým funkce vzniká.
--
-- ⛔ ČTE REGISTR, NE KROK. První verze brala `settled` z `input_data` kroku —
--    jenže ten je ZAMRZLÝ ve chvíli, kdy krok vznikl, takže čerstvý tah
--    z Money by proces nikdy nenarovnal a celý mechanismus samoopravy by byl
--    na papíře. Pravda teče INGESTEM do `li_source_registry` a odtud se čte;
--    párování `dl_number ↔ dn_number` ověřeno na 122 589 krocích.
--
-- ⛔ NEOTVÍRÁ ZPĚT. Krok, který člověk potvrdil (`completed`), zůstává —
--    lidské rozhodnutí nepřepisuje strojové srovnání.
--
-- Kontrakt: (boolean) -> jsonb {ok, zavreno, preskoceno_bez_udaje, dry_run}
-- ============================================================================

create or replace function public.reconcile_workflow_from_documents(
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_kandidatu integer;
  v_bez_udaje integer;
  v_zavreno   integer := 0;
begin
  if not (public.is_service_role() or public.is_admin_or_staff()) then
    -- Fail-closed a POJMENOVANĚ: tohle je zápis do provozních dat, takže
    -- prázdný výsledek by byl horší než odmítnutí — vypadal by jako „nic
    -- k narovnání".
    return jsonb_build_object('ok', false, 'error', 'nedostatečné oprávnění');
  end if;

  -- Aktuální pravda dokladu z registru. `max` proto, že týž doklad může být
  -- v registru vícekrát (duplicity ze dvou generací ingestu) — a stačí, když
  -- ho JEDNA kopie hlásí jako uzavřený: uzavřenost se odvolat nedá.
  create temporary table if not exists _pravda_dokladu on commit drop as
  select r.fields->'dn_number'->>'value' as dl,
         max(r.fields->'settled'->>'value') as settled
  from public.li_source_registry r
  where r.doc_type = 'delivery_note' and r.fields ? 'dn_number'
  group by 1;

  select count(*) into v_kandidatu
  from public.production_workflow_steps s
  join _pravda_dokladu d on d.dl = s.input_data->>'dl_number'
  where s.status = 'pending' and d.settled = 'True';

  select count(*) into v_bez_udaje
  from public.production_workflow_steps s
  left join _pravda_dokladu d on d.dl = s.input_data->>'dl_number'
  where s.status = 'pending' and coalesce(d.settled, '') <> 'True'
    and coalesce(d.settled, '') <> 'False';

  if not p_dry_run then
    update public.production_workflow_steps s
       set status = 'completed',
           completed_at = coalesce(s.completed_at, now()),
           -- Stopa PŮVODU uzávěrky: aby šlo poznat, co uzavřel člověk a co
           -- srovnání s dokladem. Bez toho by se za měsíc nedalo rozlišit.
           output_data = coalesce(s.output_data, '{}'::jsonb)
                         || jsonb_build_object('uzavreno_srovnanim', true,
                                               'zdroj', 'li_source_registry.settled',
                                               'kdy', now())
     from _pravda_dokladu d
     where d.dl = s.input_data->>'dl_number'
       and s.status = 'pending'
       and d.settled = 'True';
    get diagnostics v_zavreno = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'kandidatu', v_kandidatu,
    'zavreno', v_zavreno,
    'preskoceno_bez_udaje', v_bez_udaje
  );
end;
$function$;

revoke all on function public.reconcile_workflow_from_documents(boolean) from public, anon;
grant execute on function public.reconcile_workflow_from_documents(boolean) to authenticated, service_role;
