-- ============================================================================
-- web_tracking_registry — declarative catalog of web analytics/tracking
-- integrations.
--
-- The materialization target for plugin_catalog kind='web_tracking' (declared
-- since the plugin control plane, previously loaderless — see expert_rule
-- declared-extension-must-reach-the-resolver, measured 2026-07-26).
--
-- A row DECLARES a tracker; the consumer is the web surface: it reads
-- get_active_web_tracking() at boot and injects only entries whose
-- consent_category the visitor has granted — tracking is therefore
-- consent-gated by construction, and a tracker with no granted consent is
-- simply never loaded. No secrets here; site keys that are genuinely secret
-- belong in env and are resolved server-side.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.web_tracking_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,

  -- Which loader template the web surface uses.
  provider text NOT NULL CHECK (provider IN ('matomo', 'plausible', 'umami', 'custom')),

  -- Where the tracker script lives and what site it reports as. For
  -- provider='custom', config carries the full snippet contract instead.
  script_url text,
  site_id text,

  -- Consent gate: the web surface loads this tracker ONLY when the visitor has
  -- granted this consent category (ties into the existing consent flow —
  -- get_my_pending_consents et al.). 'essential' is reserved for strictly
  -- functional measurement and still renders a disclosure.
  consent_category text NOT NULL DEFAULT 'analytics'
    CHECK (consent_category IN ('essential', 'analytics', 'marketing')),

  config jsonb NOT NULL DEFAULT '{}'::jsonb,

  is_enabled boolean NOT NULL DEFAULT false,

  -- §19.4 per-instance scoping (same contract as ai_provider_registry).
  scoped_to_instance_id uuid,

  -- Provenance + ownership guard (see materialize_web_tracking).
  source_plugin_id uuid REFERENCES public.plugin_catalog(id) ON DELETE SET NULL,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.web_tracking_registry ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.web_tracking_registry IS
  'Declarative web-tracking catalog. Materialization target for plugin kind=web_tracking; consumed by the web surface via get_active_web_tracking(), consent-gated per visitor.';
