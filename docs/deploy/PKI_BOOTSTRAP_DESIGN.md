# PKI Bootstrap — Integral Design Note

**Status:** Design doc / pre-implementation
**Owner:** cold-start orchestration
**Blocks:** `aisha-pki` deploy → cascades to `aisha-netbird` cert acquisition
**Created:** 2026-05-10 from cold-start v9 audit

## Why this exists

`aisha-pki` is currently in `KNOWN_BROKEN` because OpenXPKI 3.32.8 requires
first-time bootstrap (datasafe token + per-realm certsign aliases) that
`pki-init` does not perform. Without these tokens:

- `pki-server` healthcheck (`/usr/bin/openxpkictl status server`) returns
  unhealthy — server runs but has no signing capability and no datavault.
- Coolify `docker compose` reports "dependency failed" for `pki-client`
  (which depends on `pki-server: service_healthy`), so the entire stack
  deploy reports failed.
- Downstream: `aisha-netbird` uses `scripts/pki-issue-internal-cert.sh` to
  obtain its mesh-control-plane TLS cert from this PKI; with PKI broken the
  current workaround is Let's Encrypt + cert gap window.

## What OpenXPKI's first-boot procedure actually requires

Source: `openxpki-config/QUICKSTART.md` (the upstream config repo we vendor).

For a fresh OpenXPKI server to become healthy on a previously-empty database,
two classes of tokens must exist:

1. **Datasafe token** (one per server, shared across realms by default).
   Encrypts workflow data and database secrets at rest. Requires:
   - RSA 3072 key (`vault-1.pem`), encrypted with the `default` secret
     password from `config.d/system/crypto.yaml`.
   - X.509 self-signed certificate over that key (`vault-1.crt`).
   - Imported via `oxi certificate add --cert vault.crt`.
   - Registered via `oxi token add --realm <realm> --type datasafe --cert vault.crt`
     for each realm.

