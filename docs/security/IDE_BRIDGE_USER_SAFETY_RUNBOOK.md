# IDE Bridge — user-machine safety runbook — Phase 13 WP 13.5

> **Snapshot 2026-05-20**. Owner: Fullstack + DevOps + Security.
> **Status**: Operator runbook + gate lock on the safety contract already
> shipped via PR #155 (Phase 13 WP 13.3 — `@aisha/ide-bridge` client
> package). No code changes — this PR ratchets down the existing
> implementation so future refactors can't silently break the user-
> machine safety guarantees.

## TL;DR

The `@aisha/ide-bridge` package writes dynamic AISHA instruction blocks
into files on the **user's local workspace** (`CLAUDE.md`,
`.cursorrules`, `.github/copilot-instructions.md`,
`.idea/aisha-ai-prompt-config.json`). This runbook documents the
five contract guarantees the bridge MUST satisfy, the procedures for
operators + end-users to verify them, and the recovery path when
something goes wrong.

The contract derives from `feedback_agent_on_user_machine_safety.md`
and is enforced by `src/tests/gates/wp-13-5-user-settings-respect.gate.test.ts`
plus the existing `wp-13-3-ide-bridge.gate.test.ts` (structural lock)
and the unit suite at `packages/aisha-ide-bridge/src/__tests__/`.

## §1 The five-invariant safety contract

| # | Invariant | Where enforced | How a user can verify |
|---|---|---|---|
| **1** | **Detect user-owned content** — files that exist *before* `init` and lack the AISHA delimiter are treated as fully user-owned: the bridge PREPENDS its managed block, never overwrites existing content. | `safe-write.ts::safeWriteSync` returns `appended-to-user-owned` outcome | After first sync, check that the original file content is still present below the AISHA-MANAGED block |
| **2** | **Backup before write** — every write produces a timestamped backup in `<rootDir>/.aisha/backups/<filename>.<ISO-timestamp>.bak`, rotated to the last 5. | `safe-write.ts::DEFAULT_BACKUPS_PER_FILE = 5` + rotation in `pruneOldBackups()` | `ls <rootDir>/.aisha/backups/` shows ≤ 5 backups per file |
| **3** | **Auto-trigger is opt-in** — the bridge daemon never starts automatically; it requires explicit `npx aisha-ide-bridge init` + then `daemon` / `sync` invocation. | `cli.ts` requires explicit subcommand; no postinstall hook | Fresh `npm install @aisha/ide-bridge` does NOT spawn any background process |
| **4** | **Privacy guard** — the bridge sends `user_id` (JWT-derived) + `workspaceId` to the backend. It never sends file paths, repo names, or file contents. | `bridge.ts::syncOnce()` URL constructor + assertions in `bridge.unit.test.ts` | Network capture during `sync` shows only `/instructions/<ide>` + `/subscribe/<workspaceId>` URLs |
| **5** | **Uninstall reversibility** — `uninstall` removes the bridge's config (`~/.aisha-ide-bridge.json`); it does NOT delete IDE files. Users can either keep the last-written instruction or restore from `.aisha/backups/`. | `cli.ts::cmdUninstall` only deletes the config + prints reassurance to stderr | After `uninstall`, the IDE file is unchanged on disk |

The unit test `safe-write.unit.test.ts` covers each invariant
end-to-end against a real temp filesystem; the WP 13.5 gate test
asserts the unit test demonstrably exercises each path.

## §2 Operator install / verify / uninstall workflow

### §2.1 First-time install

```bash
# 1. Install the package (no daemon starts here)
npm i -g @aisha/ide-bridge

# 2. Run init — interactive, asks for service URL + IDE + workspace.
#    Writes ~/.aisha-ide-bridge.json (NO token).
npx aisha-ide-bridge init

# 3. Export the JWT into the env. NEVER pipe a token into the config file.
#    The bridge reads AISHA_IDE_BRIDGE_TOKEN at start.
export AISHA_IDE_BRIDGE_TOKEN="$(cat ~/.config/aisha/ide-bridge.token)"
#    ↑ Use your OS keychain instead of a flat file in real installs.

# 4. One-shot sync to verify the wire shape works.
npx aisha-ide-bridge sync

# 5. Start the daemon (long-running, WS reconnect with bounded backoff).
npx aisha-ide-bridge daemon
```

After step 4 you should see one of these `safeWrite` outcomes on stderr:

