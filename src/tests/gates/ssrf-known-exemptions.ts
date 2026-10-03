/**
 * SSRF bare-fetch exemptions baseline (OWASP A10) — companion to
 * `ssrf-no-bare-fetch.gate.test.ts`.
 *
 * WHY THIS FILE EXISTS
 * The Semgrep rule `aisha-raw-fetch-outside-ssrf-guard` runs diff-aware in CI,
 * so it only blocks NEW bare `fetch(` in `services/`. This gate adds the same
 * invariant to the normal (semgrep-less) test lane, using a ratcheting baseline:
 * every service file that currently issues a bare `fetch(` is listed here with a
 * reason. The gate FAILS if a service file NOT listed here introduces a bare
 * `fetch(` — forcing new outbound surfaces through `@aisha/security/ssrf`
 * (`createSsrfGuard().safeFetch()`), which enforces scheme + host allowlist and
 * post-DNS IP blocking (loopback / link-local / RFC1918 / CGNAT / cloud-metadata).
 *
 * BURN-DOWN
 * These are pre-existing call sites to fixed / operator-configured hosts (env or
 * service manifest), NOT URLs derived from untrusted LLM/user input, so they are
 * not SSRF-exploitable today. They remain tracked so the list only shrinks. When
 * a file is migrated to `safeFetch`, remove it here (the gate flags stale rows).
 *
 * DO NOT add an entry for any module that fetches a URL derived from model/user
 * output (deep-research, web-search, SearXNG, tool-provided URLs). Those MUST use
 * the guard — see `FORBIDDEN_EXEMPTION_PATTERNS`.
 *
 * Generated once from the tree state; maintained by hand thereafter.
 */

/** repo-relative path -> reason it is allowed to use a bare fetch (for now). */
export const SSRF_FETCH_EXEMPTIONS: Readonly<Record<string, string>> = {
  "services/gateway/src/auth/cors-origins.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/gateway/src/routes/admin.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/gateway/src/routes/auth-email.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/gateway/src/routes/auth.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/gateway/src/routes/deployment-executor.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/gateway/src/routes/dev-patch.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/gateway/src/routes/functions.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/gateway/src/routes/health.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/gateway/src/routes/intranet.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/gateway/src/routes/public.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/gateway/src/routes/realtime.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/storage-auth/src/lib/upload-scan-promote.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/storage-auth/src/routes/download.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/storage-auth/src/routes/upload-preflight.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-agent-runner/src/db.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-agent-runner/src/netbird-client.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-ai-chat/src/lib/batchSubmitter.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-ai-chat/src/lib/mcpToolProxy.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-ai-chat/src/lib/orchestrationBridge.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-ai-chat/src/lib/tracer.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-ai-chat/src/reflection/checkpointer.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-ai-chat/src/reflection/nodes/openclaw.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-ai-chat/src/routes/benchmark.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-ai-chat/src/routes/flowboard-n8n-callback.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-ai-chat/src/routes/models.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-ai-chat/src/routes/openclaw-bridge.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-aisha-kronos-shim/src/lib/ragnarok-proxy.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-blockchain/src/lib/cosmos.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-blockchain/src/routes/gov-read.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-communications/src/sms-providers.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-fio-bank/src/routes/sync.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-github-app/src/lib/github-api.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-github-app/src/lib/github-jwt.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-github-app/src/routes/webhook-bridge.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-health-ai/src/routes/analyze-wearable.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-homeassistant/src/lib/ha-client.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-livekit/src/routes/recording.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-matrix/src/routes/webhook.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-mcp-knowledge/src/lib/embed-dispatcher.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-mcp-knowledge/src/lib/llm-completion.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-mcp-knowledge/src/routes/maestro.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-mcp-knowledge/src/routes/ragnarok.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-mcp-knowledge/src/routes/translate.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-packeta/src/packeta-feed.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-packeta/src/routes/create-packet.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-packeta/src/routes/track.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-pki-bridge/src/auth.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-pki-bridge/src/openxpki-rpc.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-pki-bridge/src/routes/diag.ts":
    "M-D6 (#655) moved the /diag OpenXPKI RPC probe here from server.ts; fixed operator-configured host (OpenXPKI RPC endpoint), NOT a URL from untrusted LLM/user input",
  "services/svc-playwright-runner/src/worker.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-plugin-system/src/llm-router.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-plugin-system/src/routes/broker.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-plugin-system/src/runner-client.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-plugin-system/src/sandbox.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-push/src/lib/fcm.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-push/src/routes/campaigns.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-push/src/routes/questionnaire-reminders.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-source-broker/src/routes/auth.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-web-artifact/src/lib/rpcClient.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-web-artifact/src/routes/parse.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
  "services/svc-web-artifact/src/server.ts":
    "pre-existing outbound call to a fixed / operator-configured host (baseline; NOT a URL from untrusted LLM/user input)",
};

/**
 * Paths matching any of these MUST NEVER be exempted — they fetch URLs that can
 * originate from untrusted (LLM / user / web) input and so must go through the
 * SSRF guard. The gate fails if an exemption key matches one of these.
 */
export const FORBIDDEN_EXEMPTION_PATTERNS: readonly RegExp[] = [
  /deep-?research/i,
  /web-?search/i,
  /searxng/i,
  /\/research\//i,
];
