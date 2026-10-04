-- Grants: partner_profiles_public
--
-- Veřejný adresář partnerů (filtr is_visible = true) — ČÍST smí kdokoli, ZAPISOVAT
-- nikdo z klientů. Pohled je jednoduchá projekce jedné tabulky, tedy AUTO-UPDATABLE,
-- a běží s právy vlastníka: UPDATE/DELETE skrz něj obchází RLS partner_profiles.
-- Do 2026-10-04 měl authenticated plné DML — kdokoli přihlášený přepsal web a popis
-- cizího viditelného partnera nebo ho smazal. REVOKE ALL napřed: na běžící DB žijí
-- i granty z ALTER DEFAULT PRIVILEGES.
REVOKE ALL ON public.partner_profiles_public FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.partner_profiles_public TO anon, authenticated, service_role;
