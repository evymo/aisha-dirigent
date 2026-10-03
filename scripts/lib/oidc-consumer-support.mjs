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
// =============================================================================

/** container_name → human reason it can't complete OIDC login under local-warmup. */
export const DISCOVERY_OIDC_CONSUMERS = {
  "aisha-langfuse": "Langfuse (NextAuth Keycloak provider — server-side discovery)",
  "aisha-llm-gateway": "LLM Gateway (server-side OIDC discovery)",
  "aisha-openclaw": "OpenClaw (server-side OIDC discovery)",
  "aisha-synapse": "Matrix Synapse (oidc_providers — no explicit JWKS split in config)",
};

/**
 * Return the discovery-only consumers present in the merged compose `doc`
 * (matched by their ORIGINAL container_name — call BEFORE namespaceContainerNames).
 * @param {object} doc
 * @returns {string[]} sorted container_names
 */
export function findDiscoveryConsumersInStack(doc) {
  const present = [];
  for (const svc of Object.values(doc?.services ?? {})) {
    const cn = svc?.container_name;
    if (cn && Object.prototype.hasOwnProperty.call(DISCOVERY_OIDC_CONSUMERS, cn)) {
      present.push(cn);
    }
  }
  return present.sort();
}
