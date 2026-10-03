# Secret Fingerprinting — Diagnostic Pattern

> Trace secrets across components without ever logging the raw value.

## Why

Distributed stacks pass shared secrets (tokens, HMACs, client_secret, etc.) between
components. When something fails (401, 403, signature mismatch), the operator needs to
answer: **"did the secret arrive at the recipient component intact?"**

Logging raw secrets is unacceptable (rotates them out of safety). Logging nothing leaves
the operator blind. **Fingerprints** are the middle ground: a deterministic short hash
that reveals nothing about the value but lets two logs be **visually compared**.

## Pattern

Format: `<12-char SHA-256 hex>/<length>`

- 12 hex chars = 6 bytes of entropy: enough to visually distinguish (collision rate ≈
  1 / 2^48), but computationally infeasible to brute-force back to the original.
- Length tag catches cases where two secrets share a prefix but differ in size (e.g.
  truncation during env propagation).
- Empty value renders as `(empty)` so operators can grep for that string to find
  unset secrets.

**JWT-specific:** fingerprint the **signature** segment only (`tok.split('.')[2]`).
Reveals nothing about claims, deterministic per (header, payload, signing key).

## Tools

### TypeScript (services/*)

Use [`services/svc-pki-bridge/src/fp.ts`](../../services/svc-pki-bridge/src/fp.ts) as a
template. Copy or adapt:

```ts
import { fp, fpJwt, fpKid } from './fp.js';

logger.info({ secret_fp: fp(client_secret) }, 'loaded client secret');
logger.info({ token_sig_fp: fpJwt(accessToken) }, 'received token');
logger.info({ key_fp: fpKid(header.kid) }, 'token sig key');
```

### Bash (scripts/* + infra/pki/*)

Source [`infra/lib/fingerprint.sh`](../../infra/lib/fingerprint.sh):

```sh
. "$(dirname "$0")/../infra/lib/fingerprint.sh"  # or wherever it lands in your image

echo "PKI_CLIENT_SECRET fp: $(fp "$PKI_BOOTSTRAP_CLIENT_SECRET")"
echo "access_token sig_fp: $(fp_jwt "$ACCESS_TOKEN")"
echo "ca-bundle file fp:   $(fp_file /staging/aisha-ca-bundle.pem)"
```

For Docker images that bake-in scripts, COPY `infra/lib/fingerprint.sh` to
`/usr/local/lib/fingerprint.sh`. The cert script auto-loads from that path.

## Cross-component comparison protocol

When secret X flows from component A → component B:

1. **At A (donor)**: log `fp(X)` immediately after generating/fetching.
2. **At B (recipient)**: log `fp(X)` immediately after loading from env/file.
3. **At any verification point**: log fp of the secret AND fp of what was expected.

To debug a mismatch:

```bash
# On donor (e.g. cold-start machine)
grep "AISHA_PKI_BOOTSTRAP_CLIENT_SECRET stored" $LOG
# → "...stored in .env.coolify (fp=a3f2c9d8b1e4/32)"

# On recipient (e.g. pki-init container on Frontend)
docker logs <pki-init> 2>&1 | grep "PKI_BOOTSTRAP_CLIENT_SECRET fp"
# → "PKI_BOOTSTRAP_CLIENT_SECRET fp : a3f2c9d8b1e4/32"

# Same fp = same secret, propagation OK.
# Different fp = env-injection bug or value rotation drift.
```

## Diagnostic endpoints

Long-running services should expose `/diag` (or extend `/health`) to publish the
fingerprints of their currently-loaded secrets plus relevant runtime state.

Example: `svc-pki-bridge` `/diag`:

```json
{
  "service": "svc-pki-bridge",
  "config": {
    "expected_issuer": "https://auth.backend.id3a.cz/realms/aisha",
    "expected_audience": "pki-proxy",
    "jwks_url": "https://auth.backend.id3a.cz/realms/aisha/protocol/openid-connect/certs"
  },
  "secrets_fp": {
    "openxpki_rpc_hmac": "8c1d4e3a9b27/64"
  },
  "jwks": {
    "reachable": true,
    "kids": ["23h42i_UsZUfiMVG35uaPvTpURaKb60Z8WqCob_q1Rc/RS256/sig"]
  }
}
```

An operator can `curl pki-bridge.backend.id3a.cz/diag` and compare:

- `openxpki_rpc_hmac` fp here vs. OpenXPKI's rendered `rpc-<realm>.yaml` `hmac:`
  field fp (must match — both sides need the same HMAC for RPC auth).
- `jwks.reachable=true` and `jwks.kids` contains the token's `kid`.

## Where this is wired today

| Component | File | What it fingerprints |
|---|---|---|
| `svc-pki-bridge` (TS) | `src/fp.ts` + `src/server.ts /diag` | HMAC, JWKS KIDs, runtime state |
| `svc-pki-bridge` auth | `src/auth.ts` | Token sig fp + JWKS state on rejection |
| `issue-netbird-mesh-cert.sh` (bash) | `infra/pki/issue-netbird-mesh-cert.sh` | client_secret, password, ACCESS_TOKEN, ca-bundle file |
| `aisha-bootstrap-user-init.sh` (bash) | `scripts/aisha-bootstrap-user-init.sh` | client_secret + password on store, ROPC verification token |

## Extending to other components

When you add a new secret-handling component:

1. **TypeScript:** copy `services/svc-pki-bridge/src/fp.ts` (or extract to a shared
   package once we have ≥3 services using it).
2. **Bash:** source `infra/lib/fingerprint.sh`. For Docker-baked scripts, COPY the
   helper into the image.
3. **Log donor side:** `fp` the secret immediately after generating/fetching.
4. **Log recipient side:** `fp` the secret immediately after loading.
5. **Add to /diag (TS) or `--diag` flag (bash):** report fingerprints of currently
   loaded state.

## What this is NOT

- Not a substitute for proper secret rotation. Fingerprints help debug propagation —
  they don't protect a leaked secret.
- Not a replacement for structured audit logs. Use this alongside, not instead of,
  audit logging for security-sensitive operations.
- Not for password verification or any auth decision. Fingerprints are diagnostic
  only — never compare them as a security check.
