-- ============================================================================
-- Source of Truth: twin_graph_descendants
-- Popis: Vše POD uzlem twinsverse K DATU — rekurzivní sjezd po hranách
--        s platností. Základ pro agregace po větvích (jednotka vs nadřazený
--        celek) a pro derive_audience (publikum / auditorium / elektorát).
--
--        Směr: hrana se čte „source —kind→ target"; „pod uzlem X" jsou
--        entity, jejichž řetěz hran VEDE DO X (WHERE target = X, sbírají se
--        sources). Dotaz na JEDEN uzel tak vrací JEHO podstrom — ne agregát
--        celku, do kterého uzel patří (přesně vada bloku E).
--
--        p_at: hrana platí, když valid_from <= p_at < COALESCE(valid_to, ∞).
--        Tentýž dotaz s jiným datem = jiná množina — to je vlastnost, ne bug.
--
-- Bezpečnost: SECURITY INVOKER ZÁMĚRNĚ — viditelnost hran řeší RLS
--        (twin_relations_read), tahle funkce ji DĚDÍ a nesmí ji obcházet.
--        Definer varianta by četla hrany, na které volající nemá nárok.
--
-- Ochrana proti cyklu: cesta se nese v poli a uzel se podruhé nevstupuje;
--        p_max_depth je pojistka proti degenerovaným grafům, a když se
--        ZAŘÍZNE O LIMIT, funkce to ŘEKNE (truncated) — tichý ořez by
--        vypadal jako úplná odpověď (zákon: žádné tiché stropy).
--
-- ⭐ JEDEN ŘÁDEK NA UZEL (DISTINCT ON) — naměřeno testem 31 při zavádění:
--        surová rekurze vrací uzel TOLIKRÁT, KOLIKA CESTAMI je dosažitelný.
--        Na fixtuře se dvěma druhy hran mezi touž dvojicí vyšlo 4 řádky na
--        2 uzly. Agregace „vše pod uzlem" by tím DVAKRÁT ZAPOČÍTALA týž
--        podřízený celek — přesně ta třída chyby, kvůli které tahle funkce
--        vzniká (blok E: dotaz na jednotku vrací agregát). Vrací se proto
--        NEJKRATŠÍ cesta k uzlu; kdo potřebuje všechny cesty, ptá se hran.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_graph_descendants(
  p_root_twin_id uuid,
  p_kinds        text[]      DEFAULT NULL,   -- NULL = všechny druhy vztahů
  p_at           timestamptz DEFAULT now(),
  p_max_depth    integer     DEFAULT 32
)
RETURNS TABLE (twin_id uuid, depth integer, via_kind text, truncated boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH RECURSIVE walk AS (
    SELECT r.source_twin_id AS twin_id,
           1                AS depth,
           r.relation_kind  AS via_kind,
           ARRAY[p_root_twin_id, r.source_twin_id] AS path
      FROM public.twin_relations r
     WHERE r.target_twin_id = p_root_twin_id
       AND (p_kinds IS NULL OR r.relation_kind = ANY (p_kinds))
       AND r.valid_from <= p_at
       AND (r.valid_to IS NULL OR r.valid_to > p_at)

    UNION ALL

    SELECT r.source_twin_id,
           w.depth + 1,
           r.relation_kind,
           w.path || r.source_twin_id
      FROM walk w
      JOIN public.twin_relations r ON r.target_twin_id = w.twin_id
     WHERE w.depth < p_max_depth
       AND NOT r.source_twin_id = ANY (w.path)   -- cyklus se nevstupuje podruhé
       AND (p_kinds IS NULL OR r.relation_kind = ANY (p_kinds))
       AND r.valid_from <= p_at
       AND (r.valid_to IS NULL OR r.valid_to > p_at)
  )
  -- Jeden řádek na uzel: nejkratší cesta vyhrává; při shodné hloubce rozhoduje
  -- druh vztahu abecedně, aby dva běhy nad týmiž daty daly TÝŽ výsledek
  -- (nedeterministický artefakt by se v agregacích projevil jako šum).
  SELECT DISTINCT ON (w.twin_id)
         w.twin_id,
         w.depth,
         w.via_kind,
         w.depth >= p_max_depth AS truncated
    FROM walk w
   ORDER BY w.twin_id, w.depth, w.via_kind;
$function$;

REVOKE ALL ON FUNCTION public.twin_graph_descendants(uuid, text[], timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_graph_descendants(uuid, text[], timestamptz, integer) TO authenticated, service_role;
