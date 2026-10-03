# Workflow Lanes

## Smoke

Use for active implementation work.

- `npx tsc --noEmit`
- `npm run lint`
- `npm run i18n:check`
- `npm run test:gates`
- `npm run build`

## Full

Use for merge, deploy, or trusted autopilot runs.

- All `smoke` checks
- `npm run test:run`

## Deploy gate

1. `aisha-health`
2. `aisha-test --lane full`
3. Deploy dry-run
4. Real deploy only if `deployCommand` is configured
5. Post-deploy verify or structured incident output
