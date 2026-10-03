# AISHA Test Strategy

Evaluate and run test strategy for the specified file or hook.

## Arguments: $ARGUMENTS

## Instructions

1. **Identify target**: If `$ARGUMENTS` is provided, use it as the file path. Otherwise, detect changed files via `git diff --name-only`.

2. **Map to test files**:
   - Hooks (`src/hooks/useXyz.ts`) → `src/tests/hooks/useXyz.test.ts`
   - Components (`src/components/*/Xyz.tsx`) → `src/tests/components/Xyz.test.tsx`
   - Schemas (`src/lib/schemas/*.ts`) → corresponding test in `src/tests/`

3. **If test exists**: Run it with `npm run test:run -- <test-path>`. Parse output and report pass/fail with details.

4. **If test does NOT exist**:
   - Get session: call `moderate_flow` with `session_type="test_strategy"` to get `session_id`
   - Call `evaluate_tests` with:
     - `session_id` from above
     - `hook_name`: name of the hook/function
     - `file_path`: path to the source file
     - `test_file_path`: path to test file (even if missing — tool reports gaps)
   - Follow the returned recommendations for test structure

5. **If schema changed** (`src/lib/schemas/`): Warn about `parseRpcArraySafe` silent failure risk.

6. **Report**: Structured output with test file, pass/fail, key assertions, and any warnings.