| Outcome | When | What happened |
|---|---|---|
| `written` | Target file did not exist | Fresh write with both delimiter blocks |
| `appended-to-user-owned` | Target file existed but had no AISHA delimiter | Original content preserved BELOW a newly-prepended AISHA block + an empty USER-CUSTOM block — see §3 for recovery if undesired |
| `skipped-identical` | Target file already current | No-op (no backup written) |
| `backup-failed` | Backup directory unwritable | Write was ABORTED — see §4.2 |

### §2.2 Verify the safety contract by hand

```bash
# Invariant #1 — detect user-owned content
echo "MY CUSTOM RULES" > /tmp/test-cursorrules
npx aisha-ide-bridge sync --ide=cursor --output=/tmp/test-cursorrules
grep -A 999 'USER-CONTENT' /tmp/test-cursorrules     # original content visible

# Invariant #2 — backup before write
ls -la $(pwd)/.aisha/backups/                        # 1-5 backups per file

# Invariant #3 — auto-trigger opt-in
ps -ef | grep aisha-ide-bridge                       # 0 processes when daemon NOT started

# Invariant #4 — privacy guard (run sync with HTTP debug)
NODE_DEBUG=http npx aisha-ide-bridge sync 2>&1 | grep -E 'GET|POST' | grep -v -E '/instructions|/subscribe|/context'
# Expected: empty (only allowlisted endpoints are hit)

# Invariant #5 — uninstall reversibility
npx aisha-ide-bridge uninstall
ls ~/.aisha-ide-bridge.json                          # ENOENT
ls /path/to/your/CLAUDE.md                           # still there
```

### §2.3 Uninstall

```bash
npx aisha-ide-bridge uninstall
```

The CLI prints to stderr:

```
[ide-bridge] config removed (~/.aisha-ide-bridge.json)
[ide-bridge] IDE instruction files were NOT touched. To restore an
[ide-bridge] earlier version, copy from <rootDir>/.aisha/backups/.
```

If you want to fully scrub the bridge's footprint:

```bash
rm -rf <rootDir>/.aisha/backups/
rm -f <rootDir>/CLAUDE.md          # or whatever your ide output path is
# Then either re-init the bridge or write a hand-authored CLAUDE.md.
```

## §3 Recovery procedures

### §3.1 Roll back to a previous version

Backups are kept in `<rootDir>/.aisha/backups/`, named
`<original-filename>.<ISO-timestamp>.bak`. The newest 5 are retained.

```bash
ls -t <rootDir>/.aisha/backups/CLAUDE.md.*.bak | head -3
# pick the timestamp you want and restore:
cp <rootDir>/.aisha/backups/CLAUDE.md.2026-05-20T17-30-12.bak <rootDir>/CLAUDE.md
```

The bridge will detect the divergence on its next sync and merge as
normal (re-extracting the USER-CUSTOM block from the restored file).

### §3.2 Pre-existing file accidentally got an AISHA prepend

If your `appended-to-user-owned` outcome wasn't what you wanted (e.g.,
you intended to keep the file fully hand-authored), restore from the
backup written *immediately before* the sync:

```bash
# The backup with the largest timestamp BEFORE the sync timestamp is
# your original.
ls -t <rootDir>/.aisha/backups/.cursorrules.*.bak
cp <rootDir>/.aisha/backups/.cursorrules.<earliest>.bak <rootDir>/.cursorrules
# Then uninstall (or skip running the bridge against this output path).
npx aisha-ide-bridge uninstall
```

### §3.3 Bridge process won't reconnect

The daemon's WS reconnect schedule is bounded: 1 → 2 → 4 → 8 → 16 → 30 s
(then stays at 30 s with ±20 % jitter — see `bridge.ts::RECONNECT_BACKOFF_SECONDS`).
If you see "max backoff reached" log lines for > 30 minutes:

1. Check the service URL in `~/.aisha-ide-bridge.json` is reachable
   (`curl -I "$SERVICE_URL/health"`)
2. Check your JWT is still valid (`AISHA_IDE_BRIDGE_TOKEN`)
3. Restart the daemon: `Ctrl-C` then `npx aisha-ide-bridge daemon`

WS close codes the daemon recognises:

| Code | Meaning | Daemon action |
|---|---|---|
| `4001` | Missing JWT | Stop, exit `2` |
| `4003` | Auth failed (invalid/expired JWT) | Stop, exit `2` |
| `4400` | Bad request (workspaceId malformed) | Stop, exit `1` |
| `4502` | Backend service unhealthy | Reconnect with backoff |
| `1001`/`1006` | Network drop | Reconnect with backoff |