2. **Certsign token** (one per realm, here three: identity-plane,
   data-plane, orchestration-plane). The Root CA that issues all
   certificates within that realm. Requires:
   - EC P-384 key (the rest of AISHA's design uses CNSA 2.0; QUICKSTART
     example uses prime256v1 — we override to prime384).
   - Self-signed X.509 cert (`rootca.crt`).
   - Registered via `oxi token add --realm <realm> --type certsign --cert rootca.crt`
     which imports the cert, registers the alias, and stores the private
     key in the configured key store (default: database, encrypted with
     the realm's default secret).

`oxi` (the OpenXPKI CLI v3.32+) connects to the local server via the
unix socket `/run/openxpkid/openxpkid.sock`. It MUST run on the same host
as `pki-server` and have read access to the socket.

## Why this can't be a remote orchestration script

Patterns we already use (`aisha-bootstrap-user-init.sh`,
`netbird-bootstrap.sh`) call REST APIs from the operator workstation.
That works for Keycloak (admin REST API), NetBird (REST), Coolify (REST).

For OpenXPKI: the `oxi` CLI is the only sanctioned bootstrap path on a
fresh DB. The OpenXPKI RPC endpoint exists (`pki-bridge`) but requires
prior credential setup that itself depends on the datasafe/certsign
tokens being in place — chicken-and-egg.

Therefore: bootstrap MUST run inside a container that has socket access
to `pki-server` (volume `pki-socket` shared at `/run/openxpkid`).

## Integral design: compose-native init container

Add a new service to `docker-compose.coolify-pki.yml`:

```yaml
pki-realm-bootstrap:
  <<: *openxpki-image
  container_name: aisha-pki-realm-bootstrap
  restart: "no"
  user: "0:0"
  command: /usr/local/bin/pki-realm-bootstrap.sh
  environment:
    PKI_DEFAULT_SECRET: "${PKI_DEFAULT_SECRET:?Set PKI_DEFAULT_SECRET in Coolify env}"
    REALMS: "identity-plane data-plane orchestration-plane"
  volumes:
    - pki-config-rendered:/etc/openxpki:ro
    - pki-socket:/run/openxpkid
    - pki-keys:/etc/openxpki/local/keys
    - ./infra/pki/pki-realm-bootstrap.sh:/usr/local/bin/pki-realm-bootstrap.sh:ro
  depends_on:
    pki-server:
      condition: service_started   # NOT service_healthy — circular
  networks:
    - internal
```

And `pki-server`'s `depends_on` adds:

```yaml
pki-server:
  ...
  depends_on:
    pki-init: { condition: service_completed_successfully }
    pki-db:   { condition: service_healthy }
    # NEW (after first start, this only matters if the bootstrap
    # container has finished — handled by health-check loop)
```

Actually the cleaner pattern: `pki-client` depends on
`pki-realm-bootstrap: service_completed_successfully`, AND on
`pki-server: service_healthy`. `pki-server` becomes healthy only after
`pki-realm-bootstrap` registers the tokens. The init container is the
gate.

## Idempotency contract

The bootstrap script MUST detect already-bootstrapped state and exit 0
without re-keying. Detection:

1. `oxi alias list --realm identity-plane --type datasafe` — non-empty
   means datasafe is set.
2. `oxi alias list --realm <realm> --type certsign` for each realm —
   non-empty means certsign is set.

If both conditions hold for all realms, exit 0 immediately.

This is critical: every cold-start `--wipe` re-runs the init container,
but should not re-key (which would invalidate every cert ever issued).

## Bootstrap script outline

```bash
#!/bin/sh
set -eu

KEYS=/etc/openxpki/local/keys
CONTRIB=/etc/openxpki/contrib
mkdir -p "$KEYS"; chmod 755 "$KEYS"

# --- Wait for openxpkid socket ---
until oxi cli ping >/dev/null 2>&1; do
  echo "waiting for openxpkid socket..."
  sleep 2
done
echo "openxpkid responsive"

# --- Datasafe (idempotent) ---
if ! oxi alias list --realm identity-plane --type datasafe 2>/dev/null | grep -q vault-; then
  echo "creating datasafe vault-1..."
  cd "$KEYS"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 \
    -aes-256-cbc -pass "pass:${PKI_DEFAULT_SECRET}" \
    -out vault-1.pem
  openssl req -config "$CONTRIB/vault.openssl.cnf" -x509 -days 365 \
    -key vault-1.pem -passin "pass:${PKI_DEFAULT_SECRET}" \
    -out vault-1.crt
  oxi certificate add --cert vault-1.crt
  for realm in $REALMS; do
    oxi token add --realm "$realm" --type datasafe --cert vault-1.crt
  done
else
  echo "datasafe already configured"
fi

# --- Per-realm certsign (idempotent) ---
for realm in $REALMS; do
  if ! oxi alias list --realm "$realm" --type certsign 2>/dev/null | grep -q ca-signer-; then
    echo "creating certsign for $realm..."
    cd "$KEYS"
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:secp384r1 \
      -aes-256-cbc -pass "pass:${PKI_DEFAULT_SECRET}" \
      -out "rootca-${realm}.key"
    openssl req -config "$CONTRIB/rootca.openssl.cnf" -x509 -days 3650 \
      -key "rootca-${realm}.key" -passin "pass:${PKI_DEFAULT_SECRET}" \
      -subj "/CN=Aisha Root CA - ${realm}/O=AISHA/C=CZ" \
      -out "rootca-${realm}.crt"
    oxi token add --realm "$realm" --type certsign --cert "rootca-${realm}.crt"
  else
    echo "certsign for $realm already configured"
  fi
done

echo "PKI realm bootstrap complete"
```

## Open questions before implementation

1. **`oxi` binary location**: Is `oxi` on `$PATH` in
   `cache.aisha.guru/whiterabbitsecurity/openxpki3:3.32.8`? If not, we
   need the absolute path. (`openxpkictl` is at `/usr/bin/openxpkictl`
   per existing compose; `oxi` might be alongside.)

2. **`vault.openssl.cnf` + `rootca.openssl.cnf`**: These exist in
   `/etc/openxpki/contrib/` per upstream. Verify they're present in
   our config volume after `pki-init` populates it.

3. **Default secret password**: Currently `crypto.yaml` template has
   `__PKI_SVAULT_KEY__` substituted — that's the symmetric vault key.
   The `default` secret used to encrypt the issuer private key is a
   SEPARATE password. We need `PKI_DEFAULT_SECRET` env added to
   `cold-start.sh`'s secret generation + plumbed into both
   `pki-init` (template substitution) and `pki-realm-bootstrap` (key
   encryption).

4. **Per-realm vs shared CA**: Our design splits into 3 realms with
   independent CAs. Alternative: shared root + per-realm intermediates.
   The shared root simplifies trust bundle distribution
   (aisha-ca-bundle.pem) but couples realm cert revocation. Keep
   per-realm independent for now (matches existing `aisha-ca-bundle.pem`
   which is supposed to combine all roots).

5. **Coolify vs compose entrypoint**: Coolify v4 supports init-style
   containers via `restart: "no"`. The `pki-client` service can depend
   on `pki-realm-bootstrap: service_completed_successfully` per
   compose-spec. Verified pattern: matches how `pki-init` already
   works in this stack.

## Implementation phases

- **Phase 1 (this doc)**: design + verify in-image `oxi` availability,
  contrib/openssl config presence, default secret variable plumbing.
- **Phase 2**: implement `infra/pki/pki-realm-bootstrap.sh` + add
  `pki-realm-bootstrap` service in compose. Run cold-start --wipe to
  verify pki-server reaches healthy and pki-client follows.
- **Phase 3**: remove `aisha-pki` from `KNOWN_BROKEN` in
  `aisha-redeploy.mjs`. Cascade verify: `aisha-netbird` cert via
  `pki-issue-internal-cert.sh` succeeds against the bootstrapped PKI.
- **Phase 4**: gate test
  (`src/tests/gates/pki-bootstrap-integral.gate.test.ts`) enforces:
  - `pki-realm-bootstrap` service exists in compose
  - `infra/pki/pki-realm-bootstrap.sh` exists, has idempotency check
  - `pki-client` depends on `pki-realm-bootstrap` completion
  - `cold-start.sh` generates `PKI_DEFAULT_SECRET` if missing

## Why this isn't done in this commit

Each phase needs a verification cycle (deploy → log inspection → fix).
Implementing all phases as a single push without intermediate verification
risks landing a broken bootstrap that breaks something else. Following
the user's "musi to nabehnout od nuly" expectation: each phase's commit
must keep the cold-start ≥ today's 9/13 baseline.

This doc commits Phase 1 (the design + open questions). Phase 2 follows
once the open questions are resolved by image inspection.
