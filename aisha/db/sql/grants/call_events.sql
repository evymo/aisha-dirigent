-- Grants: call_events

-- anon NIC (audit vydání 2026-10-01, B2): tabulka má RLS „Service role only“, takže
-- grant anonymovi nevracel žádný řádek — jen zbytečně rozšiřoval povrch. Odebírá se
-- výslovně: smazaný GRANT by na běžící DB nic neodebral.
REVOKE ALL ON public.call_events FROM anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.call_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.call_events TO service_role;
