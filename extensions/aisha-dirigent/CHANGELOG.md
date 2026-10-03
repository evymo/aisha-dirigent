# Changelog

## 0.6.0

### Added
- **Dynamic endpoint derivation**: `aisha.dirigent.cloudTLD` / `aisha.dirigent.internalTLD` settings let BYO deployments derive Keycloak (`auth.<domain>`), orchestration (`dirigent.<domain>`) and dual-plane Matrix URLs from a single `api.<domain>` entry point, following the `api.*` subdomain convention. The canonical AISHA Cloud pair (`aisha.guru` / `backend.id3a.cz`) covers the hosted instance out of the box.
- **"Deploy local stack" guided action**: the Setup wizard's Local step can now hand off to AISHA Dirigent chat to run local warmup, then polls environment detection until the backend is healthy and advances the wizard automatically.

### Changed
- **Local profile default**: Local mode now points at the AISHA Gateway (`http://localhost:57421`) instead of the legacy Supabase CLI port (`54321`).
- **Setup copy**: removed remaining "Supabase" references from onboarding/diagnostic strings; local-environment guidance now points at `npm run warmup:local` / `npm run setup`.

### Fixed
- **Build reliability**: `@aisha/local-signals` is now built before `compile`/`watch`/`type-check`/`test` so a fresh checkout doesn't fail on a missing `dist/`.

### Security
- Dependency alignment (`jsdom`, `vitest`) clears known criticals/highs in the extension's dev dependencies.

## 0.5.1

### Changed
- **Brand icon**: replaced the legacy dark-blue bot icon with the orange-gradient AISHA brand mark (256×256, sourced from the App Store brand asset)
- **Repository**: set `repository.url` to `https://github.com/evymo/aisha-dirigent` (public)

## 0.5.0

### Added
- **Keycloak PKCE login**: VS Code auth flow migrated to Keycloak OIDC PKCE (`auth.aisha.guru` edge alias); GoTrue/Supabase auth removed in favour of the Keycloak adapter
- **Admin model switch**: `AISHA: Switch Active AI Model (admin)` command for runtime model override
- **Runtime supervision in-extension** (Vrstva 2–4): RulesEngine (binding cache + signal evaluator), Error Memory module, strict-schema `LocalDecision` / `decideLocal()`, `EscalationPacket` sender, escalation chain wired into the copilot watcher; live-RPC fetch for `claude_hook_bindings`
- **Multi-IDE instruction generation**: multi-file adapter contract with claude-overlay and Zed editor adapters, plus an MCP stdio bridge
- **Safety contract for instruction files**: `file-safety` helpers, opt-in auto-regen gate, and a workspace-context privacy guard

### Changed
- **Publisher**: `evymo` (matches the Marketplace account)
- **License**: source licensed under **Elastic License 2.0** (`Elastic-2.0`); `LICENSE.md` carries full ELv2; README gains a License section
- **Docs**: corrected stale MCP server reference (`svc-mcp-knowledge`, not a Supabase Edge Function)
- **Env / domains**: `AISHA_SUPABASE_*` → `AISHA_POSTGREST_*`; `n8n.aisha.guru` → `mcp.aisha.guru`

### Security
- Added ESLint security plugins (`eslint-plugin-security`, `no-secrets`)
- Excluded the internal security/test analysis doc and source maps from the published `.vsix`

---

## 0.4.4

### Added
- **Story Chat discussion flow**: Wired `onStoryChanged` event from StoryContext to StoryChatViewProvider; race condition guards in `loadConversation` and `sendMessage`
- **Ephemeral session story ID**: Highest-precedence story context via `setSessionStoryId()` — resolve order: session → config → file → none

### Fixed
- **Auth guardrails**: Expanded error code mapping — `forbidden` → `story_access_denied`, `not_found` → `story_not_found`; user-facing l10n error messages shown in webview
- **Auth param order**: Fixed `exchangeKcTokenForSession` parameter alphabetical ordering

### CI
- **Coverage thresholds**: Added v8 coverage thresholds (80% lines/functions/branches/statements) to vitest.config.ts

### Tests
- Added `story-context.test.ts` — session story ID precedence, resolve order coverage
- Extended `auth.test.ts` (+10 tests), added `StoryChatViewProvider` test suite (25 tests)
- Extended `story-service` and `story-context` coverage

---

## 0.4.3

- Authenticated fetch + device code auth
- Session story context
- SetupPanel/DashboardPanel extracted into dedicated modules

---

## 0.4.2

### Fixed
- **handleRoute dead-end**: Added MCP fallback when n8n agent is unavailable (was the only handler with zero fallback)
- **Error information leak**: Sanitized 6 `showErrorMessage` calls in `mcp-client.ts` — no longer exposes raw HTTP response bodies, JSON-RPC details, or internal URLs to the user
- **Chat error sanitization**: Added `sanitizeErrorForChat()` helper — strips internal URLs and truncates messages in all 5 error paths in `participant.ts`

### Docs
- Added 3 missing slash commands to README (`/story`, `/local`, `/connect-repo`)
- Fixed `/route` description to mention MCP fallback
- Fixed VSIX build docs (`--no-dependencies` required)
- Removed misleading "from marketplace" install reference

### Tests
- New `participant.test.ts` — command routing, error sanitization, handler table
- New `mcp-client.test.ts` — MCP transport, n8n delegation, extractMarkdown/extractJson, error sanitization assertions
- Fixed 10 tests in `config-writer.test.ts` to match universal baseline (Tier 3) behavior

### Build
- Added `--no-dependencies` to `vsce package` (fixes VSIX build with symlinked `@evymo/local-signals`)
- Updated `.vscodeignore` to exclude test files from VSIX
