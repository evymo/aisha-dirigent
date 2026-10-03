-- Grants: ai_run_critic_iterations

GRANT SELECT ON public.ai_run_critic_iterations TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.ai_run_critic_iterations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ai_run_critic_iterations TO service_role;
