# AISHA Effort Estimation

Estimate development effort for a task.

## Arguments: $ARGUMENTS

## Instructions

1. **Parse task description** from `$ARGUMENTS`. If empty, ask the user to describe the task.

2. **Get moderation session**: Call `moderate_flow` with `session_type="estimation"` and `tech_stack=["typescript","react","supabase"]`. This returns a `session_id` required for estimation.

3. **Consult MCP KB**: Use `estimate_effort` tool with:
   - `session_id` from step 2
   - `task_description` from arguments
   - `affected_files`: list of likely files
   - `complexity_factors`: `has_migration`, `has_rpc`, `has_tests` flags

3. **Analyze affected areas**: Based on the task, identify:
   - Which files/modules would need changes
   - Whether DB migrations are needed
   - Whether new tests are required
   - Whether i18n updates are needed
   - Whether edge function changes are needed

4. **Consider dependencies**: Check if the task depends on:
   - External services (Stripe, n8n, Ragnarok)
   - DB schema changes (migration chain)
   - Frontend + backend coordination

5. **Report**:
   - Complexity assessment
   - Affected areas with file paths
   - Risk factors
   - Suggested implementation sequence
   - Pre-requisites and blockers
