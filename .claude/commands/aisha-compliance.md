# AISHA Compliance Gate

Check PR/branch compliance against platform standards before merge.

## Arguments: $ARGUMENTS

## Instructions

1. **Detect changes**: Run `git diff --stat main...HEAD` to identify all changed files and their scope.

2. **Consult MCP KB**: Call `check_pr_compliance` with:
   - `story_id`: from `.aisha/story.json` (if set)
   - `file_paths`: list of changed files from step 1
   - `diff_summary`: output from `git diff --stat main...HEAD`
   - `tech_stack`: `["typescript", "react", "supabase"]`

3. **Run gate tests**: `npm run test:gates` — these validate architecture, security, code hygiene, design tokens, DB structure, edge function security, enum consistency.

4. **Run pre-push checks** (mirror Husky):
   - `npm run validate:static` — SQL function validation
   - `npm run i18n:check` — full i18n validation
   - `npm run test:run` — unit tests
   - `npm run build` — production build

5. **Migration check**: If any files in `supabase/migrations/` changed:
   - Verify they are registered: `npm run db:status:local`
   - Ensure types are regenerated: check if `src/integrations/supabase/types.ts` is in diff

6. **Report**: PR readiness checklist:
   - [ ] Gate tests pass
   - [ ] TypeScript compiles
   - [ ] ESLint clean
   - [ ] i18n complete
   - [ ] Unit tests pass
   - [ ] Build succeeds
   - [ ] MCP compliance validated
   - [ ] Migrations registered (if applicable)
