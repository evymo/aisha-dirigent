// =============================================================================
// oidc-consumer-support.mjs — which OIDC consumers work in local-warmup, and why
// =============================================================================
// Pure, side-effect-free. Used by scripts/local-compose-gen.mjs (to warn) and
// gated by src/tests/gates/local-oidc-consumer-support.gate.test.ts.
//
// Background — the model-driven resolver (PR #336) decouples the token `iss`
// (host-facing 127.0.0.1:<port>) from the in-network JWKS/token fetch. That works
// for consumers that take EXPLICIT per-endpoint URLs:
//   - aisha-gateway / svc-mcp-knowledge / svc-plugin-system (KC_ISSUER + KC_JWKS_URL)
//   - oauth2-proxy admin UIs (OAUTH2_PROXY_SKIP_OIDC_DISCOVERY=true + explicit URLs)
//
// Matrix Synapse used to be one of them; it now takes explicit endpoints
// (`discover: false`), see coolify/synapse/homeserver.yaml.
//
// It CANNOT work for consumers that perform server-side OIDC **discovery** from a
// single issuer URL (used for BOTH the `.well-known` fetch AND `iss` validation):
// on local-warmup (no Traefik, no /etc/hosts) there is no single host:port that is
// reachable from inside a container AND equals the host-facing `iss` the browser
// used. Supporting them needs the full/e2e stack (Traefik) or a `.local` + hosts
// setup — out of scope for local-warmup's minimalist model.
//
// This is a TECHNOLOGY property (not derivable from compose alone — e.g. svc-matrix
// also carries KEYCLOAK_ISSUER but fetches JWKS explicitly via KEYCLOAK_URL, so it
// is NOT discovery-only), hence a small curated registry.
//
// What is affected is a HUMAN browser login into the service's own UI. AISHA itself
// never logs in there: it talks to Langfuse with project API keys and to OpenClaw
// with a bearer key — both work under local-warmup.
// =============================================================================

/**
 * Service name (the part of container_name after the instance prefix) → human
 * reason it can't complete OIDC login under local-warmup. Keyed by the SERVICE,
 * not by a full container_name: the prefix is the instance identity
 * (`<APP_NAME_PREFIX>-langfuse`, locally `local-langfuse`). The previous keys
 * were literal `aisha-*` names, so after the move to identity-derived names the
 * generator warning never matched anything (measured 2026-10-08).
 *
 * Matrix Synapse is NOT here any more: its config uses `discover: false` with
 * explicit endpoints (coolify/synapse/homeserver.yaml), which the local resolver
 * rewrites like any other explicit consumer.
 *
 * OpenClaw is NOT here either: svc-openclaw has no OIDC at all — every route
 * except /health takes `Authorization: Bearer $OPENCLAW_API_KEY`
 * (services/svc-openclaw/src/server.ts). The `AUTH_OIDC_*` it is handed in
 * compose is read by nothing (measured 2026-10-08).
 */
export const DISCOVERY_OIDC_CONSUMERS = {
  langfuse: "Langfuse UI sign-in for operators (NextAuth Keycloak provider — server-side discovery); AISHA → Langfuse uses API keys and is unaffected",
  "llm-gateway": "LLM Gateway dashboard SSO, if the image uses AUTH_OIDC_* (server-side discovery); API traffic uses keys and is unaffected",
};

/**
 * Return the discovery-only consumers present in the merged compose `doc`
 * (matched on the container_name ending in `-<service>` — call BEFORE
 * namespaceContainerNames, which prepends the stack namespace).
 * @param {object} doc
 * @returns {string[]} sorted container_names
 */
export function findDiscoveryConsumersInStack(doc) {
  const present = [];
  for (const svc of Object.values(doc?.services ?? {})) {
    const cn = svc?.container_name;
    if (!cn) continue;
    if (Object.keys(DISCOVERY_OIDC_CONSUMERS).some((sluzba) => cn.endsWith(`-${sluzba}`))) {
      present.push(cn);
    }
  }
  return present.sort();
}
