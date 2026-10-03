-- Data RPC for a 'review_queue' block: DOTAZY NA PRAVDU nad nálezy ingestu.
--
-- ⛔ NAMĚŘENO 2026-09-28 (produkce, extranet): blok „Nálezy" ukazoval 79 řádků
-- „Součet položek nesedí s celkovou částkou" / „Data dokladu jsou v nesprávném
-- pořadí", každý s jedním souborem a bez čísel. Uživatel: „nevím k čemu to je
-- a nejde s tím stejně nic dělat". Tři vady najednou:
--   1. jeden řádek na DOKLAD — tatáž otázka 43× za sebou;
--   2. bez důkazu — get_evidence_findings zahodil evidence (o kolik, která data);
--   3. bez akce — nález nešlo potvrdit ani odmítnout, seznam nikdy nezmizel.
--
-- Tady je jednotkou DOTAZ: jedno pravidlo × jeden druh nálezu (question_id =
-- li_finding_question_id). Nese počet dotčených dokladů, popis pravidla (co
-- tvrdí) a jeden PŘÍKLAD s čísly, a ptá se: platí to? Odpověď (větev 'finding'
-- v submit_evidence_review_audited) platí pro celé pravidlo — i pro doklady,
-- které ingest přinese později — a dotaz z fronty zmizí.
--
-- ⭐ SKUPINA = PRAVIDLO, ne titulek. Dvě různá pravidla smí vydat týž druh
-- nálezu (date_order_violation: faktura „DUZP ≤ vystavení ≤ splatnost" i smlouva
-- „podpis ≤ platnost od ≤ do"), a odpověď na ně se může lišit — nájmy se
-- fakturují předem, smlouvy se podepisují zpětně. Sloučit je by znamenalo
-- ukázat příklad jednoho a nechat člověka rozhodnout o obou.
--
-- ZASTARALÉ VERZE DOKLADŮ SE NEPOČÍTAJÍ (li_finding_is_current) — odtud
-- dřív tentýž soubor 2× v seznamu.
--
-- SECURITY INVOKER — o viditelnosti rozhoduje RLS (li_findings,
-- li_source_registry i li_finding_verdicts čte jen admin/staff).
-- Contract: (jsonb) -> jsonb {data:{entity_kind, items[], actions[]}, provenance}.

create or replace function public.get_finding_questions(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with platne as (
    select
      f.id,
      f.rule_key,
      f.finding,
      case coalesce(f.severity, 'low') when 'high' then 3 when 'medium' then 2 else 1 end as vaha,
      f.documents,
      f.evidence,
      nullif(btrim(f.raw_data->>'description'), '')             as popis,
      f.ingested_at,
      public.li_finding_question_id(f.rule_key, f.finding)       as question_id
    from public.li_findings f
    where public.li_finding_is_current(f.documents)
  ),
  otevrene as (
    select p.*
      from platne p
     where not exists (select 1 from public.li_finding_verdicts v
                        where v.question_id = p.question_id)
  ),
  skupiny as (
    select
      o.question_id,
      max(o.vaha)         as vaha,
      max(o.ingested_at)  as naposledy,
      (select count(distinct coalesce(d->>'filename', d->>'source_sha256'))
         from otevrene o2, jsonb_array_elements(coalesce(o2.documents, '[]'::jsonb)) d
        where o2.question_id = o.question_id)                   as dokladu
    from otevrene o
    group by o.question_id
  ),
  -- Příklad = nejnovější nález skupiny (deterministicky: čas, soubor, id).
  priklady as (
    select distinct on (o.question_id) o.*
      from otevrene o
     order by o.question_id, o.ingested_at desc, o.documents->0->>'filename', o.id
  ),
  dotazy as (
    select
      s.vaha,
      s.dokladu,
      s.naposledy,
      p.question_id,
      jsonb_strip_nulls(jsonb_build_object(
        'id',           p.question_id::text,
        'title_key',    'app.wb.finding.' || p.finding,
        'subtitle_key', 'app.wb.finding_question.subtitle',
        'state',        'needs_review',
        'quote',        p.popis,
        'fields',       jsonb_build_array(
                          public.li_finding_field('documents', 'app.wb.field.documents', to_jsonb(s.dokladu)),
                          public.li_finding_field('example', 'app.wb.finding_question.example',
                            to_jsonb(coalesce(p.documents->0->>'filename', p.documents->0->>'source_slug'))))
                        || public.li_finding_evidence_fields(p.evidence)
      )) as item
    from skupiny s
    join priklady p on p.question_id = s.question_id
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'entity_kind', 'finding',
      'items', coalesce(jsonb_agg(d.item order by d.vaha desc, d.dokladu desc, d.question_id), '[]'::jsonb),
      'actions', jsonb_build_array(
        jsonb_build_object('action_key', 'app.wb.finding_question.action.confirm',
                           'decision', 'confirmed', 'intent', 'approve'),
        jsonb_build_object('action_key', 'app.wb.finding_question.action.reject',
                           'decision', 'rejected', 'intent', 'reject'))
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'li-findings',
      'freshness_at', to_char(coalesce(max(d.naposledy), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'finding-questions'
    )
  )
  from dotazy d;
$$;

revoke all on function public.get_finding_questions(jsonb) from public, anon;
grant execute on function public.get_finding_questions(jsonb) to authenticated, service_role;
