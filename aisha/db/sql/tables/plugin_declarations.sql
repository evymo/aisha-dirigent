-- Table: plugin_declarations
-- RLS: ENABLED
--
-- Poslední „zapálení" pluginu pro tenanta: běh v režimu jen-deklaruj (init bez
-- stahování), jehož výsledkem jsou rozvrhy v plugin_schedules.
--
-- ⛔ PROČ TO EXISTUJE. Naměřeno 2026-09-24 v produkci RIQ: plugin_schedules = 0,
-- žádný plugin nikdy neběžel. Rozvrhy se zapisovaly jen PO úspěšném běhu
-- (init → ctx.schedule → reconcile), ale první běh nespouštělo nic. Host teď
-- zapálí každý schválený plugin aktivního zdroje; tahle tabulka říká, KDY a
-- s JAKOU verzí se to naposledy povedlo (nová verze = nové zapálení) a jestli
-- ne, proč — aby selhání nebylo ticho a opakování nebylo smyčka.
CREATE TABLE IF NOT EXISTS public.plugin_declarations (
  plugin_id      uuid NOT NULL REFERENCES public.plugin_catalog(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL,
  plugin_version text NOT NULL,
  status         text NOT NULL CHECK (status IN ('ok', 'failed')),
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  declared_at    timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (plugin_id, tenant_id)
);

ALTER TABLE public.plugin_declarations ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.plugin_declarations IS
  'Last schedule ignition (declare-only run: init without sync) per plugin and tenant — version, outcome, detail. Written by svc-plugin-system via record_plugin_declaration; read by admins.';
