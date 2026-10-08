# Changelog — AISHA Dirigent (Claude app)

All notable changes to the AISHA Dirigent Claude Code plugin + Claude Desktop
Extension (`.mcpb`). Versions track the VS Code Dirigent extension
(`extensions/aisha-dirigent`).

## 0.7.0

First tagged release of the Claude app — AISHA Dirigent as a Claude Code plugin
**and** a Claude Desktop Extension (MCPB), generated from one source of truth by
the `gen:ide` `claude-app` adapter. Tag: `claude-app-v0.7.0`.

### Added

- **Zero-dependency MCP server** (`server/`) exposing 19 Dirigent tools over MCP
  stdio: session / story / decisions / activity feed, active rules + ruleset,
  seed / merge / DB-convergence tracking, model routing + local-LLM discovery +
  cost/usage, health + environment scan, and `aisha_sync_instructions`.
- **Backend-parameterized composition** — `aisha_overlay_plan` (preview what the
  backend would emit for the active story/domain), `aisha_compose_overlay` (drive
  the `gen:ide` pipeline to materialize it), and `aisha_scaffold` (author a
  project-tailored skill / hook / command / agent into `.claude/`). Writes only
  with `apply=true`; hook merges deep-merge `.claude/settings.json` and preserve
  every user key.
- **Autonomous local-stack bring-up** — `aisha_bringup` runs the shared
  `npm run stack:bringup` entry-point when no backend is reachable, parses the
  final JSON status line, and returns `{ healthy, gatewayUrl, services }`.
  `dryRun: true` reports the exact command (and expected gateway) without
  starting anything.
- **Dual-format packaging from one directory** — `manifest.json` (MCPB spec 0.3)
  for Claude Desktop, plus a Claude Code plugin (`.claude-plugin/plugin.json`,
  `.mcp.json`, one slash command per tool, an operating skill, a read-only
  advisor agent, and a SessionStart context hook). The `.mcpb` is built with a
  pure-Node zip packer (`scripts/lib/mini-zip.mjs`) and ships no `node_modules`.
- **One-command install** — `.claude-plugin/marketplace.json`:
  `claude plugin marketplace add evymo/aisha-dirigent` →
  `claude plugin install aisha-dirigent@evymo`.
- **Release automation** — `.github/workflows/claude-app-release.yml` builds,
  checksums, and attaches `aisha-dirigent.mcpb` to the release on
  `claude-app-v*` tags (zero-dep, no `npm ci`).
- **Contract drift gate** — `scripts/ide-adapters/__tests__/claude-app-drift.test.mjs`
  fails CI if the standalone server's inlined bring-up contract
  (`STACK_BRINGUP_*`, `parseBringupResult`) or `mergeSettingsJson` drift from
  their source of truth (`scripts/lib/bringup-contract.mjs`,
  `scripts/ide-adapters/multi-file.mjs`). Wired into the `test:scripts` lane in
  CI; the Web:Tests lane is also triggered by `extensions/aisha-dirigent-claude/`
  changes.

### Notes

- Status / read tools are side-effect free. Only `aisha_sync_instructions`,
  `aisha_compose_overlay`, and `aisha_scaffold` write — and only with
  `apply=true` (Principle of Least Privilege).
- Everything operates on local `.aisha/`, `.claude/`, and git state; nothing
  leaves the machine. Local LLMs (Ollama / Docker Model Runner / vLLM) are probed
  on OpenAI-compatible endpoints.
- Full pipeline + design notes: `docs/integrations/CLAUDE_APP_CONVERSION.md`.
