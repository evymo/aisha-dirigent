# AISHA Code Quality Audit

Assess code quality against AISHA platform standards.

## Arguments: $ARGUMENTS

## Instructions

1. **Identify scope**: If `$ARGUMENTS` is provided, audit those files. Otherwise, audit files changed in current branch vs main: `git diff --name-only main...HEAD`.

2. **Scan for violations** in each file:

   | Rule | Pattern to detect |
   |------|-------------------|
   | RPC-Only | `.from(` followed by `.select(`, `.insert(`, `.update(`, `.delete(` |
   | No select star | `.select("*")` or `.select('*')` |
   | No console.log | `console.log(` (allow `console.error` only with `safeError`) |
   | No any types | `: any`, `as any`, `<any>` |
   | No ts-ignore | `@ts-ignore` (should be `@ts-expect-error`) |
   | No emoji in UI | Unicode emoji in JSX (not in comments/tests) |
   | No hardcoded text | Quoted strings in JSX that aren't i18n keys |
   | Safe error logging | `console.error(` without `safeError()` wrapper |

3. **Consult MCP KB**: Use `assess_quality` tool if available, or `search_knowledge` with `"code quality pravidla"` for additional context.

4. **Run automated checks**:
   - `npx tsc --noEmit` — TypeScript compilation
   - `npm run lint` — ESLint rules

5. **Report**: Structured output per file:
   - PASS / WARN / FAIL per category
   - Line numbers of violations
   - Suggested fixes
   - Overall quality score (pass all = green, any FAIL = red)
