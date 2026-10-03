-- Trigger: create_distribution_plan_on_registration
-- Table: study_registrations

CREATE TRIGGER create_distribution_plan_on_registration
AFTER UPDATE OR INSERT
ON public.study_registrations
FOR EACH ROW
EXECUTE FUNCTION create_member_distribution_plan_on_registration();
