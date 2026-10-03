-- View: public.public_service_health
--
-- VEŘEJNÁ PROJEKCE provozního stavu služeb. Existuje proto, aby funkce, kterou
-- smí volat anonym, neměla na dosah nic, co by mohlo uniknout.
--
-- PROČ POHLED A NE FILTR V DOTAZU
-- `integration_services` drží vedle stavu i `api_token`, `base_url` a `config`.
-- Dokud veřejná funkce četla přímo tuhle tabulku, byla bezpečná jen tím, JAK
-- byl napsaný její SELECT — tedy do první úpravy. Brána `security.gate` to
-- 2026-08-02 odmítla („NEW sensitive data functions with anon grant") a měla
-- pravdu: veřejná cesta nemá mít tajemství v dosahu, ne je jen nečíst.
--
-- Tajemství tu proto nejsou FYZICKY. Rozšíření zdrojové tabulky o další
-- citlivý sloupec tuhle projekci nerozšíří — musel by ho sem někdo dopsat
-- ručně, a to je viditelná změna v review, ne tichý důsledek.
--
-- CO NESE: jméno služby, stav, příznak aktivity, čas poslední kontroly.
-- CO NENESE: `api_token`, `base_url`, `config`, `service_type`, interní id.

CREATE OR REPLACE VIEW public.public_service_health AS
SELECT
  service_name,
  health_status,
  is_active,
  last_health_check
FROM public.integration_services;

COMMENT ON VIEW public.public_service_health IS
  'Veřejná projekce integration_services: jen stav a čas kontroly. Bez api_token, base_url a config — veřejná RPC čte tenhle pohled, ne zdrojovou tabulku.';

-- Pohled sám se anonovi NEUDĚLUJE: čte ho SECURITY DEFINER funkce
-- get_public_service_status() jménem vlastníka. Anon má jen EXECUTE na tu
-- funkci, takže ven jde agregát, ne řádky se jmény služeb.
REVOKE ALL ON public.public_service_health FROM PUBLIC;
GRANT SELECT ON public.public_service_health TO authenticated;
GRANT SELECT ON public.public_service_health TO service_role;
