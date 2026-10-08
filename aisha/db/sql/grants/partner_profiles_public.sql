-- Grants: partner_profiles_public
--
-- VĚDOMĚ VEŘEJNÁ PROJEKCE (výčet: src/tests/gates/pohledy-verejne-pro-cteni.json).
-- Veřejný adresář partnerů (filtr is_visible = true, bez kontaktních údajů) — ČÍST
-- smí kdokoli, ZAPISOVAT nikdo z klientů. Pohled je projekce jedné tabulky, tedy
-- AUTO-UPDATABLE, a běží s právy vlastníka: UPDATE/DELETE skrz něj obchází RLS
-- partner_profiles. Do 2026-10-06 měl authenticated plné DML (naměřeno na čisté DB
-- main 0f992f647) — kdokoli přihlášený mohl přepsat web a popis cizího viditelného
-- partnera nebo ho smazat. REVOKE napřed: na běžící DB žijí i granty z ALTER DEFAULT
-- PRIVILEGES. security_invoker tu být NESMÍ: anon by pak potřeboval SELECT na celé
-- partner_profiles (včetně kontaktů) — projekce s právy vlastníka je tu účel.
REVOKE ALL ON public.partner_profiles_public FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.partner_profiles_public TO anon, authenticated, service_role;
