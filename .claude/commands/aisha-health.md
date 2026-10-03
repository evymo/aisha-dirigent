# AISHA System Health Check

Check connectivity and status of all platform services.

## Instructions

Run the following checks and report status for each:

### 1. MCP Knowledge Server
Try calling `search_knowledge` with a simple query like `"health check"`. Then call `admin_health_check` with no arguments to get the status of all registered integration services.
Report:
- MCP search: Connected / Unreachable
- Services: each service name + health_status

### 2. Local Supabase
```bash
npx supabase status 2>&1 | head -20
```
Report: running / stopped / not installed

### 3. Git Status
```bash
git branch --show-current
git status --short | head -10
```
Report: current branch, clean/dirty working tree

### 4. Migration Status
```bash
npm run db:status:local 2>&1 | tail -10
```
Report: up-to-date / pending migrations

### 5. TypeScript Compilation
```bash
npx tsc --noEmit 2>&1 | tail -5
```
Report: clean / errors (count)

### 6. Story Context
```bash
cat .aisha/story.json 2>/dev/null
```
Report: active story ID or "no story set"

### 7. Build Status
```bash
npm run build 2>&1 | tail -5
```
Report: success / failure

## Summary

Present a dashboard-style summary:

```
Service              Status
─────────────────────────────
MCP Knowledge        [OK/FAIL]
Local Supabase       [OK/FAIL/STOPPED]
Git                  [branch] [clean/dirty]
Migrations           [OK/PENDING]
TypeScript           [OK/ERRORS]
Story Context        [uuid/none]
Build                [OK/FAIL]
```
