-- ============================================================================
-- Source of Truth: surface_presence_ok
-- Popis: Vyhodnotí SONDU DAT sekce (surface_sections.presence) pro volajícího:
--        má v sekci pro něj něco být? list_surface_sections podle ní skryje
--        běžnému uživateli sekci, ve které nic nemá (rozhodnutí majitele
--        2026-09-28: „není potřeba, aby danou sekci viděl, byť do ní má přístup").
--
-- Druhy sondy (uzavřený seznam, jako osy publika):
--   {"doklady": ["contract", "invoice"]} — existuje aspoň jeden PLATNÝ doklad
--       těch typů, který volající vidí (SECURITY INVOKER → rozhoduje RLS
--       li_source_registry_read, tedy i nárok z vazeb).
--
-- ⛔ Sonda NENÍ hranice přístupu (tu drží publikum a RLS). Neznámý druh nebo
--   chybný tvar proto sekci NESKRYJE — vrátí true a zapíše WARNING do logu DB;
--   tichá chyba by jinak vypadala jako „nemáte data".
-- ============================================================================

CREATE OR REPLACE FUNCTION public.surface_presence_ok(p_presence jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_typy text[];
BEGIN
  IF p_presence IS NULL OR p_presence = '{}'::jsonb THEN
    RETURN true;
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_presence)) <> 1
     OR NOT (p_presence ? 'doklady')
     OR jsonb_typeof(p_presence->'doklady') <> 'array' THEN
    RAISE WARNING 'surface_presence_ok: neznámá sonda %, sekce se neskrývá', p_presence;
    RETURN true;
  END IF;
  v_typy := ARRAY(SELECT jsonb_array_elements_text(p_presence->'doklady'));
  RETURN EXISTS (
    SELECT 1 FROM public.li_source_registry d
     WHERE d.superseded_by IS NULL AND d.doc_type = ANY (v_typy)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.surface_presence_ok(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.surface_presence_ok(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.surface_presence_ok(jsonb) IS
  'Sonda dat sekce pro volajícího (INVOKER, pod RLS): {"doklady":[typy]} = vidí aspoň jeden platný doklad těch typů. Není hranice přístupu; neznámá sonda sekci neskryje.';
