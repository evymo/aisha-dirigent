-- ============================================================================
-- Source of Truth: wd_worktime
-- Popis: Výkony řidičů podle tachografu z Webdispečinku (_getDriverWorkTacho).
--        Jeden řádek = řidič × den × vozidlo. Upsert podle
--        (wd_driver_id, work_date, car_identifikator) — tacho se zpětně
--        dopočítává, opakovaný import stejného okna aktualizuje. Časy jsou
--        v SEKUNDÁCH (TotalDrive/Work/Rest/StandBy = doba řízení/práce/odpočinku/
--        pohotovosti dle 561/2006). Spravováno: svc-webdispecink přes
--        wd_upsert_worktime_audited.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_worktime (
  id                    uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  wd_driver_id          integer        NOT NULL,
  car_identifikator     text           NOT NULL DEFAULT '',
  work_date             date           NOT NULL,
  day_type              text,
  work_from             time,
  work_to               time,
  total_drive_seconds   integer,
  total_work_seconds    integer,
  total_rest_seconds    integer,
  total_standby_seconds integer,
  night_drive_seconds   integer,
  night_work_seconds    integer,
  night_rest_seconds    integer,
  night_standby_seconds integer,
  distance_km           numeric(10,2),
  absences              jsonb,
  raw_data              jsonb,
  last_import_at        timestamptz,
  created_at            timestamptz    NOT NULL DEFAULT now(),
  updated_at            timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT wd_worktime_key UNIQUE (wd_driver_id, work_date, car_identifikator)
);

COMMENT ON TABLE public.wd_worktime IS 'Výkony řidičů podle tachografu z Webdispečinku (_getDriverWorkTacho); řidič×den×vozidlo, časy v sekundách, upsert přes wd_upsert_worktime_audited';
COMMENT ON COLUMN public.wd_worktime.car_identifikator IS 'SPZ vozidla z tachografu (CarIdentifikator) — klíč na vozidlo; prázdné = nepřiřazeno';
COMMENT ON COLUMN public.wd_worktime.total_drive_seconds IS 'TotalDrive — doba řízení v sekundách (561/2006)';
COMMENT ON COLUMN public.wd_worktime.total_work_seconds IS 'TotalWork — doba jiné práce v sekundách';


ALTER TABLE public.wd_worktime ENABLE ROW LEVEL SECURITY;
