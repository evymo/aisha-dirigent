-- ============================================================================
-- Source of Truth: wd_driver_stats
-- Popis: Statistika řidičů z Webdispečinku (_getStaDrivers) — fleet-wide agregát
--        za okno: služební × soukromé km, doba jízdy (den × noc), dojíždění.
--        Jeden řádek = poslední snapshot řidiče (upsert podle wd_driver_id);
--        `period_from`/`period_to` říkají, za jaké okno platí. Spravováno:
--        svc-webdispecink přes wd_upsert_driver_stats_audited.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_driver_stats (
  id                             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  wd_driver_id                   integer       NOT NULL,
  period_from                    date,
  period_to                      date,
  total_km                       numeric(12,2),
  service_km                     numeric(12,2),
  private_km                     numeric(12,2),
  driving_seconds                integer,
  driving_service_seconds        integer,
  driving_private_seconds        integer,
  driving_service_day_seconds    integer,
  driving_service_night_seconds  integer,
  commute_count                  integer,
  raw_data                       jsonb,
  last_import_at                 timestamptz,
  created_at                     timestamptz   NOT NULL DEFAULT now(),
  updated_at                     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT wd_driver_stats_driver_key UNIQUE (wd_driver_id)
);

COMMENT ON TABLE public.wd_driver_stats IS 'Statistika řidičů z Webdispečinku (_getStaDrivers): služební/soukromé km, doba den/noc — poslední snapshot per řidič, upsert přes wd_upsert_driver_stats_audited';
COMMENT ON COLUMN public.wd_driver_stats.commute_count IS 'DomovPraceDomov — dojíždění domov↔práce';

ALTER TABLE public.wd_driver_stats ENABLE ROW LEVEL SECURITY;
