# AISHA Dirigent — Claude app install smoke test

Validates a real install end-to-end. Split in two: an **automated pre-flight**
(no Claude needed) and a **manual checklist** (Claude Desktop / Claude Code UI).

## 1. Automated pre-flight (no Claude required)

Drives the bundled MCP server over stdio exactly as the hosts do on load
(`initialize` → `tools/list` → `tools/call` → `resources/list`):

```bash
node scripts/verify-claude-app-install.mjs            # uses this repo as workspace
node scripts/verify-claude-app-install.mjs /path/to/other/aisha-project
# or: npm run verify:claude-app
```

Expected: all checks `✓`, exit 0 — the server starts, speaks MCP, lists its 19
tools, answers `aisha_health`, and exposes resources. (Also covered in CI by the
generation-drift gate + node:test suite.)

## 2. Claude Code (plugin)

```bash
# from a clone of this repo:
claude plugin install ./extensions/aisha-dirigent-claude
# or via the marketplace:
claude plugin marketplace add evymo/aisha-dirigent
claude plugin install aisha-dirigent@evymo
```

Then, in a Claude Code session **opened on an AISHA project** (a folder with
`.aisha/` and `package.json`):

- [ ] Plugin shows as installed (`/plugin` list, or `claude plugin list`).
- [ ] The `aisha-dirigent` MCP server is connected (no startup error).
- [ ] Slash commands exist: type `/aisha-dirigent:` and confirm the list
      (`health`, `seed-status`, `merge-status`, `route`, `models`, `cost-usage`,
      `bringup`, `overlay-plan`, `compose-overlay`, `scaffold`, …).
- [ ] `/aisha-dirigent:health` returns runtime + tool availability JSON.
- [ ] `/aisha-dirigent:session` reflects the open project (`workspace`, `domain`).
- [ ] SessionStart hook injects the AISHA context block at the top of a new session.
- [ ] A write tool previews by default: `/aisha-dirigent:scaffold` (no `apply`)
      shows a preview and writes nothing; with `apply=true` it writes under `.claude/`.

`AISHA_WORKSPACE` is wired to `${CLAUDE_PROJECT_DIR}`, so the tools read the
project you have open.

## 3. Claude Desktop (.mcpb)

```bash
npm run package:claude-app          # → dist/claude-app/aisha-dirigent.mcpb
```

- [ ] Double-click the `.mcpb` (or Settings → Extensions → Install) — it installs
      without a manifest error.
- [ ] On install, Claude Desktop prompts for the **AISHA workspace** directory;
      pick a project containing `.aisha/`.
- [ ] The extension appears enabled; the `aisha-dirigent` tools are listed.
- [ ] In a chat, ask Claude to run `aisha_health` / `aisha_seed_status` — results
      reflect the chosen workspace.
- [ ] `aisha_bringup` with `dryRun: true` reports the bring-up command without
      starting anything.

## 4. Autonomous bring-up (needs Docker)

On a machine with Docker, in an AISHA project with no backend running:

- [ ] `aisha_bringup` (no `dryRun`) runs `npm run stack:bringup`, waits, and
      returns `{ ok: true, healthy: true, gatewayUrl, services }`.
- [ ] `aisha_health` afterwards shows the backend reachable.

> Note: the in-repo wrapper + JSON-contract parsing are covered by tests; this
> step exercises the actual multi-container stack, which CI/sandbox don't run.

## Troubleshooting

- **No tools in Claude Code** → check `.mcp.json` resolved `${CLAUDE_PLUGIN_ROOT}`;
  run the pre-flight (§1) to confirm the server itself is fine.
- **`.mcpb` won't install** → re-pack with `npm run package:claude-app` and check
  `npm run package:claude-app:check` passes (manifest valid, 19 tools).
- **Tools read the wrong project** → set/verify `AISHA_WORKSPACE` (Desktop: the
  directory chosen at install; Code: the open project dir).
