# mTLS gateway ↔ backend runbook — Phase 12 WP 3.3

> **Snapshot 2026-05-20**. Owner: DevOps + Backend security.
> **Status (Phase A — this PR)**: Operator runbook + gate lock on
> existing PKI infrastructure. **Status (Phase B — follow-up)**: actual
> Caddy + Fastify mTLS enforcement flip (needs maintenance window +
> per-host testing).

## TL;DR

Even with WP 3.4 Docker network segmentation enforcing **reachability**
boundaries between zones, the gateway ↔ backend hop traverses the
backend zone in plaintext HTTP. WP 3.3 closes that gap with **mTLS**:
every backend service authenticates the gateway's client cert before
accepting requests, and the gateway authenticates the backend's server
cert.

Threat closed: a passive observer on the backend zone (e.g. a misbehaving
sidecar, a compromised peer service) can no longer read gateway→backend
request bodies (which contain JWT bearer headers + RPC payloads).

## §1 What's already in place (Phase A — locked by this PR's gate test)

The PKI bridge + cert issuance + rotation primitives ship in AISHA's
main and are now gate-locked by `wp-3-3-mtls-infra.gate.test.ts`:

| Layer | Artefact | Purpose |
|---|---|---|
| Service | `services/svc-pki-bridge/` | HTTP wrapper around OpenXPKI workflows — issues internal certs on demand |
| Route | `services/svc-pki-bridge/src/routes/issue.ts` | `POST /issue` — caller authenticates, gets back PEM-encoded cert + key |
| Script | `scripts/pki/rotate-cert.sh` | Zero-downtime rotation: request new cert, rolling restart, health check |
| Script | `scripts/pki/gen-trust-bundle.sh` | Assemble system CA + AISHA internal CA → trust bundle for clients |
| Script | `scripts/pki/health-check.sh` | Verify a service's cert chain end-to-end |
| Script | `scripts/pki/bootstrap-ca.sh` | One-time CA bootstrap (OpenXPKI realm setup) |

### Existing gate tests (NOT this PR — already lock the PKI bridge)

- `pki-bridge.gate.test.ts` — autonomous cert issuance contract
- `pki-bridge-hmac.gate.test.ts` — OpenXPKI HMAC auth contract
- `pki-bridge-routing-integral.gate.test.ts` — cross-server routing

This PR's `wp-3-3-mtls-infra.gate.test.ts` adds the **mTLS-specific**
contract on top.

## §2 What this PR ships (Phase A)

1. **Gate test** locking the mTLS-relevant invariants in the PKI
   infrastructure:
   - `svc-pki-bridge/routes/issue.ts` exists with auth + cert issuance
   - `scripts/pki/rotate-cert.sh` exists, executable, has rolling
     restart semantics with health check
   - `scripts/pki/gen-trust-bundle.sh` exists + emits system+AISHA CA
   - `scripts/pki/health-check.sh` exists + checks chain end-to-end
2. **This runbook** for the Phase B operator-driven enforcement flip.

## §3 What this PR does NOT ship (Phase B — follow-up)

- **Caddy** `tls_client_auth` snippet on the gateway → backend
  reverse-proxy routes (needs the per-host cert bundle pre-deployed,
  with maintenance window for the flip)
- **Fastify** mTLS plugin that wraps `applySecurity` and rejects
  non-client-cert connections (needs Coolify env wiring + per-svc
  cert mount)
- Per-svc cert issuance via the PKI bridge (needs a fleet-wide
  Coolify env update with the bundle paths)
- Actual mTLS enforcement enabling

Phase B is **operator-driven**, NOT a code-only PR — it requires
coordinated rollout across all backend services so a missed service
doesn't cause a 100% production outage.

## §4 Phase B rollout sequence (operator, per service)

### Step 1: Provision the cert via PKI bridge

For each backend service (gateway, svc-ai-chat, svc-mcp-knowledge,
svc-web-artifact, svc-ide-context, …):

