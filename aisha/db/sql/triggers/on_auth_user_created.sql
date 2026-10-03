-- Trigger: on_auth_user_created
-- Description: Automatically assigns 'member' role and creates profile for new users
-- Applies to: aisha_auth.users table (INSERT)
-- Function: handle_new_user()
--
-- This trigger fires for ALL new users including:
-- - Email/password registration
-- - OAuth (Google, Apple, etc.)
-- - Magic link signup

-- Drop existing trigger if exists (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON aisha_auth.users;

-- Create trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON aisha_auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Note: Trigger on aisha_auth.users requires superuser/service_role access
-- This is applied via migration, not via regular authenticated calls
