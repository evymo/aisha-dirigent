# @aisha/ide-bridge

Client-side bridge between developer IDE workspaces (Claude Code, Cursor,
GitHub Copilot, JetBrains future) and AISHA's `svc-ide-context` backend.
Phase 13 WP 13.3 of the canonical 90-day plan.

## What it does

1. **Initial sync**: pulls rendered IDE instructions from
   `svc-ide-context` via `GET /instructions/:ide` (REST).
2. **Realtime updates**: subscribes to `WS /subscribe/:workspaceId?` —
   on every `context_changed` event, re-fetches and writes the target
   file.
3. **Safe-write semantics**:
   - Preserves user-authored content between `<!-- USER-CUSTOM-START -->`
     and `<!-- USER-CUSTOM-END -->` markers across every sync.
   - For pre-existing files WITHOUT AISHA delimiters → prepends a
     delimiter-bounded AISHA block, **NEVER overwrites silently**.
   - Backs up the previous file to `<rootDir>/.aisha/backups/` before
     every write (rotation: last 5 per file).
4. **Reconnect-with-backoff**: 1s → 2s → 4s → 8s → 16s → 30s with ±20%
   jitter. Token-expired close (4001) → retry with fresh token from
   `tokenProvider`. Forbidden close (4003) → stop, the user lost access.

## CLI usage

```bash
# 1. First-run setup (writes ~/.aisha-ide-bridge.json — no secrets)
npx @aisha/ide-bridge init \
  --service-url https://ide-context.aisha.guru \
  --ide claude-code \
  --workspace my-laptop \
  --root .

# 2. Export your JWT (NEVER stored on disk by the bridge)
export AISHA_IDE_BRIDGE_TOKEN="$(security find-generic-password -s 'aisha-ide-bridge' -w)"

# 3a. One-shot sync
npx @aisha/ide-bridge sync

# 3b. OR run as a daemon (WS reconnect-with-backoff)
npx @aisha/ide-bridge daemon

# Cleanup
npx @aisha/ide-bridge uninstall  # removes config, leaves IDE files
```

## Programmatic usage

```ts
import { IdeBridge } from "@aisha/ide-bridge";

const bridge = new IdeBridge({
  serviceUrl: "https://ide-context.aisha.guru",
  ide: "claude-code",
  workspaceId: "my-laptop",
  rootDir: process.cwd(),
  tokenProvider: async () => fetchTokenFromKeychain(),
});

// Single fetch + write
await bridge.syncOnce();

// OR start the daemon
await bridge.start();
// ... later
bridge.stop();
```

## Safety contract (per `feedback_agent_on_user_machine_safety.md`)

| Guarantee | How it's enforced |
|---|---|
| User-owned files NEVER silently overwritten | Files without `AISHA-MANAGED-START` get the new block PREPENDED + preserve original content below |
| User customisations preserved across syncs | `<!-- USER-CUSTOM-START -->`…`<!-- USER-CUSTOM-END -->` content extracted from existing file + re-inserted into freshly rendered template |
| Every write produces a recoverable backup | `<rootDir>/.aisha/backups/<file>.<ISO-timestamp>.bak`, last 5 retained |
| JWT NEVER written to disk by the bridge | CLI requires `AISHA_IDE_BRIDGE_TOKEN` env; library version takes a `tokenProvider` callback |
| Auto-trigger is opt-in | `init` writes a tiny config; nothing runs until the operator invokes `sync` or `daemon` |
| Privacy: file paths + repo content NEVER sent to backend | Bridge sends only `user_id` (JWT subject) + optional `workspace_id` |

## Wire protocol (server → client)

```jsonc
// On WS connect (post JWT verify):
{ "type": "ready", "envelope": {…} }

// On watched-table change affecting this user's view:
{ "type": "context_changed", "envelope": {…} }

// Keepalive reply:
{ "type": "pong" }
```

Client sends `{"type":"ping"}` every 30s; anything else closes the
connection with code 1003.

Close codes:
- `4001` — auth failure → retry with fresh token
- `4003` — forbidden → stop (user lost access)
- `4400` — invalid `workspaceId`
- `4502` — upstream envelope malformed
- `1001` — server graceful shutdown

## Related

- **Phase 13 WP 13.1** — `svc-ide-context` Fastify service + RPC
- **Phase 13 WP 13.2** — Eta templates per IDE (operator-overridable)
- **Phase 13 WP 13.4** — Backend WS subscribe + realtime fabric
- **WP 13.6** (future) — JetBrains AI Assistant plugin stub
