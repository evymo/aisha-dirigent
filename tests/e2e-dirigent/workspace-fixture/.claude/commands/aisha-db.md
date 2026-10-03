# AISHA Database Operations

Run database management operations.

## Arguments: $ARGUMENTS

## Sub-commands

Parse `$ARGUMENTS` for the operation:

### `migrate` (default if no argument)
Run local migrations:
```bash
npm run db:migrate:local
```
Then auto-generate types:
```bash
npm run db:types:gen:local
```
Then verify TypeScript:
```bash
npx tsc --noEmit
```

### `types`
Regenerate TypeScript types from local DB:
```bash
npm run db:types:gen:local
```
Then verify: `npx tsc --noEmit`

### `seed`
Seed local database:
```bash
npm run db:seed:local
```

### `status`
Check migration status:
```bash
npm run db:status:local
```

### `register`
Register new/unregistered migrations:
```bash
npm run db:migration:register
```

### `lint`
Lint database structure:
```bash
npm run db-mgr:lint
```

### `setup`
Full local DB setup (migrate + seed):
```bash
npm run db:local:setup
```

### `validate`
Validate SQL functions:
```bash
npm run func:validate
```

## Safety Rules

- NEVER run `supabase:reset` or `refreshdb.sh` — catastrophic data loss risk
- Always `register` before `migrate`
- Always `types` after `migrate`
- Always `tsc --noEmit` after `types` to catch type errors early

## Report

Show the output of each command and summarize:
- Number of migrations applied (if migrate)
- Type generation result (if types)
- Any TypeScript errors found
- Current migration status
