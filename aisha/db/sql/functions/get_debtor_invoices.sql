-- Data RPC: FAKTURY JEDNOHO ODBĚRATELE — druhé patro prokliku z pohledávek.
--
-- Bez tohohle byla tabulka dlužníků slepá ulička: řádek řekl „315 471 / 896 dní
-- / 7 dokladů" a dál se nešlo. Uživatel se nedostal ani na čísla faktur, ani na
-- to, co z nich máme vytěženo — a AI chat mlčel ze stejného důvodu, protože
-- agregát dostal, ale k dokladu se nedostal.
--
-- ⭐ ČTE SE PODLE IDENTITY, NE PODLE JMÉNA
-- `counterparty_id` (IČO) je klíč; jméno je záložní cesta pro odběratele bez
-- IČO (fyzické osoby v korpusu je běžně nemají). Kdyby se párovalo jen jménem,
-- „KILINC s.r.o." a „KILINC  s.r.o." (dvě mezery) by byly dva různí dlužníci —
-- a naopak dvě firmy téhož jména by splynuly. Řádek z get_receivables_overdue
-- proto nese `id` = IČO, pokud existuje, jinak jméno; sem se posílá beze změny.
--
-- ⭐ POLE SE ČTOU SVÝMI SKUTEČNÝMI JMÉNY
-- Registr nese `invoice_number` a `total_amount`. Starší čtečka se ptala na
-- `doc_number`/`amount_total`, což jsou klíče, které v datech NEJSOU — a
-- chybějící klíč v JSONB vrací NULL, ne chybu. Tabulka se proto vykreslila,
-- součty seděly a detail tiše chyběl. Nová pole (money_id, note, doc_kind)
-- přibyla 2026-08-05; u starší generace dokladů jsou prázdná, což je poctivé
-- „nevíme", ne chyba.
--
-- Opravné doklady (záporné) se NEfiltrují: v seznamu patří vidět, protože
-- vysvětlují, proč je součet nižší než prostý součet faktur.
--
-- Konfigurace (p_params):
--   debtor        : POVINNÉ — IČO nebo jméno odběratele (hodnota `id` z řádku)
--   owner_company : nepovinné — omezení na jednu naši firmu
--   only_open     : 'true' = jen s nenulovým zůstatkem (default), jinak vše
--   limit         : default 200, strop 1000
--
-- SECURITY INVOKER → RLS rozhoduje; bez nároku prázdno, ne chyba.
-- Kontrakt: (jsonb) -> jsonb {data:{columns[], rows[]}, provenance}.

