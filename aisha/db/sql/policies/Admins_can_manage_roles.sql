-- Policy: Admins can manage roles
-- Predikát v InitPlanu (2026-07-30): (SELECT has_role((SELECT auth.uid()),…)) nezávisí na řádku;
-- user_roles se čte z každého authz vyhodnocení, per-row tvar ji zdražoval.
-- Nárok beze změny; sesterská "Users can view their own roles" je korelovaná
-- (auth.uid() = user_id) a zůstává per-row správně.

DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
