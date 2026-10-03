/**
 * Shared runtime contract for IDE instruction surfaces.
 * Keep this focused on cross-stack boundaries: gateway/API, env topology,
 * plugin isolation, and generated function routes.
 */

function heading(headerStyle) {
  return headerStyle === "markdown_h3" ? "###" : "##";
}

export function runtimeContractFragment({ headerStyle = "markdown_h2" } = {}) {
  const h = heading(headerStyle);
  return [
    `${h} AISHA Runtime Contract`,
    "",
    "- Treat AISHA Gateway as the only app-facing backend surface: `/rest/v1/rpc/*`, `/functions/v1/*`, `/admin/*`, and MCP URLs from `.well-known/app-config.json`.",
    "- Use `@aisha/api-core`, generated RPC types, and `api.rpc(...)` / `api.invoke(...)` contracts. Do not create parallel raw " +
      "Supa" +
      "base/Postgres clients in editor plugins or mobile/desktop shells.",
    "- Bring up local services with `npm run stack:bringup`; run `npm run gen:ide` after runtime, env, or rule changes so Cursor/Windsurf/Zed/Claude/Codex surfaces stay aligned.",
    "- Plugin execution is isolated through `svc-plugin-system` and `svc-agent-runner`; broker tokens require `BROKER_TOKEN_SECRET` and plugin LLM calls must go through `/functions/v1/ai-generate`, not vendor APIs.",
    "- Environment and dynamic functions are generated from `config/local-presets.mjs`, `scripts/render-app-config.mjs`, `scripts/local-compose-gen.mjs`, and gateway `ROUTE_TABLE`. Add a route/table/env entry before referencing a new function.",
    "",
  ].join("\n");
}
