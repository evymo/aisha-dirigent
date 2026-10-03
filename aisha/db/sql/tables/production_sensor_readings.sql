-- Table: production_sensor_readings
-- IoT/HomeAssistant sensor data aggregation for production monitoring
-- Maps to erp-basis.md environmental data + user requirement for HomeAssistant integration
-- Stores temperature, humidity, pressure, and other sensor readings from production processes
-- Designed for bulk inserts from IoT gateways; future HomeAssistant webhook/MQTT integration
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_sensor_readings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sensor_code text NOT NULL,
  location_id uuid,
  equipment_id uuid,
  batch_id uuid,
  flow_node_id uuid,
  reading_type text NOT NULL,
  value numeric(16,6) NOT NULL,
  unit text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source text DEFAULT 'homeassistant' NOT NULL,
  is_excursion boolean DEFAULT false NOT NULL,
  excursion_severity text,
  excursion_acknowledged_by uuid,
  excursion_acknowledged_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT production_sensor_readings_type_check CHECK (
    reading_type IN ('temperature', 'humidity', 'pressure', 'ph', 'weight', 'flow_rate', 'power', 'duration', 'conductivity', 'dissolved_oxygen', 'custom')
  ),
  CONSTRAINT production_sensor_readings_source_check CHECK (
    source IN ('homeassistant', 'manual', 'plc', 'lims', 'iot_gateway', 'scada')
  ),
  CONSTRAINT production_sensor_readings_excursion_severity_check CHECK (
    excursion_severity IS NULL OR excursion_severity IN ('info', 'warning', 'critical')
  ),
  CONSTRAINT production_sensor_readings_location_fkey FOREIGN KEY (location_id) REFERENCES production_locations(id) ON DELETE SET NULL,
  CONSTRAINT production_sensor_readings_equipment_fkey FOREIGN KEY (equipment_id) REFERENCES production_equipment(id) ON DELETE SET NULL,
  CONSTRAINT production_sensor_readings_batch_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE SET NULL,
  CONSTRAINT production_sensor_readings_flow_node_fkey FOREIGN KEY (flow_node_id) REFERENCES production_flow_nodes(id) ON DELETE SET NULL,
  CONSTRAINT production_sensor_readings_acknowledged_by_fkey FOREIGN KEY (excursion_acknowledged_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_sensor_readings ENABLE ROW LEVEL SECURITY;

-- Grants: admin-managed, read for authenticated
GRANT SELECT ON production_sensor_readings TO authenticated;
GRANT ALL ON production_sensor_readings TO service_role;

-- Indexes — optimized for time-series queries

-- Composite index for common time-series query pattern

-- Column documentation
COMMENT ON TABLE production_sensor_readings IS 'IoT/HomeAssistant sensor data. Per erp-basis.md: environmental monitoring + future sensor integration. Optimized for time-series queries and excursion alerting.';
COMMENT ON COLUMN production_sensor_readings.sensor_code IS 'Sensor identifier from HomeAssistant/IoT, e.g. sensor.susarna_teplota, sensor.macerace_vlhkost';
COMMENT ON COLUMN production_sensor_readings.reading_type IS 'Measurement type: temperature, humidity, pressure, ph, weight, flow_rate, power, duration, conductivity, dissolved_oxygen, custom';
COMMENT ON COLUMN production_sensor_readings.source IS 'Data source: homeassistant, manual, plc, lims, iot_gateway, scada';
COMMENT ON COLUMN production_sensor_readings.is_excursion IS 'Whether this reading represents an environmental excursion (outside spec limits)';
COMMENT ON COLUMN production_sensor_readings.excursion_severity IS 'Excursion severity: info (minor), warning (approaching limit), critical (spec violation)';
COMMENT ON COLUMN production_sensor_readings.batch_id IS 'Associated production batch (if sensor is linked to active batch processing)';
COMMENT ON COLUMN production_sensor_readings.flow_node_id IS 'Associated production flow node (links IoT sensor data to specific production node in the flow graph)';