```bash
# Run from a host with svc-pki-bridge reachable
curl -sS -X POST https://pki-bridge.backend.id3a.cz/issue \
  -H "Authorization: Bearer ${PKI_BRIDGE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "realm": "orchestration-plane",
    "profile": "tls_server",
    "common_name": "svc-ai-chat.aisha-backend-net",
    "subject_alt_names": ["svc-ai-chat", "aisha-svc-ai-chat"],
    "validity_seconds": 86400
  }' > /tmp/svc-ai-chat.json

# Extract PEM + key + chain into /config/pki/svc-ai-chat/
jq -r .cert    /tmp/svc-ai-chat.json > /config/pki/svc-ai-chat/cert.pem
jq -r .key     /tmp/svc-ai-chat.json > /config/pki/svc-ai-chat/key.pem
jq -r .chain   /tmp/svc-ai-chat.json > /config/pki/svc-ai-chat/chain.pem
chmod 600 /config/pki/svc-ai-chat/key.pem
```

Per-service certs use the **24-hour TTL** per plan §3.3 — short-lived
certs reduce blast radius if a private key leaks.

### Step 2: Deploy trust bundle to all services

```bash
bash scripts/pki/gen-trust-bundle.sh > /config/pki/trust-bundle.pem
```

The trust bundle includes:
- System CAs (Mozilla bundle)
- AISHA internal CA (OpenXPKI realm signing cert)

Every service mounts `/config/pki/trust-bundle.pem` as
`NODE_EXTRA_CA_CERTS` so HTTPS clients trust the internal CA.

### Step 3: Enable mTLS at the Caddy gateway

```caddy
# /etc/caddy/Caddyfile.d/mtls-backend.caddy (operator-supplied overlay)
*.backend.aisha-mtls {
  tls /config/pki/gateway/cert.pem /config/pki/gateway/key.pem
  reverse_proxy svc-ai-chat:3000 {
    transport http {
      tls
      tls_client_auth /config/pki/gateway/cert.pem /config/pki/gateway/key.pem
      tls_trusted_ca_certs /config/pki/trust-bundle.pem
    }
  }
}
```

### Step 4: Enable mTLS at each backend Fastify service

```ts
// services/svc-ai-chat/src/server.ts (Phase B follow-up)
import { applyMtls } from "@aisha/security";

await applyMtls(app, {
  certPath: "/config/pki/svc-ai-chat/cert.pem",
  keyPath: "/config/pki/svc-ai-chat/key.pem",
  trustBundlePath: "/config/pki/trust-bundle.pem",
  requireClientCert: process.env.AISHA_MTLS_ENFORCE === "true",
});
```

The `requireClientCert` flag is env-gated so operators can deploy
**without** enforcement first (cert plumbing works, but connections
without client cert still succeed), then flip the env to enforce
once all peers are wired.

### Step 5: Verify (negative-path test)

```bash
# From a peer that DOES have the client cert
curl --cert /config/pki/svc-mcp-knowledge/cert.pem \
     --key  /config/pki/svc-mcp-knowledge/key.pem \
     --cacert /config/pki/trust-bundle.pem \
     https://svc-ai-chat:3000/health
# → 200 OK

# From a peer WITHOUT the client cert (e.g. svc-plugin-system intentionally
# unenrolled in mTLS to prove the gate works)
curl https://svc-ai-chat:3000/health
# → 401 Unauthorized (or connection refused, depending on enforcement layer)
```

### Step 6: Cert rotation (every 12h ahead of 24h TTL)

Existing `scripts/pki/rotate-cert.sh` handles this:

```bash
bash scripts/pki/rotate-cert.sh \
  --realm orchestration-plane \
  --profile tls_server \
  --hostname svc-ai-chat \
  --services aisha-svc-ai-chat
```

Schedule via n8n: cron at 02:00 + 14:00 UTC daily, rolling rotation
across all backend services.

## §5 Rollback (Phase B)

### Per-service (instant, env-flag)

```bash
# In Coolify env for the affected service
AISHA_MTLS_ENFORCE=false
# Redeploy. Connections without client cert succeed again.
```

