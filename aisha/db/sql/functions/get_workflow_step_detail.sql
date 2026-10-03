-- ============================================================================
-- Source of Truth: get_workflow_step_detail
-- Popis: JEDEN milník procesu podle id — čtení pro obrazovku, která ho odbavuje.
--        Terénní fronta (`get_my_workflow_steps`) je z principu OSOBNÍ a řadí
--        se podle termínu; tohle je opačná otázka: „ukaž mi TENHLE krok".
--
-- PROČ VZNIKLA (2026-08-05, zadání majitele):
--   „Chci si jako admin vybrat dodák a vidět ho tak, jak to je v reálu — jaký
--    má stav a čí je. A platí to úplně plošně."
--   Dispečerská fronta (blok `all_assignees`) cizí předání UKAZOVALA, ale
--   otevřít je nešlo: potvrzovací obrazovka appky čte `get_my_workflow_steps`,
--   která vrací jen vlastní kroky. Admin tedy viděl seznam a neměl jak do něj
--   vstoupit. Chybějící článek nebyl nárok (ten už existoval), ale ČTENÍ
--   JEDNOHO KROKU s dispečerským rozsahem.
--
-- ⭐ ROZSAH ROZHODUJE PREDIKÁT, NE TAHLE FUNKCE
--   Volá se `workflow_step_visible_to(..., 'dispatch')` BEZPODMÍNEČNĚ: tahle
--   funkce jen říká, CO chce vidět, a predikát rozhodne, kdo to smí. Kdo není
--   admin/staff, projde běžnými rameny (přiřazení · role · potvrzená twin
--   vazba) a cizí krok nedostane. Žádná role-logika tady tedy není a být nesmí
--   (brána workflow-visibility-single-decider), jinak by šla smazat jedním
--   řádkem v obyčejné čtecí funkci.
--
-- ⭐ REALITA, NE PŘEVTĚLENÍ
--   Admin NEVIDÍ krok „jako řidič" v tom smyslu, že by se za něj vydával —
--   vidí ho takový, jaký je, VČETNĚ toho, komu patří (`assigned_to`,
--   `assigned_twin`) a jak dopadl (`status`, `has_deviation`, `completed_by_name`).
--   `is_mine` říká, jestli by na krok dosáhl i BEZ dispečerského rozsahu, takže
--   klient umí čestně napsat „potvrzujete za někoho jiného". Zápis pak stejně
--   nese pravdu: `complete_workflow_step` ukládá `completed_by = auth.uid()`,
--   tedy toho, kdo doopravdy klikl. Kdyby se identita v pohledu podvrhla,
--   evidence by tvrdila něco jiného než audit.
--
-- ⚠️ JMÉNA ÚČTŮ jen tomu, kdo dispečuje (nebo o sobě). `profiles.display_name`
--   je osobní údaj; kolega, který krok vidí přes SDÍLENOU ROLI, dostane label
--   twinu (ten je i v konfiguraci fronty jako `input:driver_name`), ale ne
--   identitu účtu. Je to podmínka NAD SLOUPCEM, ne ve výběru řádků — řádek už
--   je autorizovaný výše.
--
-- ⚠️ Neexistující krok a krok BEZ NÁROKU vracejí obojí PRÁZDNO, ne chybu.
--   Rozlišit je by z funkce udělalo orákulum na existenci cizích běhů.
--
-- Výkon: čte JEDEN řádek podle primárního klíče, takže per-row cena predikátu
-- (SECURITY DEFINER = žádný inline) tu nehraje roli. Množinová varianta téhož
-- nároku patří do bloků — viz CTE `scope` v get_workflow_my_steps_block.
--
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_workflow_step_detail(p_step_id uuid)
 RETURNS TABLE(
   step_id uuid, step_code text, step_name text, step_order integer, status text,
   batch_id uuid, batch_code text, product_name text, production_date date,
   assigned_role text, description text, input_data jsonb, output_data jsonb,
   started_at timestamp with time zone, completed_at timestamp with time zone,
   has_deviation boolean, notes text,
   assigned_to text, assigned_twin text, completed_by_name text, is_mine boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_s      public.production_workflow_steps%rowtype;
  v_b      public.production_batches%rowtype;
  v_mine   boolean;
  v_named  boolean;
  -- Účet zařízení (tablet, F2): dostane jen PROJEKCI kroku — viz níž.
  v_zarizeni boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_s FROM public.production_workflow_steps s WHERE s.id = p_step_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Rozsah deklaruje volající, POVOLUJE ho predikát. Viz hlavička.
  -- Kód kroku z ŘÁDKU: bez něj pátá cesta predikátu (tablet) neplatí (F2, 2026-09-29).
  IF NOT public.workflow_step_visible_to(
           v_uid, v_s.assigned_user_id, v_s.assigned_role, v_s.input_data, 'dispatch', v_s.step_code) THEN
    RETURN;
  END IF;

  -- Týž predikát BEZ rozsahu = „dosáhl bych na to i jako řadový uživatel?".
  -- Odpověď je to, co klient napíše člověku na obrazovku, ne kosmetika.
  v_mine := public.workflow_step_visible_to(
              v_uid, v_s.assigned_user_id, v_s.assigned_role, v_s.input_data, NULL, v_s.step_code);

  -- ⛔ TABLET DOSTANE JEN PROJEKCI (F2-C, majitel 2026-09-29: osobní údaje odběratele
  -- na tablet NEJDOU). input_data jen přes kiosk_projekce (`pole` rozsahu instance);
  -- output_data (přebírající, podpis z dřívějšího potvrzení), poznámka, název běhu
  -- (subject_label = „{odběratel} — {DL}“) a štítek dvojčete se účtu zařízení nevydají.
  -- Příznak nese SERVER (vazba průkazu), ne klient ani metadata účtu.
  v_zarizeni := EXISTS (SELECT 1 FROM public.knock_device_credentials d WHERE d.ucet_id = v_uid);

  SELECT * INTO v_b FROM public.production_batches b WHERE b.id = v_s.batch_id;

  -- Identitu ÚČTU vydáváme jen dispečerovi; člověk o sobě ji dostane vždycky
  -- (podmínka u sloupce níž). Viz hlavička.
  --
  -- ⛔ `v_mine` tu ZÁMĚRNĚ NENÍ, i když se to nabízí. Predikát vrací true i pro
  --    viditelnost přes SDÍLENOU ROLI — na krok tedy dosáhne celá směna, a jméno
  --    kolegy, kterému je přiřazený, jim do fronty nepatří. Změřeno sondou
  --    workflow-step-detail (případ „kolega vidí krok, ale ne jméno").
  v_named := public.is_admin_or_staff();

  RETURN QUERY
  SELECT
    v_s.id, v_s.step_code, v_s.step_name, v_s.step_order, v_s.status,
    v_s.batch_id, v_b.batch_code,
    CASE WHEN v_zarizeni THEN NULL ELSE v_b.product_name END,
    v_b.production_date,
    v_s.assigned_role, v_s.description,
    CASE WHEN v_zarizeni THEN public.kiosk_projekce(v_s.step_code, v_s.input_data) ELSE v_s.input_data END,
    CASE WHEN v_zarizeni THEN NULL ELSE v_s.output_data END,
    v_s.started_at, v_s.completed_at, v_s.has_deviation,
    CASE WHEN v_zarizeni THEN NULL ELSE v_s.notes END,
    CASE WHEN v_s.assigned_user_id IS NOT NULL
              AND (v_named OR v_s.assigned_user_id = v_uid)
         THEN (SELECT p.display_name FROM public.profiles p
                WHERE p.user_id = v_s.assigned_user_id LIMIT 1) END,
    -- Twin, na který je uzel vázaný (u dodáku řidič). Label, ne id: id je klíč,
    -- jméno je to, co dispečer čte.
    -- ⚠️ Tvar se OVĚŘUJE před přetypováním. `input_data` je konfigurace uzlu, tedy
    -- DATA instance — nečíselné id by tu jinak neshodilo jedno jméno, ale celé
    -- čtení kroku, a obrazovka by hlásila „nenalezeno" místo „vazba je pokažená".
    CASE WHEN NOT v_zarizeni AND v_s.input_data->>'authorized_twin_id'
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         THEN (SELECT te.label FROM public.twin_entities te
                WHERE te.id = (v_s.input_data->>'authorized_twin_id')::uuid) END,
    CASE WHEN v_s.completed_by IS NOT NULL
              AND (v_named OR v_s.completed_by = v_uid)
         THEN (SELECT p.display_name FROM public.profiles p
                WHERE p.user_id = v_s.completed_by LIMIT 1) END,
    v_mine;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_workflow_step_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workflow_step_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workflow_step_detail(uuid) TO service_role;
