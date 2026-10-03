-- Index: idx_member_dashboard_widgets_visible
-- Table: member_dashboard_widgets

CREATE INDEX IF NOT EXISTS idx_member_dashboard_widgets_visible ON member_dashboard_widgets(user_id, is_visible) WHERE is_visible = true;