create or replace function public.get_debtor_invoices(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with cfg as (
    select
      nullif(p_params->>'debtor', '')                                as debtor,
      nullif(p_params->>'owner_company', '')                         as company,
      coalesce(nullif(p_params->>'only_open', ''), 'true') = 'true'   as only_open,
      least(coalesce(nullif(p_params->>'limit', '')::int, 200), 1000) as lim,
      public.receivable_from_param(p_params)                          as od,
      public.storno_values_param(p_params)                            as storno
  ),
  faktury as (
    select
      r.created_at                                           as vznik,
      r.fields->'invoice_number'->>'value'                   as cislo,
      r.fields->'variable_symbol'->>'value'                  as vs,
      r.fields->'issue_date'->>'value'                       as vystaveno,
      r.fields->'due_date'->>'value'                         as splatnost,
      r.fields->'total_amount'->>'value'                     as celkem,
      r.fields->'amount_unpaid'->>'value'                    as zbyva,
      r.fields->'note'->>'value'                             as poznamka,
      -- Klíč pro třetí patro. `get_document_detail` UŽ EXISTUJE a ptá se na
      -- `doc_slug` — proklik proto posílá jeho, ne money_id. (Psát druhou
      -- detailní čtečku podle money_id by znamenalo dvě pravdy o tomtéž.)
      r.doc_slug                                             as klic,
      -- Stav z JEDNOHO slovníku (invoice_state) — týž jako karta a dlužníci.
      public.invoice_state(r.fields, cfg.od, cfg.storno)                 as _stav,
      (case when (r.fields->'amount_unpaid'->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then (r.fields->'amount_unpaid'->>'value')::numeric end) as _zbyva_num,
      (case when (r.fields->'due_date'->>'value') ~ '^\d{4}-\d{2}-\d{2}$'
            then (r.fields->'due_date'->>'value')::date end)         as _splatnost_dt
    from public.li_source_registry r, cfg
    where r.doc_type = 'invoice'
      and r.superseded_by is null
      and cfg.debtor is not null
      -- Identita (IČO) NEBO jméno — řádek posílá to, co má.
      and (r.counterparty_id_value = cfg.debtor
           or r.counterparty_value = cfg.debtor)
      and (cfg.company is null or r.owner_company_value = cfg.company)
  ),
  vybrane as (
    select f.*,
           case when f._splatnost_dt is not null and f._zbyva_num > 0.005
                then (current_date - f._splatnost_dt) end as dni
    from faktury f, cfg
    -- „jen otevřené" = vše, co není uhrazené ani stornované (předepsané zůstává:
    -- ještě se bude platit; bez stavu úhrady zůstává: nevíme)
    where not cfg.only_open
       or f._stav not in ('paid', 'storno')
    order by f._splatnost_dt desc nulls last
    limit (select lim from cfg)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('key','cislo',     'label_key','app.cols.invoice_number'),
        jsonb_build_object('key','vs',        'label_key','app.cols.variable_symbol'),
        jsonb_build_object('key','vystaveno', 'label_key','app.cols.issue_date'),
        jsonb_build_object('key','splatnost', 'label_key','app.cols.due_date'),
        jsonb_build_object('key','dni',       'label_key','app.cols.overdue_days','align','right'),
        jsonb_build_object('key','celkem',    'label_key','app.cols.total_amount', 'align','right'),
        jsonb_build_object('key','zbyva',     'label_key','app.cols.amount_unpaid','align','right'),
        -- Stav dokladu jako ŠTÍTEK (vzor prototypu: Uhrazeno / Po splatnosti) —
        -- buňka je i18n klíč (`value_keys`), slovo i glyf dodá plocha.
        jsonb_build_object('key','stav',      'label_key','app.cols.state',       'value_keys', true),
        jsonb_build_object('key','poznamka',  'label_key','app.cols.note')
      ),
      -- Řádek je DOKLAD: jeho `id` je doc slug, takže druhé patro
      -- prokliku otevírá čtečku dokladů. Viz row_kind v get_receivables_overdue.
      'row_kind', 'document',
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 -- `id` = klíč pro třetí patro (get_document_detail)
                 'id',        v.klic,
                 'cislo',     coalesce(v.cislo, '—'),
                 'vs',        coalesce(v.vs, '—'),
                 'vystaveno', coalesce(v.vystaveno, '—'),
                 'splatnost', coalesce(v.splatnost, '—'),
                 'dni',       coalesce(v.dni::text, '—'),
                 'celkem',    coalesce(v.celkem, '—'),
                 'zbyva',     coalesce(v.zbyva, '—'),
                 -- klíče DOSLOVNĚ (i18n brány je hledají ve zdroji), stav z invoice_state
                 'stav',      case v._stav
                                when 'storno'     then 'app.inv.state.storno'
                                when 'unknown'    then 'app.inv.state.unknown'
                                when 'paid'       then 'app.inv.state.paid'
                                when 'scheduled'  then 'app.inv.state.scheduled'
                                when 'correction' then 'app.inv.state.correction'
                                when 'overdue'    then 'app.inv.state.overdue'
                                else                   'app.inv.state.open'
                              end,
                 'poznamka',  coalesce(v.poznamka, ''))
               order by v._splatnost_dt desc nulls last)
        from vybrane v), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'li-source-registry',
      -- ČERSTVOST Z DAT (brána `cerstvost-z-dat`): nejnovější příchod verze dokladu
      -- (`created_at`) mezi fakturami TOHO odběratele — univerzum, ze kterého je tabulka
      -- (i „jen otevřené" je výběr z nich). Prázdno → `:no_data`, now() jen záloha.
      'freshness_at', to_char(coalesce((select max(vznik) from faktury), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'debtor-invoices'
                      || case when (select max(vznik) from faktury) is null then ':no_data' else '' end
    ) || public.scope_applied(p_params, 'owner_company')
  );
$$;

comment on function public.get_debtor_invoices(jsonb) is
  'Faktury jednoho odběratele — druhé patro prokliku z get_receivables_overdue. Páruje podle counterparty_id (IČO), jméno je záloha pro odběratele bez IČO. Opravné doklady se nefiltrují: v seznamu vysvětlují, proč je součet nižší. p_params.debtor je povinné, jinak prázdno.';

revoke all on function public.get_debtor_invoices(jsonb) from public, anon;
grant execute on function public.get_debtor_invoices(jsonb) to authenticated, service_role;