## §4 Edge cases + known gotchas

### §4.1 `appended-to-user-owned` on a file you DIDN'T author

Tools like `npx create-react-app` or `cargo init` may scaffold a
default `.cursorrules` or `.github/copilot-instructions.md` you've
never read. The bridge will see no AISHA delimiter and PREPEND.
This is intended: the scaffolded content is preserved BELOW the
AISHA block. If you want a clean slate, delete the scaffolded file
before running `sync`.

### §4.2 Backup directory unwritable

If `<rootDir>/.aisha/backups/` can't be created (read-only mount, ENOSPC),
the `safeWriteSync` aborts with outcome `backup-failed` and **does not
write the IDE file**. The bridge logs the underlying error and the
daemon continues retrying on the next WS event.

Recovery: free up disk or chown the rootDir, then `npx aisha-ide-bridge sync`
will succeed on the next call.

### §4.3 Token in flat file (NOT recommended)

The CLI reads `AISHA_IDE_BRIDGE_TOKEN` from env only. If you have a
plaintext token file (e.g., `~/.config/aisha/ide-bridge.token`), restrict
its permissions:

```bash
chmod 600 ~/.config/aisha/ide-bridge.token
```

A real install should use the OS keychain (`security add-generic-password`
on macOS, `secret-tool` on Linux, `cmdkey` on Windows) and a shell hook
that exports the token only when an interactive shell starts. Per
`feedback_no_infra_in_repo.md` — committed env files MUST NOT contain
production tokens.

### §4.4 Multi-IDE on one repo

It's safe to run the bridge multiple times (once per IDE) against the
same `rootDir`. Each IDE has a distinct default output path and each
write produces its own backup chain. The privacy guard ensures the
bridge never reads cross-IDE state — each `IdeBridge` instance is
isolated to its `outputPath`.

## §5 Acceptance checklist for new IDE adapters

When adding a 5th IDE (e.g., Zed, Helix-LSP, custom company IDE), the
new adapter MUST:

- [ ] Output to a single deterministic path inside the user's rootDir
      (no scattering across multiple files)
- [ ] Use the same AISHA-MANAGED / USER-CUSTOM delimiters from
      `safe-write.ts` constants — don't reinvent the wire shape
- [ ] Be added to `IDE_DEFAULT_OUTPUT_PATH` in `bridge.ts` and to
      `SUPPORTED_IDES` union
- [ ] Be added to the template directory in `services/svc-ide-context/templates/`
- [ ] Have a corresponding section in this runbook documenting its
      output path + any IDE-specific gotchas
- [ ] Have its `safeWrite` outcome verified against all 4 paths
      (written / appended-to-user-owned / skipped-identical / backup-failed)
      via a unit test
- [ ] Be added to the `IDE_DEFAULT_OUTPUT_PATH covers all N plan-spec IDEs`
      assertion in `wp-13-3-ide-bridge.gate.test.ts`

## §6 What this runbook does NOT cover

- **Server-side context envelope generation** — see `services/svc-ide-context/`
  + `docs/perf/` for the backend wire-shape contract.
- **Template rendering on the server** — see `services/svc-ide-context/templates/`
  (Phase 13 WP 13.2 deliverable).
- **JWT issuance** — handled upstream by Keycloak via the standard
  AISHA auth flow. The bridge consumes a pre-existing JWT.
- **JetBrains plugin integration** — currently parked (Phase 13 WP 13.6,
  parking lot). The `IDE_DEFAULT_OUTPUT_PATH` slot is reserved but no
  plugin distributes against it yet.

## §7 Change history

| Date | Change | PR |
|---|---|---|
| 2026-05-19 | Initial `@aisha/ide-bridge` package shipped (safe-write + bridge + CLI) | #155 |
| 2026-05-20 | This runbook + WP 13.5 lock gate added | (this PR) |

## §8 References

- `feedback_agent_on_user_machine_safety.md` — origin of the 5-invariant contract
- `packages/aisha-ide-bridge/README.md` — package-level wire-protocol + close codes
- `src/tests/gates/wp-13-3-ide-bridge.gate.test.ts` — structural lock
- `src/tests/gates/wp-13-5-user-settings-respect.gate.test.ts` — behavioral + runbook lock (this PR)
- `packages/aisha-ide-bridge/src/__tests__/safe-write.unit.test.ts` — unit coverage of each invariant
- `services/svc-ide-context/templates/` — server-side template wire-shape (WP 13.2)
