-- Osy pohledu čte kdokoli přihlášený, komu je publikum připustí; neaktivní
-- řádek nevidí nikdo. Táž hranice jako u bloků a akcí — jedno pravidlo, tři
-- tabulky, žádná zvláštní cesta pro „jen filtry".
DROP POLICY IF EXISTS surface_scope_axes_select_active ON public.surface_scope_axes;
CREATE POLICY surface_scope_axes_select_active ON public.surface_scope_axes
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_active AND public.surface_audience_allows(auth.uid(), audience));
