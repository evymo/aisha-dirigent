-- Function: fn_protect_reserved_knowledge
--
-- Vyhrazené zdroje znalostí (source_type 'platform_knowledge' a 'instance_knowledge')
-- zapisuje JEN seed z repozitáře: platformní core seed (generovaný ze aisha/knowledge/)
-- a datová cesta instance (hook pod service_role). Zdrojem pravdy jsou soubory, ne DB.
--
-- PROČ TRIGGER, NE JEN POLITIKA: přímý zápis přihlášeného do knowledge_items dnes RLS
-- odmítá (tabulka nemá žádnou zápisovou politiku), ale definer RPC (např.
-- upsert_story_knowledge_item_audited, import_story_bundle) běží právy vlastníka a RLS
-- obcházejí — a source_type / source_slug berou od volajícího. Trigger platí pro
-- KAŽDOU cestu, včetně definer funkcí a budoucí zápisové politiky.
--
-- Relace API = požadavek přes PostgREST (nastavuje request.method — i pod service_role)
-- nebo relace koncového uživatele (role / claims anon či authenticated). Samotná přítomnost
-- JWT claims to NEROZLIŠÍ: seed se sám prohlašuje za service_role (seed/core/00_setup.sql),
-- aby prošly stráže RPC — naměřeno 2026-10-05, první verze triggeru tím shodila seed.
-- Relace API:
--   · nesmí vložit řádek s vyhrazeným source_type ani na něj existující řádek převést
--     (story-sync importuje balíček i pod service klíčem — balíček je nedůvěryhodný);
--   · nesmí vyhrazený řádek smazat;
--   · u vyhrazeného řádku smí měnit JEN sloupce z c_menitelne (počítadla použití
--     a hodnocení, karanténa a sken bezpečnosti, multimodální příznaky, časové razítko,
--     odvozený source_concept_id). Výčet je ALLOW-list: nový sloupec tabulky je
--     chráněný, dokud ho sem někdo vědomě nepřidá.
-- Relace mimo API (migrace, seed, datová cesta instance pod service_role) projdou beze
-- změny — to jsou jediní zapisovatelé vyhrazených zdrojů. Služba s přímým spojením do DB,
-- která bere source_type z nedůvěryhodného vstupu (ingest), narazí na odmítnutí uvnitř
-- upsert_story_knowledge_item_audited / import_story_bundle.
--
-- Výčet vyhrazených typů nese SQL na několika místech (tady, predikáty dvou indexů,
-- odmítnutí v import_story_bundle a upsert_story_knowledge_item_audited, dohledání v ní,
-- úklid duplicit v heals.sql) a generátor (scripts/db/gen-knowledge-seed.mjs,
-- VYHRAZENE_ZDROJE); brána knowledge-seed-from-sources drží všechna místa shodná.

CREATE OR REPLACE FUNCTION public.fn_protect_reserved_knowledge()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_menitelne CONSTANT text[] := ARRAY[
    'usage_count', 'rating_avg',
    'quarantine_status', 'quarantine_reason', 'quarantine_metadata', 'safety_scanned_at', 'safety_score',
    'has_multimodal', 'multimodal_provider',
    'updated_at', 'source_concept_id'
  ];
  v_jwt_role text;
  v_api boolean;
BEGIN
  v_jwt_role := COALESCE(nullif(current_setting('request.jwt.claim.role', true), ''),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  v_api := nullif(current_setting('request.method', true), '') IS NOT NULL
        OR COALESCE(v_jwt_role, '') IN ('anon', 'authenticated')
        OR COALESCE(current_setting('role', true), '') IN ('anon', 'authenticated');
  IF NOT v_api THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.source_type IN ('platform_knowledge', 'instance_knowledge') THEN
      RAISE EXCEPTION 'knowledge_items: položku vyhrazeného zdroje % smaže jen seed z repozitáře (item_id=%)',
        OLD.source_type, OLD.id USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.source_type IN ('platform_knowledge', 'instance_knowledge')
     AND (TG_OP = 'INSERT' OR OLD.source_type IS DISTINCT FROM NEW.source_type) THEN
    RAISE EXCEPTION 'knowledge_items: source_type % je vyhrazený seedu z repozitáře — relace API ho nezapíše',
      NEW.source_type USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.source_type IN ('platform_knowledge', 'instance_knowledge')
     AND (to_jsonb(OLD) - c_menitelne) IS DISTINCT FROM (to_jsonb(NEW) - c_menitelne) THEN
    RAISE EXCEPTION 'knowledge_items: obsah položky vyhrazeného zdroje % mění jen seed z repozitáře (item_id=%)',
      OLD.source_type, OLD.id USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$
;

REVOKE ALL ON FUNCTION public.fn_protect_reserved_knowledge() FROM PUBLIC;
