#!/usr/bin/env bash
# Validate Fastify route files ("edge functions") after Edit/Write.
#
# Triggers on: PostToolUse Write|Edit on services/svc-*/src/routes/*.ts
# (also services/{gateway,storage-auth,event-worker,ws-gateway}/src/routes/*.ts
# and services/svc-aitg-probes/src/lib/probeShape.ts as DRY helper)
#
# Checks the seven mandatory layers from .claude/skills/aisha-edge-fn/SKILL.md:
#   1. Auth     — import from '../auth' (verifyToken/verifyAdmin)
#   2. Input    — Zod schema + validateBody from @aisha/security
#   3. AITG     — withAitgGuard for LLM-touching routes
#   4. SSRF     — guard.safeFetch for outbound HTTP
#   5. RPC      — rpcService/rpcUser (no supabase.rpc, no .from)
#   6. Error    — toPublicError on catch
#   7. Logger   — createSafeLogger (no console.log)
# Plus:
#   - No `as any` / `: any`
#   - No direct `process.env.X` (must use config.ts)
#
# Behavior: emit warnings to stderr (advisory, never blocks)
set -euo pipefail

TARGET=$(echo "${CLAUDE_HOOK_TOOL_INPUT:-}" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')

if [[ -z "$TARGET" ]]; then
  exit 0
fi

# Match Fastify route files in any service
if ! [[ "$TARGET" =~ /services/[^/]+/src/(routes/[^/]+|lib/probeShape)\.ts$ ]]; then
  exit 0
fi

# Skip non-existent files (deletes / renames)
if [[ ! -f "$TARGET" ]]; then
  exit 0
fi

# Skip test files and type-only declaration files
if [[ "$TARGET" =~ \.(test|spec|d)\.ts$ ]]; then
  exit 0
fi

CONTENT=$(cat "$TARGET" 2>/dev/null || echo "")
if [[ -z "$CONTENT" ]]; then
  exit 0
fi

WARNINGS=()

# ──────────────────────────────────────────────────────────────────────
# Layer 1 — Auth (must import from '../auth' or be auth.ts itself)
# Probes that use registerProbe() get auth via probeShape, so we exempt
# files that import registerProbe.
# ──────────────────────────────────────────────────────────────────────
USES_PROBESHAPE=0
if echo "$CONTENT" | grep -qE "from ['\"]\.\.?/lib/probeShape"; then
  USES_PROBESHAPE=1
fi

if [[ "$USES_PROBESHAPE" -eq 0 ]] \
   && ! echo "$CONTENT" | grep -qE "from ['\"]\.\.?/auth"; then
  # If file declares any HTTP handler, expect auth import
  if echo "$CONTENT" | grep -qE "app\.(get|post|put|patch|delete)\("; then
    WARNINGS+=("Layer 1 (Auth): no import from '../auth' detected; expected verifyToken/verifyAdmin wrapper")
  fi
fi

# ──────────────────────────────────────────────────────────────────────
# Layer 2 — Input validation (Zod via @aisha/security validateBody)
# Routes without a body (pure GET) are exempt.
# ──────────────────────────────────────────────────────────────────────
HAS_POST_PUT_PATCH=0
if echo "$CONTENT" | grep -qE "app\.(post|put|patch)\("; then
  HAS_POST_PUT_PATCH=1
fi
if [[ "$HAS_POST_PUT_PATCH" -eq 1 ]] && [[ "$USES_PROBESHAPE" -eq 0 ]]; then
  if ! echo "$CONTENT" | grep -qE "validateBody\(|z\.object\("; then
    WARNINGS+=("Layer 2 (Input): mutating handler without validateBody()/Zod schema")
  fi
fi

# ──────────────────────────────────────────────────────────────────────
# Layer 3 — AITG guard for LLM-touching routes
# Detect LLM SDK imports or aiChatUrl dispatch.
# ──────────────────────────────────────────────────────────────────────
TOUCHES_LLM=0
if echo "$CONTENT" | grep -qE "from ['\"](openai|@anthropic-ai/sdk|@google/generative-ai|cohere-ai)['\"]|aiChatUrl|/chat['\"]|dispatchProbeChat"; then
  TOUCHES_LLM=1
fi
if [[ "$TOUCHES_LLM" -eq 1 ]] && [[ "$USES_PROBESHAPE" -eq 0 ]]; then
  if ! echo "$CONTENT" | grep -qE "withAitgGuard|@aisha/aitg"; then
    WARNINGS+=("Layer 3 (AITG): LLM-touching route without withAitgGuard from @aisha/aitg")
  fi
fi

# ──────────────────────────────────────────────────────────────────────
# Layer 4 — SSRF safeFetch for outbound HTTP
# Detect raw fetch() calls (not safeFetch).
# ──────────────────────────────────────────────────────────────────────
# Match raw fetch( at start-of-line, after `=`, after `await `, or after `return ` —
# anything except `safeFetch`. The negative lookbehind via grep -P avoided for
# portability (Mac BSD grep lacks -P); use word-boundary + explicit context.
if echo "$CONTENT" | grep -qE "(^|[^a-zA-Z])fetch\(" \
   && ! echo "$CONTENT" | grep -qE "safeFetch\("; then
  # Heuristic exception: catalog-style string `'fetch'` (literal name not call)
  # is filtered by requiring `fetch(` immediately followed by paren.
  WARNINGS+=("Layer 4 (SSRF): raw fetch() without safeFetch/createSsrfGuard from @aisha/security")
fi

# ──────────────────────────────────────────────────────────────────────
# Layer 5 — RPC pattern (no supabase, no .from())
# ──────────────────────────────────────────────────────────────────────
if echo "$CONTENT" | grep -qE "supabase\.|SupabaseClient|createClient\(.*supabase"; then
  WARNINGS+=("Layer 5 (RPC): supabase.* is BANNED; use rpcService<T>() / rpcUser<T>() from rpcAdapter")
fi
if echo "$CONTENT" | grep -qE "\.from\(['\"][a-z_]+['\"]\)"; then
  WARNINGS+=("Layer 5 (RPC): direct .from('table') BANNED by CLAUDE.md; use RPC")
fi

# ──────────────────────────────────────────────────────────────────────
# Layer 6 — toPublicError on catch
# Routes that have try/catch should sanitize errors before reply.
# ──────────────────────────────────────────────────────────────────────
if echo "$CONTENT" | grep -qE "} catch \(" \
   && [[ "$USES_PROBESHAPE" -eq 0 ]]; then
  if ! echo "$CONTENT" | grep -qE "toPublicError"; then
    WARNINGS+=("Layer 6 (Error): catch block without toPublicError(); risk of leaking stack/internals")
  fi
fi

# ──────────────────────────────────────────────────────────────────────
# Layer 7 — Safe logger (no console.log/error/warn/info)
# ──────────────────────────────────────────────────────────────────────
if echo "$CONTENT" | grep -qE "^\s*console\.(log|error|warn|info|debug)\("; then
  WARNINGS+=("Layer 7 (Logger): console.* found; use createSafeLogger() from @aisha/security")
fi

# ──────────────────────────────────────────────────────────────────────
# Cross-cutting: no `as any` / `: any`
# ──────────────────────────────────────────────────────────────────────
if echo "$CONTENT" | grep -qE "(:\s*any\b|as any\b)"; then
  # Allow `Record<string, any>` only if commented as intentional
  if ! echo "$CONTENT" | grep -qE "Record<string,\s*unknown>"; then
    WARNINGS+=("Type safety: 'any' detected; use 'unknown' + type guard (CLAUDE.md Absolute Rule #2)")
  fi
fi

# ──────────────────────────────────────────────────────────────────────
# Cross-cutting: no direct process.env (must use config.ts)
# ──────────────────────────────────────────────────────────────────────
if echo "$CONTENT" | grep -qE "process\.env\.[A-Z_]+"; then
  WARNINGS+=("Config: direct process.env.X in route; centralize in src/config.ts")
fi

# ──────────────────────────────────────────────────────────────────────
# Emit advisory (never blocks)
# ──────────────────────────────────────────────────────────────────────
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo "📝 Fastify edge-fn advisory ($TARGET):" >&2
  for w in "${WARNINGS[@]}"; do
    echo "  ⚠ $w" >&2
  done
  echo "Skill reference: .claude/skills/aisha-edge-fn/SKILL.md" >&2
  echo "Gates: service-security.gate, owasp-discovery.gate, aitg-discovery.gate" >&2
fi

# ── Dirigent router-coach: cost-advisory (advisory-only, exit 0 always) ──
if [[ -f "$(dirname "$0")/../lib/session-cost.sh" ]]; then
  # shellcheck disable=SC1091
  source "$(dirname "$0")/../lib/session-cost.sh"
  sc_log_tool "Edit" 2>/dev/null || true
  sc_advise "${CLAUDE_SESSION_ID:-unknown}" 2>/dev/null || true
fi

exit 0
