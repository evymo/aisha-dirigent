-- Policy: authenticated čte jen aktivní umístění, a jen ta, na která podle
-- deklarace `audience` má nárok. (Splacené TODO(Sprint 3.7).)
--
-- Brána MUSÍ jít AND do TÉHLE policy, ne vedle ní: permissive policies se
-- OR-ují, takže druhá policy s bránou by přístup nezúžila ani o řádek.
--
-- surface_audience_allows je JEDINÝ interpret deklarace (ungated `{}` propouští,
-- neznámý klíč DENY, admin/staff bypass). Čtenáři layoutu se proto nemění ani
-- o řádek: get_surface_layout i list_surface_sections jsou SECURITY INVOKER,
-- takže sekce i jejich obsah dědí tuhle podmínku samy.
--
-- POZOR na 1-arg audience_user_meets_tier_requirement(text): nemá NULL guard a
-- na NULL požadavek vrací SQL NULL, což je v USING DENY. Volat ji tady by
-- tichým prázdnem odřízlo VŠECHNY včetně adminů. Proto výhradně wrapper.

DROP POLICY IF EXISTS surface_layouts_select_active ON public.surface_layouts;
CREATE POLICY surface_layouts_select_active ON public.surface_layouts
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND public.surface_audience_allows(auth.uid(), audience)
  );
