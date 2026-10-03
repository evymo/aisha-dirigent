-- Timing tower — živé pořadí běhů.
--
-- ROZSAH (2026-08-05): řidič vidí SVÉ běhy, admin/staff VŠECHNY — a je to
-- jedno pravidlo pro obě publika, ne dvě plochy. Nárok se odvozuje ze tří
-- ramen shodných s `workflow_step_visible_to`: přiřazení · role · POTVRZENÁ
-- vazba účtu na twin (`ref_kind='account'`, `state='confirmed'`).
--
-- Historie, ať se to nevrátí: do 2026-08-03 tu stála podmínka podle členství
-- (blok nevracel nikomu nic, protože taková vazba v datech není), pak `where
-- true` jako VĚDOMĚ širší pravidlo. Obojí bylo měřitelně vadné — proč, viz
-- tři důvody u `where` níž.
-- SECURITY DEFINER zůstává kvůli čtení napříč tabulkami.
--
-- SEKTORY NEJSOU ZADRÁTOVANÉ. Chodí ze šablony procesu daného běhu
-- (get_batch_workflow_progress → steps: code/name/order/status), takže jiná
-- šablona = jiné sektory bez zásahu do kódu. Zadrátovat pět fází z makety by
-- znamenalo zapsat si do rendereru JEDEN proces jednoho zákazníka.
--
-- VLAJKA se odvozuje z OBECNÝCH polí (status kroků), ne z doménových stavů:
--   finish  — všechny kroky hotové (běh dojel)
--   red     — některý krok selhal (blokováno, eskalace)
--   box     — čeká na člověka (krok ve stavu awaiting/blocked → pit wall)
--   green   — jede po trati
-- `predani`/`nakladka` jsou slova RIQ; `completed`/`failed` jsou slova platformy.
-- Odvození drží na těch druhých, proto přežije jinou doménu.

