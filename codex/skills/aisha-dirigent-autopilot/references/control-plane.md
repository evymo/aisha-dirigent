# Control Plane

- Policy source: `AGENTS.md`
- Generated source pack: `docs/generated/dirigent-source-pack/`
- Remote-first path: `Aisha -> n8n trigger -> MCP knowledge server`
- Local fallback path: `aisha-*` CLI entrypoints -> repo scripts -> audit trace
- Local config file: `.aisha/dirigent.local.json`
- Environment overrides: `EVYMO_*` and `SUPABASE_CLI_BIN`

Config precedence:

1. Environment variables
2. `.aisha/dirigent.local.json`
3. `.aisha/dirigent.json`
4. Legacy `aisha.dirigent.*` VS Code settings

Expected runtime:

- `hybrid` autonomy mode
- `remote preferred`, local fallback required
- `trusted` deploy flow only after health + full validation gates
