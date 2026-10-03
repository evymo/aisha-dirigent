-- Trigger: update_partner_templates_updated_at
-- Table: partner_templates

CREATE TRIGGER update_partner_templates_updated_at
BEFORE UPDATE
ON public.partner_templates
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