mTLS infrastructure stays in place (certs, trust bundle, Caddy
config) — just enforcement disabled.

### Gateway-side (instant)

Remove the `tls_client_auth` line from the Caddy snippet, reload Caddy.
The gateway falls back to plain HTTPS without mTLS — backend services
still verify the gateway's cert if they're in enforce mode (they'd
reject the connection — coordinate the rollback with the next step).

### Cert revocation (only on confirmed compromise)

If a private key leaks:

```bash
# Run from the OpenXPKI host
openxpkiadm certificate revoke \
  --serial <serial-from-cert> \
  --reason key_compromise
```

Then `rotate-cert.sh` issues a fresh cert + the trust bundle (which
includes the CRL) stops trusting the old serial.

## §6 Operational guards (Phase B locked by future WP 3.3b gate)

| Guard | Mechanism |
|---|---|
| Short cert TTL (24h) | PKI bridge `validity_seconds=86400` per issuance call; rotation cron at 12h cadence |
| Per-service certs | Common Name = `<svc-name>.aisha-backend-net`; no shared private keys |
| Trust bundle includes internal CA | `gen-trust-bundle.sh` concatenates system + AISHA CA |
| Key file mode 600 | `chmod 600 key.pem` in §4 step 1 |
| Env-gated enforcement | `AISHA_MTLS_ENFORCE` toggle for staged rollout |
| Rotation = rolling restart | `rotate-cert.sh` waits for health check between restarts |
| CRL distribution | Trust bundle includes CRL; revoked certs reject within 24h |

## §7 Cost projection

| Component | Cost |
|---|---|
| OpenXPKI workflow per cert issuance | ~$0 (self-hosted on aisha-pki) |
| Cert rotation cron (n8n) | ~$0 (existing n8n stack) |
| One-time bundle deployment | ~30 min operator time |
| Per-service mTLS rollout (Phase B) | ~1 hour per backend service, ~6 services |

**Total operator effort for Phase B**: ~7 hours over a maintenance
window (or ~1 hour/svc spread across 6 days for safe staged rollout).

**Marginal runtime cost**: TLS handshake adds ~5ms per connection. For
intra-cluster HTTP/2 with connection reuse, this is negligible (one
handshake per minute per connection pool).

## §8 Related WPs

- **WP 3.4** Docker network segmentation — **complementary** defense.
  Net seg enforces **reachability** (no IP route to data-net from
  plugin sandbox); mTLS enforces **authentication** (every request
  carries client cert proof). Both must hold for full defense-in-depth.
- **WP 3.5** JWT revocation cache — at the application layer, mTLS
  is the transport layer. They compose: mTLS verifies the calling
  service identity, JWT revocation catches stolen user tokens, RLS
  enforces per-row visibility.
- **WP 3.7** Secrets management — cert + key files are secrets. Use
  the Coolify v4 native secret management (per WP 3.7 investigation)
  to mount `/config/pki/<svc>/*.pem` files instead of env vars.

## §9 References

- Plan §-1.12 §3.3 — original WP 3.3 spec
- `services/svc-pki-bridge/` — existing PKI bridge service
- `services/svc-pki-bridge/src/routes/issue.ts` — cert issuance route
- `scripts/pki/rotate-cert.sh` — zero-downtime cert rotation
- `scripts/pki/gen-trust-bundle.sh` — trust bundle assembly
- `scripts/pki/health-check.sh` — cert chain verification
- Existing gate tests: `pki-bridge.gate.test.ts`,
  `pki-bridge-hmac.gate.test.ts`, `pki-bridge-routing-integral.gate.test.ts`
- This PR's gate test: `src/tests/gates/wp-3-3-mtls-infra.gate.test.ts`
- `feedback_aisha_capability_applied_not_new` — this runbook locks
  + documents the existing PKI infrastructure, doesn't introduce
  new orchestrators
- `feedback_no_workarounds_rewrite_dont_remove` — Phase B is staged
  for operator-driven rollout; not a code-only PR that would risk
  a production outage if any service was missed in the flip
