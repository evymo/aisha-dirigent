-- Trigger: trg_intranet_chat_channels_updated_at
-- Table: intranet_chat_channels
-- Purpose: Auto-update updated_at on row modification

CREATE TRIGGER trg_intranet_chat_channels_updated_at
  BEFORE UPDATE ON intranet_chat_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
