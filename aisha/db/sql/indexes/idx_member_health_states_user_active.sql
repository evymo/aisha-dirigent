-- Index: idx_member_health_states_user_active
-- Table: member_health_states

CREATE INDEX IF NOT EXISTS idx_member_health_states_user_active
  ON member_health_states(user_id) WHERE is_active = true;

-- member_health_logs indexes
