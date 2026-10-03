-- Function: public.li_finding_evidence_fields
-- Z důkazu jednoho nálezu (li_findings.evidence) udělá pole k zobrazení — CO
-- přesně na příkladu nesedí. Bez toho dotaz na pravdu nejde zodpovědět: „součet
-- položek nesedí" je tvrzení, „položky 12 340, základ 12 338, rozdíl 2" je
-- teprve něco, podle čeho člověk pozná, jestli jde o chybu, nebo o zaokrouhlení.
--
-- Tvar důkazu určuje OPERÁTOR kontroly (evidence.op), a ten je v ingestu
-- UZAVŘENÝ výčet (stage_consistency.CHECKS: date_order, date_max_gap,
-- sum_equals, lines_sum_equals, equals). Neznámý operátor — typicky nálezy
-- mezidokladových pravidel, která `op` nenesou — vrátí prázdné pole: příkladem
-- pak zůstává jméno dokladu, nic se nedomýšlí.
--
-- Popisky polí dokladu jdou přes `app.wb.field.<pole>`, tedy TÝŽ klíč, kterým
-- je popisuje detail dokladu (get_document_detail). Jména polí pocházejí
-- z pravidel instance (consistency_rules.json), takže jejich překlady patří
-- k instanci spolu s pravidly.

create or replace function public.li_finding_evidence_fields(p_evidence jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  e      jsonb := coalesce(p_evidence, '{}'::jsonb);
  v_out  jsonb := '[]'::jsonb;
  v_pole text;
begin
  case e->>'op'
    when 'lines_sum_equals', 'sum_equals' then
      v_out := jsonb_build_array(
        public.li_finding_field(
          case when e->>'op' = 'lines_sum_equals' then 'lines_sum' else 'parts_sum' end,
          case when e->>'op' = 'lines_sum_equals' then 'app.wb.finding_question.lines_sum'
               else 'app.wb.finding_question.parts_sum' end,
          coalesce(e->'lines_sum', e->'parts_sum')),
        public.li_finding_field(e->>'total_field', 'app.wb.field.' || (e->>'total_field'), e->'total_value'),
        public.li_finding_field('diff', 'app.wb.finding_question.diff', e->'diff'));
    when 'date_order' then
      -- Jen ta dvojice, která pořadí porušila — ne všechna data dokladu.
      for v_pole in select jsonb_array_elements_text(coalesce(e->'violated', '[]'::jsonb)) loop
        v_out := v_out || jsonb_build_array(
          public.li_finding_field(v_pole, 'app.wb.field.' || v_pole, e->'values'->v_pole));
      end loop;
    when 'date_max_gap', 'equals' then
      for v_pole in select jsonb_array_elements_text(coalesce(e->'fields', '[]'::jsonb)) loop
        v_out := v_out || jsonb_build_array(
          public.li_finding_field(v_pole, 'app.wb.field.' || v_pole, e->'values'->v_pole));
      end loop;
      if e->>'op' = 'date_max_gap' then
        v_out := v_out || jsonb_build_array(
          public.li_finding_field('days_apart', 'app.wb.finding_question.days_apart', e->'days_apart'));
      end if;
    else
      null;
  end case;
  -- Pole bez klíče (důkaz bez total_field apod.) by neprošlo kontraktem a shodilo
  -- by celou frontu; raději ho vynechat.
  return coalesce((
    select jsonb_agg(p) from jsonb_array_elements(v_out) p where p ? 'key'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.li_finding_evidence_fields(jsonb) from public, anon;
grant execute on function public.li_finding_evidence_fields(jsonb) to authenticated, service_role;
