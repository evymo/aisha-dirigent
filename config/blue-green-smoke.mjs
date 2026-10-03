// =============================================================================
// blue-green-smoke.mjs — Per-app smoke test endpoints
// =============================================================================
// Konzumováno n8n WF_BLUE_GREEN_ORCHESTRATOR (přes HTTP fetch raw soubor z gitu)
// a `scripts/blue-green-deploy.sh` (manual fallback).
//
// Definuje smoke contract per app: po deploy do inactive slot, n8n workflow
// zavolá `internalUrl` (přes Docker network, ne přes Traefik) a očekává jeden
// z `expectedStatus` HTTP kódů. Pokud OK → promote, pokud fail → abort + alert.
//
// Klíče v `internalUrl`:
//   {slot}    → blue / green (vyplněno za běhu)
//   {short}   → app name bez aisha- prefix (keycloak, n8n, ...)
//
// Doplňková konfigurace:
//   timeout_ms   → max wait pro single HTTP request
//   retries      → kolikrát opakovat při transient fail (5xx, network)
//   retryDelayMs → wait mezi retries
//   exec_test    → opt-in: dodatečný integrační test v exec sandbox
//                  (n8n volá svc-agent-runner s test recipe)
// =============================================================================

export const smokeTests = {
  // ── Phase 1 pilot ─────────────────────────────────────────────────────────
  keycloak: {
    internalUrl: "http://aisha-keycloak-{slot}/health/ready",
    expectedStatus: [200],
    timeout_ms: 5000,
    retries: 5,
    retryDelayMs: 5000,
    exec_test: {
      enabled: false,  // Phase 2 — true až bude svc-agent-runner produkční
      recipe: "smoke/keycloak-oidc-flow",
    },
  },

  // ── Phase 2 (zatím nepřipraveno) ──────────────────────────────────────────
  orchestration: {
    internalUrl: "http://aisha-n8n-{slot}-main:5678/healthz",
    expectedStatus: [200],
    timeout_ms: 5000,
    retries: 5,
    retryDelayMs: 5000,
    exec_test: { enabled: false, recipe: "smoke/n8n-workflow-trigger" },
  },

  edge: {
    // Edge je nginx SPA — health = root returns 200 with index.html
    internalUrl: "http://aisha-web-{slot}/",
    expectedStatus: [200],
    timeout_ms: 3000,
    retries: 3,
    retryDelayMs: 3000,
    exec_test: { enabled: false, recipe: "smoke/edge-render" },
  },

  // ── Apps mimo B/G ─────────────────────────────────────────────────────────
  // core, pki, messaging, netbird, ledger, exec, registry, observability,
  // admin, integration — stateful nebo low-priority pro B/G v Phase 1.
  // Pokud bude later opt-in, rozšířit zde.
};

// Pomocná funkce (není volaná v config souboru, ale n8n workflow ji může inline použít)
export function resolveSmokeUrl(template, slot, short) {
  return template
    .replace(/\{slot\}/g, slot)
    .replace(/\{short\}/g, short);
}
