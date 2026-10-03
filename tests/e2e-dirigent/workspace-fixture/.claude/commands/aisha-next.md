# AISHA Next Step

Suggest what to do next based on current project context.

## Arguments: $ARGUMENTS

## Instructions

1. **Gather context**:
   - Read `.aisha/story.json` for active story/project context
   - Run `git branch --show-current` and `git status --short`
   - Run `git log --oneline -5` for recent commits
   - Check for uncommitted changes

2. **Consult MCP KB**: Use `suggest_next_step` tool with:
   - Current branch name
   - Recent commit messages
   - Story ID (if available)
   - Any additional context from `$ARGUMENTS`

3. **Analyze state**:
   - Are there uncommitted changes that need tests?
   - Are there failing tests? (`npm run test:run` exit code)
   - Is the build passing? (`npm run build` exit code)
   - Are migrations registered? (`npm run db:status:local`)

4. **Suggest priority actions**:
   - If tests failing → fix tests first
   - If build failing → fix build
   - If unregistered migrations → register
   - If clean state → suggest next feature/fix from story context
   - If no story → suggest setting one via `/aisha-story`

5. **Report**: Ordered list of recommended next actions with rationale.
