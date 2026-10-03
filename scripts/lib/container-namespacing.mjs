// =============================================================================
// container-namespacing.mjs — let a local-warmup stack coexist with the e2e stack
// =============================================================================
// Pure, side-effect-free. Used by scripts/local-compose-gen.mjs and gated by
// src/tests/gates/local-container-namespacing.gate.test.ts.
//
// WHY — the local-warmup stack (project `${LOCAL_STACK}`, per-implementation —
// see scripts/lib/local-stack-name.mjs), the e2e stack (project
// `evymo-ai-orchestrator`) and OTHER implementations' local stacks on the same
// machine all inherit the SAME `container_name: aisha-*` from the shared
// docker-compose.coolify*.yml files. Docker container names are GLOBAL, so such
// stacks cannot run at the same time (name collision — not a port clash).
// This recurringly blocked work whenever a parallel session held the e2e stack.
//
// FIX — rename each container_name to `${prefix}<orig>` (globally unique per
// implementation), and PRESERVE the original name as an alias on the local
// network so in-network service-to-service URLs (e.g. http://aisha-keycloak:80,
// http://aisha-db:5432) still resolve. Host-port publishing is per-container,
// so it is unaffected.
//
// Must run LAST in the generator — after everything that keys on the ORIGINAL
// container_name (matchHostPorts, applyHostClientAuthFix).
// =============================================================================

import { LOCAL_STACK } from "./local-stack-name.mjs";

const LOCAL_NET = LOCAL_STACK;

/**
 * Mutate the merged compose `doc` in place: namespace every container_name and
 * keep the original reachable via a local-network alias. Idempotent
 * (a container_name already prefixed is skipped).
 * @param {object} doc    merged compose doc ({ services: {...} })
 * @param {string} prefix e.g. `${LOCAL_STACK}__` (see local-stack-name.mjs)
 * @returns {object} the same doc
 */
export function namespaceContainerNames(doc, prefix) {
  for (const svc of Object.values(doc?.services ?? {})) {
    const orig = svc?.container_name;
    if (!orig || orig.startsWith(prefix)) continue;
    svc.container_name = prefix + orig;

    // Services using network_mode (e.g. core-mesh-ingress: network_mode: "service:netbird-agent")
    // share the network namespace of the referenced service. `networks` and `network_mode`
    // are mutually exclusive in Compose. Ensure no `networks` key is present (earlier
    // transforms or `docker compose config` normalization may have injected one).
    if (svc.network_mode) {
      delete svc.networks;
      // Do not create alias — the target service (netbird-agent) will carry the network.
      continue;
    }

    // Normal services get the local network with original name as alias
    // so in-network references (http://aisha-*:port) continue to work.
    svc.networks = withLocalAlias(svc.networks, orig);
  }
  return doc;
}

// Normalize a service's `networks` to object form and add `orig` as an alias on
// the local network (preserving any other networks / existing aliases).
function withLocalAlias(net, orig) {
  if (Array.isArray(net)) {
    const obj = {};
    for (const n of net) obj[n] = n === LOCAL_NET ? { aliases: [orig] } : null;
    if (!(LOCAL_NET in obj)) obj[LOCAL_NET] = { aliases: [orig] };
    return obj;
  }
  if (net && typeof net === "object") {
    const existing = net[LOCAL_NET] && typeof net[LOCAL_NET] === "object" ? net[LOCAL_NET] : {};
    const aliases = Array.isArray(existing.aliases) ? existing.aliases : [];
    return { ...net, [LOCAL_NET]: { ...existing, aliases: [...aliases, orig] } };
  }
  return { [LOCAL_NET]: { aliases: [orig] } };
}
