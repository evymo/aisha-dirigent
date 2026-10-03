-- ============================================================================
-- Source of Truth: get_my_workflow_steps
-- Popis: Terénní čtení milníků pro mobilní appku (přiřazení · role · twin vazba);
--        admin/staff vidí PROVOZ, ne jen své. RLS tabulky je admin-only.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
--
-- ⛔ NAMĚŘENO 2026-08-31 na produkci: 140 275 ms, aby vrátila NULA řádků.
--    Obrazovka „Moje dodávky" se proto nikdy nenačetla — uživatel viděl
--    „Načítání…" a pak chybu, a každý `reload` přidal další zaseknutý dotaz.
--
--    Dvě příčiny, obě odstraněné:
--
--    1) PER-ROW ORÁKULUM. `workflow_step_visible_to` je SECURITY DEFINER, takže
--       se NEINLINUJE a volalo se pro každý ze 122 652 kroků; každé volání
--       sáhlo na role i twin vazby. Bloková varianta
--       `get_workflow_my_steps_block` tuhle vadu odstranila už 2026-07-30
--       (33 325 ms → 36 ms) přepisem na CTE `scope` — InitPlan, jednou za
--       dotaz. Mobilní funkce tu opravu NIKDY NEDOSTALA a s růstem dat
--       spadla na 140 s. Nárok je TENTÝŽ, jen množinově; oracle zůstává
--       vlastníkem pravidla pro JEDEN krok (potvrzovací RPC).
--
--    2) ŽÁDNÉ OKNO A ŽÁDNÝ LIMIT. Pro admina je nárok univerzální, takže se
--       řadilo přes všech 122 652 kroků. „Vidím vše" ale neznamená „přečti
--       vše pokaždé" — na telefonu už vůbec ne. Rozsah se proto omezuje
--       oknem a stropem, obojí PARAMETREM s bezpečnou mezí.
--
-- ⭐ ADMIN VIDÍ PROVOZ. Do 2026-08-31 vracela funkce správci NULU: neměl
--    přiřazený krok a dispečerská větev tu — na rozdíl od blokové varianty —
--    nebyla. Rozšíření dělá `scope.is_admin` V PREDIKÁTU, ne parametr, takže
--    si ho volající nemůže vynutit.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_my_workflow_steps(
  p_status text DEFAULT NULL::text,
  p_days integer DEFAULT 30,
  p_limit integer DEFAULT 200,
  p_include_closed boolean DEFAULT false
)
 RETURNS TABLE(step_id uuid, step_code text, step_name text, step_order integer, status text, batch_id uuid, batch_code text, product_name text, assigned_role text, description text, input_data jsonb, output_data jsonb, completed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with cfg as (
    -- Meze jsou tvrdé: parametr smí rozsah ZÚŽIT, ne otevřít dokořán.
    select least(greatest(coalesce(p_days, 30), 1), 3650)   as dnu,
           least(greatest(coalesce(p_limit, 200), 1), 1000) as lim
  ),
  scope as (
    -- InitPlan: vyhodnotí se JEDNOU za dotaz, ne pro každý řádek. Tvar je
    -- doslova převzatý z get_workflow_my_steps_block, kde byla rovnocennost
    -- s per-row orákulem doložena md5 shodou množin.
    select (select auth.uid())                      as me,
           (select public.is_admin_or_staff())      as is_admin,
           coalesce((select array_agg(ur.role::text)
                     from public.user_roles ur
                     where ur.user_id = (select auth.uid())), '{}'::text[]) as my_roles,
           coalesce((select array_agg(r.twin_id::text)
                     from public.twin_external_refs r
                     where r.ref_kind = 'account'
                       and r.source_key = (select auth.uid())::text
                       and r.state = 'confirmed' and r.valid_from <= now()
                       and (r.valid_to is null or r.valid_to > now())), '{}'::text[]) as my_twins
  )
  select s.id, s.step_code, s.step_name, s.step_order, s.status,
         b.id, b.batch_code, b.product_name,
         s.assigned_role, s.description, s.input_data, s.output_data,
         s.completed_at
  from production_workflow_steps s
  join production_batches b on b.id = s.batch_id
  cross join cfg cross join scope
  where scope.me is not null
    and (scope.is_admin
         or s.assigned_user_id = scope.me
         or (s.assigned_role is not null and s.assigned_role = any(scope.my_roles))
         or ((s.input_data->>'authorized_twin_id') = any(scope.my_twins)))
    and (p_status is null or s.status = p_status)
    -- ⭐ JEN OTEVŘENÉ. Naměřeno 2026-08-31: ze 40 863 „pending" kroků předání
    -- jich má doklad `settled=True` 20 070 (v účetnictví UZAVŘENÉ, proces to
    -- nevěděl) a 20 271 nemá stav vůbec (duplicity ze starší generace
    -- ingestu). SKUTEČNĚ otevřených je 522. „Neuzavřené" tedy z 98 % lhalo.
    --
    -- Filtr je tu, ne v konfiguraci bloku: mobil je TERÉNNÍ nástroj a zavřená
    -- práce do něj nepatří. Web smí i zavřené a nepřiřazené — je to týž
    -- výřez téhož, ne jiná data (`p_include_closed`).
    and (p_include_closed
         or coalesce(s.input_data->>'settled', 'False') = 'False')
    -- Okno: bez něj se pro admina řadilo přes všech 122 652 kroků. `nulls last`
    -- v řazení níž je záměr — dávka bez data se má ukázat, ne zmizet; do okna
    -- ji pouštíme, protože chybějící datum není důvod k neviditelnosti.
    and (b.production_date is null or b.production_date >= current_date - cfg.dnu)
  -- NEJNOVĚJŠÍ PRVNÍ. Bloková varianta řadí vzestupně (fronta řidiče: nejstarší
  -- napřed), tady jde o přehled provozu, kde je čerstvé to podstatné.
  order by b.production_date desc nulls last, b.created_at desc, s.step_order
  limit (select lim from cfg);
$function$;

REVOKE ALL ON FUNCTION public.get_my_workflow_steps(text, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_workflow_steps(text, integer, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_workflow_steps(text, integer, integer, boolean) TO service_role;
