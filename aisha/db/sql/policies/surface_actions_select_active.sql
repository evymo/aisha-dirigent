-- Policy: surface_actions_select_active
-- Přihlášený vidí jen AKTIVNÍ akce, které mu publikum akce přiznává
-- (surface_audience_allows — tentýž interpret jako u umístění bloků). Tím je
-- seznam akcí v bloku i submit (SECURITY INVOKER) filtrovaný RLS: neviditelná
-- akce = neexistující akce, ne „zakázaná" (nic se neprozrazuje).
DROP POLICY IF EXISTS surface_actions_select_active ON public.surface_actions;
CREATE POLICY surface_actions_select_active ON public.surface_actions
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND public.surface_audience_allows(auth.uid(), audience)
  );