create or replace function public.get_timing_tower_block(p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
SET search_path TO 'public', 'pg_temp'
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit int  := least(coalesce((p_params->>'limit')::int, 20), 100);
  -- Věž JEDNOHO procesu. Bez tohohle filtru kreslí sekce měřidel i dodávky a
  -- naopak — jedna deska pro nesouvisející práci není přehled, je to šum.
  -- NULL (klíč chybí) = všechny procesy, tedy původní chování.
  v_tpl   text := nullif(btrim(coalesce(p_params->>'template', '')), '');
  v_runs  jsonb;
begin
  -- Fail-closed parita s ostatními block RPC: bez identity prázdno, ne chyba.
  if v_uid is null and not is_service_role() then
    return jsonb_build_object(
      'data', jsonb_build_object('runs', '[]'::jsonb),
      'provenance', jsonb_build_object(
        'source_slug', 'production_workflow',
        'trace_id', 'wf:tower',
        'freshness_at', now()));
  end if;

  -- FILTR JE NAD SESTAVENÝM `run`, ne nad `p.prog` uvnitř. `cross join lateral`
  -- s voláním funkce se totiž vyhodnotí zvlášť pro `where` a zvlášť pro
  -- projekci, takže podmínka nad `p.prog->>'pos'` filtruje JINOU hodnotu, než
  -- se pak vydá. Naměřeno 2026-08-03: s filtrem uvnitř prošlo 20 běhů, a všech
  -- 20 mělo ve výstupu `pos` prázdné. Filtrovat se musí to, co se opravdu vydává.
  with scope as (
    -- NÁROK JAKO MNOŽINY, spočítané JEDNOU za dotaz (InitPlan). Doslovná kopie
    -- CTE z get_workflow_my_steps_block — a to ZÁMĚRNĚ: tamní hlavička nese
    -- dvě ZMĚŘENÉ slepé uličky (inlinovatelný predikát 97 s; sdílená množinová
    -- funkce 917 ms proti 36 ms) a končí pokynem „kdo bude nárok potřebovat
    -- v dalším bloku, ať zkopíruje CTE scope a NE ať staví množinovou funkci".
    -- Per-row workflow_step_visible_to je tu obzvlášť drahé: je SECURITY
    -- DEFINER (žádný inline) a nad 20 599 běhy by se volalo pro každý krok.
    select (select auth.uid()) as me,
           -- ⚠️ `is_admin_or_staff()` service_role NEPOKRÝVÁ — proto ta disjunkce.
           -- Kontrola nahoře (`v_uid is null and not is_service_role()`) servisního
           -- volajícího vědomě pouští dál a ten má `auth.uid()` prázdné; bez tohohle
           -- ramene by mu obě další ramena nároku nesedla na nic a věž by servisnímu
           -- čtení oslepla. Sousední get_batch_workflow_progress testuje obojí taky
           -- zvlášť (`is_service_role() or is_admin_or_staff(v_uid)`).
           (select public.is_admin_or_staff() or public.is_service_role()) as is_admin,
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
  -- `batch_id` na konci = rozhodčí shod (viz `order by … b.id` níž).
  select coalesce(jsonb_agg(run order by (run->>'pos')::numeric desc, run->>'entered_at', run->>'batch_id')
                    filter (where jsonb_typeof(run->'pos') = 'number'), '[]'::jsonb)
    into v_runs
  from (
    select jsonb_build_object(
      'batch_id',   b.id,
      'story_id',   b.story_id,
      'title',      ps.title,
      -- Vlastník = priorita běhu jako štítek; jméno člověka sem NEPATŘÍ
      -- (tower je veřejný v rámci pohledu, jméno je osobní údaj navíc).
      'priority',   coalesce(ps.priority, ''),
      'status',     ps.status,
      'state',      p.prog->>'state',
      'pos',        (p.prog->>'pos')::numeric,
      'total',      (p.prog->>'total')::int,
      'completed',  (p.prog->>'completed')::int,
      'failed',     (p.prog->>'failed')::int,
      -- Sektory = kroky šablony. Tower je vykreslí, kolik jich je.
      'sectors',    coalesce(p.prog->'steps', '[]'::jsonb),
      'flag',       case
                      when (p.prog->>'failed')::int > 0                              then 'red'
                      when (p.prog->>'completed')::int >= (p.prog->>'total')::int
                           and (p.prog->>'total')::int > 0                           then 'finish'
                      when exists (
                        select 1 from jsonb_array_elements(coalesce(p.prog->'steps','[]'::jsonb)) s
                        where s->>'status' in ('awaiting_approval','blocked','needs_review')
                      )                                                              then 'box'
                      else 'green'
                    end,
      -- Měření fází a brána (viz lateral `g` níž). `ent`/`gate` smějí být prázdné
      -- a je to poctivá odpověď: „neměřeno" a „na nikoho se nečeká".
      'ent',        g.ent,
      'done',       coalesce(g.done, '[]'::jsonb),
      'gate',       g.gate,
      -- Kdy běh vstoupil do současného stavu — tower z toho počítá „v sektoru".
      'entered_at', greatest(ps.last_activity_at, ps.updated_at),
      'updated_at', greatest(ps.last_activity_at, ps.updated_at)
    ) as run
    from production_batches b
    join partner_stories ps on ps.id = b.story_id
    cross join scope sc
    cross join lateral (select get_batch_workflow_progress(b.id) as prog) p
    -- ČAS VE FÁZI, ČASY HOTOVÝCH FÁZÍ A BRÁNA. Do 2026-08-05 se neposílalo nic
    -- z toho a StoryLoopMC kreslil statickou desku: `ent` chybělo, takže věž
    -- ukazovala '—' místo „stojí to tu 40 minut", a region `panel` (inženýr
    -- u brány) zůstával vypnutý, protože bez `gate` by byl prázdný.
    --
    -- Počítá se TADY, ne v producentovi kroků: délka běžící fáze závisí na tom,
    -- KDY se ptáš, takže uložená do projekce je v okamžiku doručení neplatná.
    cross join lateral (
      select
        -- ent = jak dlouho běh stojí v aktuální (první nedokončené) fázi.
        -- Krok bez `started_at` ho NEDOSTANE: komponenta pozná chybějící hodnotu
        -- (`entKnown`) a nakreslí '—', kdežto dosazená nula by tvrdila měření,
        -- které nikdo neprovedl.
        (select round(extract(epoch from now() - (s->>'started_at')::timestamptz))
           from jsonb_array_elements(coalesce(p.prog->'steps','[]'::jsonb)) s
          where s->>'status' not in ('completed','failed')
            and s->>'started_at' is not null
          order by (s->>'order')::int
          limit 1) as ent,
        -- done = délky fází V POŘADÍ FÁZÍ, aby indexy seděly na kotvy trati.
        -- Fáze bez obou časů dostane `null` a komponenta si na jejím místě vezme
        -- průměr (`avg`) — proto se pole NESMÍ zhustit jen na změřené kusy;
        -- posunulo by to všechny následující fáze o jednu.
        (select jsonb_agg(
                  case when s->>'started_at' is not null and s->>'completed_at' is not null
                       then round(extract(epoch from (s->>'completed_at')::timestamptz
                                                   - (s->>'started_at')::timestamptz))
                  end order by (s->>'order')::int)
           from jsonb_array_elements(coalesce(p.prog->'steps','[]'::jsonb)) s) as done,
        -- gate = krok, který čeká na ČLOVĚKA (pit wall). Tytéž stavy, ze kterých
        -- se odvozuje vlajka 'box' — jedno pravidlo, dvě podoby, takže věž nemůže
        -- svítit modře a v panelu tvrdit, že se na nic nečeká.
        (select jsonb_strip_nulls(jsonb_build_object(
                  'label', s->>'name',
                  'desc',  s->>'description',
                  'owner', s->>'assigned_role'))
           from jsonb_array_elements(coalesce(p.prog->'steps','[]'::jsonb)) s
          where s->>'status' in ('awaiting_approval','blocked','needs_review')
          order by (s->>'order')::int
          limit 1) as gate
    ) g
    -- ROZSAH: přihlášený vidí VŠE. Držet věž na členství znamenalo, že majitel
    -- firmy v ní neviděl nic — naměřeno 2026-08-03 na nasazeném extranetu:
    -- 20 599 běhů v `production_batches`, a blok hlásil „Aktivní: 0", protože
    -- k žádnému z nich nevede vazba `user_id` ani `story_participants`.
    -- Sousední blok téže sekce (get_workflow_progress_block, tentýž ovál) přitom
    -- žádný rozsah nemá — dvě neslučitelná pravidla vedle sebe. Sjednoceno na
    -- to širší; přihlášení zůstává podmínkou (viz kontrola v_uid výše).
    --
    -- ✅ 2026-08-05 — TEN „DALŠÍ KROK" JE TENHLE. Nárok je výslovný (CTE `scope`
    -- výše) a odpovídá tomu, co plocha slibuje: řidič své běhy, admin/staff
    -- všechny. Ramena jsou 1:1 s `workflow_step_visible_to`, která zůstává
    -- vlastníkem pravidla pro JEDNOTLIVÝ krok — tady je týž nárok množinově,
    -- přesně jak to předepisuje get_workflow_my_steps_block („kdo bude nárok
    -- potřebovat v dalším bloku, ať zkopíruje CTE scope“).
    --
    -- ⛔ TŘI DŮVODY, PROČ TO NESMÍ ZŮSTAT NA `where true`:
    --   1. Nárok tu fakticky DRŽEL AŽ TICHÝ VEDLEJŠÍ ÚČINEK: cizí běh spadl na
    --      `not visible` v get_batch_workflow_progress, tedy `pos = null`, a
    --      vypadl na filtru `jsonb_typeof(run->'pos') = 'number'`. Pravidlo,
    --      které drží filtr na JINÉ vlastnosti, je pravidlo, které první úprava
    --      toho filtru mlčky zruší.
    --   2. LIMIT SE APLIKOVAL PŘED NÁROKEM. Vybralo se 20 globálně nejnovějších
    --      běhů a teprve z nich se odfiltrovaly cizí — takže řidič, jehož
    --      dodávky mezi posledními dvaceti napříč firmou nejsou, viděl PRÁZDNOU
    --      věž, přestože běhy má. Nad 20 599 běhy je to pravidlo, ne okrajový
    --      případ. Filtr proto musí stát PŘED `limit`.
    --   3. Cizí běh se stejně načetl a spočítal (per-row SECURITY DEFINER
    --      volání progressu), jen se pak zahodil — práce navíc za data, která
    --      volající nesmí vidět.
    --
    -- BĚH BEZ SPOČÍTANÉHO POKROKU SE NEVYDÁVÁ. `get_batch_workflow_progress`
    -- je citlivá na autorizaci a místo pokroku umí vrátit
    -- `{"ok":false,"error":"not authenticated"}` — pak jsou `pos`, `total`,
    -- `completed` i `failed` prázdné. Maska bloku přitom `pos` vyžaduje jako
    -- číslo 0–1, takže takový řádek shodí kontrakt povrchu.
    --
    -- Naměřeno 2026-08-03 (transakce nad produkcí, rollback): pod syntetickou
    -- identitou vyšlo `"pos": null, "sectors": []`, pod skutečným uživatelem
    -- kompletní běh se třemi sektory. Dokud věž filtrovala podle členství, byla
    -- prázdná a tahle vada se nemohla projevit — odkryl ji až širší rozsah.
    --
    -- Doplnit nuly by znamenalo VYMYSLET si měření: zákon jazyka zní „žádné
    -- číslo bez zdroje". Běh, jehož pokrok neumíme spočítat, proto na věž
    -- nepatří — odfiltruje ho `filter (where …)` u agregace výše, nad hodnotou,
    -- která se skutečně vydává.
    --
    -- ⛔ `x OR EXISTS(korelovaný)` DÁVÁ PLANNERU LŽIVÝ ODHAD (naměřeno 2026-09-29).
    -- EXISTS pod OR se nedá převést na semi-join; planner z něj udělá
    -- AlternativeSubPlan (po řádcích / hashovaný). Za běhu vybere hashovaný, ale
    -- CENU počítá z první alternativy — costsize.c: „Arbitrarily use the first
    -- alternative plan for costing". Odhad tak zaplatil poddotaz za každý běh:
    -- 7,4 mil. jednotek u práce za ~170 ms, JIT se zapnul a kompiloval 1,3–1,5 s.
    -- Nekorelovaný `IN (select …)` je jediná (hashovaná) varianta a oceňuje se
    -- jednou. Rozsah se čte ze `scope` UVNITŘ poddotazu — odkaz na `sc` z vnějšího
    -- FROM by poddotaz zase zkoreloval. Ramena beze změny.
    where (v_tpl is null or b.workflow_template_id in (
            select tpl.id from production_workflow_templates tpl
            where tpl.name = v_tpl))
      and (sc.is_admin
       or b.id in (
            select s.batch_id
              from production_workflow_steps s
             cross join scope x
             where s.assigned_user_id = x.me
                or (s.assigned_role is not null and s.assigned_role = any(x.my_roles))
                or ((s.input_data->>'authorized_twin_id') = any(x.my_twins))
          ))
    -- ⛔ ŘAZENÍ MUSÍ BÝT ÚPLNÉ (naměřeno 2026-09-29): 126 běhů šablony „Odečet
    -- měřidla" má IDENTICKÉ `last_activity_at` (hromadný import 2026-09-01
    -- 01:22:11), takže `limit 30` bral libovolných 30 — výběr závisel na plánu a
    -- věž mezi voláními ukazovala jiné běhy. `b.id` jako rozhodčí to ustálí.
    order by greatest(ps.last_activity_at, ps.updated_at) desc, b.id
    limit v_limit
  ) t;

  return jsonb_build_object(
    'data', jsonb_build_object('runs', v_runs),
    'provenance', jsonb_build_object(
      'source_slug', 'production_workflow',
      'trace_id', 'wf:tower',
      'freshness_at', now()));
end;
$$;

REVOKE ALL ON FUNCTION public.get_timing_tower_block(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_timing_tower_block(jsonb) TO authenticated, service_role;
