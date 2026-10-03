-- ============================================================================
-- Source of Truth: resolve_entity_reference
-- Popis: PŘESNÝ KLÍČ → ENTITA. „12345" → tenhle dodák. Nic víc a hlavně nic
--        chytřejšího: shoda je EXAKTNÍ, takže odpověď je buď jistá, nebo žádná.
--
-- PROČ VZNIKLA (2026-08-05, zadání majitele):
--   „Dohledat to přes dotaz AIŠE, která by nás na ten list měla nasměrovat…
--    a dodáky jí samozřejmě chceme dát taky, vše." + „multi twinverse".
--
--   Odpovídač si dodnes rozřazuje otázku REGEXEM nad kmeny a dodák mezi jeho
--   záměry vůbec není. Přidat tam další regex by bylo stavění na tom, co už
--   jednou selhalo (odpovídač vrátil na „kolik je hodin?" přehled nájemců
--   s pokrytím FULL). Číslo dokladu ale NENÍ úloha pro model — je to KLÍČ.
--   Proto tahle funkce: hledá SHODU, nehádá záměr. Když nenajde, mlčí.
--
-- ⭐ KLÍČE JSOU DATA, NE KÓD (a proto to nese celý twinverse)
--   Které pole je identita, se čte z `twin_parameter_definitions`
--   (`metadata->>'identity' = 'true'`) — tedy z KATALOGU, který instance plní
--   svými parametry. V téhle funkci proto nestojí ani jedno instanční slovo:
--   žádné 'dl_number', žádné 'cislo_om'. Nový druh entity s vlastní identitou
--   = ŘÁDEK v katalogu, ne větev tady a ne release. (Hlídá to i split-rule
--   brána: generické kanály nesmí jmenovat instanci.)
--
-- ⛔ NEJEDNOZNAČNOST = ŽÁDNÝ VÝSLEDEK.
--   Když týž klíč sedí na víc záznamů, funkce nevrátí NIC a řekne proč. Vybrat
--   „ten první" by znamenalo poslat člověka na doklad, který si nevybral —
--   a on by to nepoznal, protože by dostal platně vypadající obrazovku.
--   (Čísla dokladů se přes firmy opakují; naměřeno 804 kolizí.)
--
-- ⚠️ NÁROK SE NEOBCHÁZÍ. Krok se vrátí jen tomu, kdo na něj dosáhne —
--   rozhoduje TÝŽ sdílený predikát a týmž způsobem jako všude jinde: rozsah
--   'dispatch' se předává bezpodmínečně a povoluje ho predikát, ne tahle
--   funkce. Bez toho by z resolveru bylo orákulum na cizí doklady: „existuje
--   dodák 12345?" by šlo zjistit i bez práva ho vidět.
--
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_entity_reference(p_key text)
 RETURNS TABLE(entity_kind text, entity_id uuid, label text, matched_by text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := nullif(btrim(coalesce(p_key, '')), '');
BEGIN
  IF v_uid IS NULL OR v_key IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH hits AS (
    -- Kandidáti: kroky, jejichž konfigurace nese IDENTITNÍ parametr s touhle
    -- hodnotou. Katalog říká, které kódy to jsou; funkce žádný nezná jménem.
    --
    -- `@>` (containment), ne `->> = `: sahá na GIN index nad input_data, kdežto
    -- extrakce klíče by znamenala průchod všemi kroky pro každý kód katalogu.
    -- Týž tvar používá `input_match` ve frontě.
    SELECT s.id AS step_id, d.code AS code, b.batch_code AS run_label
      FROM public.twin_parameter_definitions d
      JOIN public.production_workflow_steps s
        ON s.input_data @> jsonb_build_object(d.code, v_key)
      JOIN public.production_batches b ON b.id = s.batch_id
     WHERE d.metadata->>'identity' = 'true'
       -- Nárok: rozsah deklaruje volající, POVOLUJE ho predikát (viz hlavička).
       AND public.workflow_step_visible_to(
             v_uid, s.assigned_user_id, s.assigned_role, s.input_data, 'dispatch')
     -- Dva stačí: rozhoduje se JEDEN × VÍC NEŽ JEDEN, ne kolik přesně.
     LIMIT 2
  )
  SELECT 'workflow_step'::text, h.step_id, coalesce(h.run_label, v_key), h.code
    FROM hits h
   -- ⛔ Nejistota znamená ŽÁDNÝ výsledek, ne „ten první". Viz hlavička.
   WHERE (SELECT count(*) FROM hits) = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_entity_reference(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_entity_reference(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_entity_reference(text) TO service_role;
