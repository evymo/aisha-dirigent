-- Index: idx_wd_positions_history_car_time
-- Source of truth pair: aisha/db/sql/tables/wd_vehicle_positions_history.sql

CREATE INDEX idx_wd_positions_history_car_time
  ON public.wd_vehicle_positions_history (wd_car_id, position_time DESC);
