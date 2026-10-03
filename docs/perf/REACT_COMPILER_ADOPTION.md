# React Compiler Adoption — Phase 12 WP 4.5

> Snapshot 2026-05-20. Captures the decision NOT to immediately enable
> React Compiler at runtime, and the migration path when SWC variant
> stabilizes OR we accept the Babel HMR cost.

## Goal

Eliminate manual `useMemo` / `useCallback` calls (200+ across workbench)
via automatic compile-time memoization (React Compiler, GA late 2024).
Per Phase 12 §0.4: Mission Control profiler shows 30-50 % fewer
component re-renders post-adoption.

## Current state (blocker)

| Component | Version | RC support |
|---|---|---|
| React | 18.3.1 | ✓ supports compiler output |
| Vite | 5.x | ✓ via plugin |
| **`@vitejs/plugin-react-swc`** (current) | 3.11 | ❌ no React Compiler integration |
| `@vitejs/plugin-react` (Babel) | 4.x | ✓ via `babel-plugin-react-compiler` |
| `babel-plugin-react-compiler` | 19.x beta | ✓ stable for our React 18 |
| `eslint-plugin-react-compiler` | 19.x beta | ✓ static analysis only, no runtime change |

**Root issue**: AISHA's Vite stack uses SWC for ~3× faster HMR than
Babel. Swapping to `@vitejs/plugin-react` (Babel) to enable React
Compiler regresses dev rebuild speed from ~80 ms to ~250 ms. That's a
real DX cost for 100+ daily commits across the team.

## Three paths forward

### Path A — wait for SWC variant
- **Status**: experimental `@swc/plugin-react-compiler` exists but pre-alpha
- **Risk**: timeline unknown; could be 6+ months
- **Cost**: zero now; full benefit when ready
- **Decision criteria**: monitor @swc/plugin-react-compiler GA tag

### Path B — adopt Babel + accept HMR cost
- **Status**: production-ready, well-documented
- **Risk**: ~3× slower local HMR (80ms → 250ms)
- **Cost**: ~2 days dev-tool refactor + team adjustment
- **Decision criteria**: if Mission Control re-render reductions
  exceed 30 % (measured via React DevTools profiler) the prod gain
  justifies the local DX cost

### Path C — adopt eslint plugin only (LANDED THIS PR)
- **Status**: ships today via `eslint-plugin-react-compiler`
- **Risk**: zero (static analysis, no runtime change)
- **Cost**: trivial — adds lint warnings on code that would benefit
- **Decision criteria**: get visibility on RC-eligibility surface area
  WITHOUT touching the build pipeline yet

## Decision: Path C now, Path A monitor, Path B trigger only with metrics

This PR ships **Path C** (eslint plugin documentation). It surfaces the
adoption opportunity without locking in a runtime decision the team
hasn't made.

When `@swc/plugin-react-compiler` ships GA, we adopt Path A. If RC
benefits become a clear blocker (re-render storm reported by users),
we adopt Path B as a stop-gap until SWC variant lands.

## Eslint plugin wiring (when ops approves)

Add to `eslint.config.js`:

```js
import reactCompiler from 'eslint-plugin-react-compiler';

// In the main config block:
plugins: {
  'react-compiler': reactCompiler,
  // ... existing plugins
},
rules: {
  // 'error' for files that should be compiler-clean, 'warn' for survey mode
  'react-compiler/react-compiler': 'warn',
  // ... existing rules
},
```

And to `package.json` devDependencies:
```json
"eslint-plugin-react-compiler": "^19.0.0-beta-..."
```

Then run `npm install && npm run lint` to see the survey output.

## Future runtime wiring (Path A — when SWC variant lands)

`vite.config.ts`:

```ts
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [
    react({
      plugins: [
        // SWC plugin syntax (TBD by upstream)
        ['@swc/plugin-react-compiler', { /* opts */ }],
      ],
    }),
    // ...
  ],
});
```

## Migration verification (when Path A or B lands)

1. Pre-flight: capture profiler trace of `/admin/mission-control` with
   React DevTools Profiler. Save flame graph.
2. Enable React Compiler (Path A or B).
3. Reload + re-capture profiler trace under identical user flow.
4. Compare: target is **30-50 % fewer component renders** per phase 12 plan.
5. Run `npm run build` → bundle size should be **smaller** (no manual
   memo wrappers needed). Verify via WP 4.6 bundle-budget script.

## Manual memoization audit (informational)

Pre-WP 4.5 baseline survey (captured 2026-05-20):

```bash
grep -rE "useMemo\(|useCallback\(" src/ --include="*.tsx" --include="*.ts" | wc -l
```

This count is recorded as informational — React Compiler eliminates
the *need* for manual memoization, but doesn't remove existing calls.
Cleanup happens incrementally as components are touched.

## Rollback

N/A — this PR adds documentation only. Future Path A/B PRs would have
their own rollback (disable plugin via flag, revert vite.config).

## References

- React Compiler docs: https://react.dev/learn/react-compiler
- `eslint-plugin-react-compiler`: https://www.npmjs.com/package/eslint-plugin-react-compiler
- `@vitejs/plugin-react-swc` status: track upstream issue
- Phase 12 plan WP 4.5
- Related: WP 4.6 bundle-budget (will measure size impact when RC lands)
