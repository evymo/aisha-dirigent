-- ============================================================================
-- Source of Truth: knowledge_ragnarok_action
-- Popis: Rozhodne, co se má s položkou znalostí stát ve druhém indexu (Ragnarok)
--        po změně řádku. ČISTÁ funkce: na vstupu jen operace, starý a nový status,
--        starý a nový stav karantény a to, zda se změnil obsah. Nečte žádnou
--        tabulku — celou rozhodovací tabulku jde změřit bez spouště.
--
-- Ve druhém indexu smí být přesně to, co smí vrátit hledání: položka se statusem
-- 'active' A v čitelném stavu (public.knowledge_state_readable). Jeden predikát
-- pro všechny operace.
--
-- Do 2026-10-04 rozhodovala spoušť sama a jen podle obsahu a statusu:
--   - změna POUZE stavu karantény byla „nevýznamná“ → položka označená až po
--     nahrání v indexu zůstala;
--   - INSERT nahrál položku bez ohledu na stav;
--   - UPDATE konceptu (status ≠ active) poslal 'updated' = nahrát koncept;
--     „přeskoč neaktivní“ platilo jen pro INSERT.
--
-- Vrací akci události kb_ragnarok_sync, nebo NULL = nic neposílat:
--   'created'  nahrát — nový řádek, který v indexu být smí
--   'updated'  nahrát — změnil se obsah, nebo položka nově smí
--   'deleted'  stáhnout — řádek smazán, nebo už v indexu být nesmí (karanténa,
--              nezměřeno, koncept); řádek přitom může dál existovat
--   'archived' stáhnout — status přešel na archived
-- Slovník je záměrně ten, který zná postup synchronizace: nová hodnota by při
-- nasazení databáze dřív než postupu šla větví nahrání.
-- Nesmí → nesmí vrací NULL: v indexu nic být nemá, není co stahovat.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.knowledge_ragnarok_action(
  p_op text,
  p_old_status text,
  p_old_state text,
  p_new_status text,
  p_new_state text,
  p_content_changed boolean
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_op = 'DELETE' THEN 'deleted'
    WHEN p_op = 'INSERT' THEN CASE WHEN s.smi_nova THEN 'created' END
    WHEN p_op = 'UPDATE' THEN CASE
      WHEN s.smi_stara AND s.smi_nova THEN CASE WHEN p_content_changed THEN 'updated' END
      WHEN s.smi_stara THEN CASE WHEN p_new_status = 'archived' THEN 'archived' ELSE 'deleted' END
      WHEN s.smi_nova THEN 'updated'
      WHEN p_new_status = 'archived' AND p_old_status IS DISTINCT FROM 'archived' THEN 'archived'
    END
  END
  FROM (
    SELECT
      COALESCE(p_old_status = 'active' AND public.knowledge_state_readable(p_old_state), false) AS smi_stara,
      COALESCE(p_new_status = 'active' AND public.knowledge_state_readable(p_new_state), false) AS smi_nova
  ) s
$$;

-- Není to RPC: volá ji jen spoušť (běží právy vlastníka).
REVOKE ALL ON FUNCTION public.knowledge_ragnarok_action(text, text, text, text, text, boolean) FROM PUBLIC;
