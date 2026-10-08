# AISHA Deployment Workflow

Guide through the deployment process with pre-flight validation.

## Arguments: $ARGUMENTS

## Instructions

1. **Pre-flight checks** (run sequentially, stop on first failure):
   ```
   npm run test:gates       # Architecture compliance
   npm run validate:static  # SQL function validation
   npm run i18n:check       # Translation completeness
   npm run test:run         # Unit tests
   npm run build            # Production build
   npm run func:validate    # Edge function validation
   ```

2. **Git status check**:
   - `git status` — ensure clean working tree
   - `git log --oneline main..HEAD` — review commits being pushed
   - Check for untracked files that should be committed

3. **Migration check**: If any `supabase/migrations/` files in diff:
   - Verify registration: `npm run db:status:local`
   - Ensure `migration-registry.json` is committed
   - Ensure `src/integrations/supabase/types.ts` is up to date

4. **Edge function check**: If any `supabase/functions/` files changed:
   - `npm run func:validate` — validate all functions
   - Remind about edge function deployment (happens separately via Docker)

5. **Deployment**:
   - Report pre-flight results
   - If all pass, confirm with user before `git push`
   - CI/CD pipeline (CI workflows in `.github/workflows`) triggers automatically on push to main
   - Coolify deploys via webhook

6. **Post-deploy**: Remind to check:
   - CI pipeline status (CI workflows)
   - Production health after deploy

7. **Story status update** (if `.aisha/story.json` has an active story):
   - Call `transition_delivery_status` with `new_status="delivering"` to mark story as in-flight
   - After successful deploy, call again with `new_status="delivered"` to close it out
