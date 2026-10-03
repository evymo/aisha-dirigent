-- Function: is_story_partner

CREATE OR REPLACE FUNCTION public.is_story_partner(p_user_id uuid, p_story_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- ⛔ PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (2026-09-18, sesterská oprava has_role).
  -- Funkce má GRANT pro anon a pravdivě odpovídala komukoli na „je uživatel X
  -- partnerem příběhu Y?". Odpověď dostane jen ten, na koho se ptá, service_role
  -- a admin/staff; ostatním `false`. Jediný volající (RLS na story_participants)
  -- se ptá na `(SELECT auth.uid())`, takže první větev platí a RLS se nemění.
  -- Vnořený CASE, ne `OR`: u RLS se vyhodnotí jen levné porovnání, dotaz na roli
  -- (is_service_role/is_admin_or_staff) až tehdy, když se ptá někdo jiný.
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    WHEN p_user_id = auth.uid() THEN EXISTS (
      SELECT 1 FROM public.story_participants
      WHERE user_id = p_user_id AND story_id = p_story_id AND role = 'partner'
    )
    WHEN public.is_service_role() OR public.is_admin_or_staff() THEN EXISTS (
      SELECT 1 FROM public.story_participants
      WHERE user_id = p_user_id AND story_id = p_story_id AND role = 'partner'
    )
    ELSE false
  END;
$function$

;

REVOKE ALL ON FUNCTION is_story_partner(uuid,uuid) FROM PUBLIC;
-- ⚠️ ZÁMĚRNĚ BEZ GRANTU — a je to ZNÁMÁ ŽIVÁ VADA, ne stav, který by byl v pořádku.
--
-- Funkci volají dvě politiky na story_participants. Bez grantu spadne dotaz na
-- „permission denied for function". Grant sem ale nemůže padnout jen tak:
-- funkce bere uživatele PARAMETREM a uvnitř nemá vazbu na volajícího, takže by
-- kdokoli přihlášený mohl zjišťovat partnerství KOHOKOLI na kterékoli story.
-- security.gate to právem odmítá (SECURITY DEFINER bez auth checku).
--
-- Zkusil jsem doplnit vazbu `p_user_id IS DISTINCT FROM auth.uid() AND NOT
-- is_admin_or_staff() → false`; obě volající politiky předávají auth.uid(),
-- takže se chování nemění. Analyzátor to ale neuznal a nedopátral jsem se
-- proč — neověřenou změnu bezpečnostního pravidla nenasazuji.
--
-- Otevřené (viz PR): buď dořešit vazbu tak, aby ji analyzátor uznal, nebo
-- politiky přepsat na jiný pomocník. Do rozhodnutí zůstává bez grantu.
-- ⛔ REVOKE bez následného GRANTu: funkci volá RLS politika, ale spustit ji
-- nesměl NIKDO — ani service_role. Každý dotaz na dotčenou tabulku spadl na
-- „permission denied for function". SECURITY DEFINER, boolean, NULL-bezpečná.
GRANT EXECUTE ON FUNCTION is_story_partner(uuid,uuid) TO anon;
GRANT EXECUTE ON FUNCTION is_story_partner(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_story_partner(uuid,uuid) TO service_role;
