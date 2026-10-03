# Caddy Hardening Runbook — Phase 12 WP 4.4

> Snapshot 2026-05-20. Companion to `infra/caddy/Caddyfile.d/security-headers.caddy`
> + `infra/caddy/Caddyfile.aisha-defaults`.

## Goal

Bring AISHA's edge Caddy proxies up to 2026-grade defaults:

| Feature | Today | After WP 4.4 |
|---|---|---|
| HTTP/3 (QUIC) | not enabled | enabled (UDP 443) |
| Brotli compression | not enabled | enabled (preferred over gzip) |
| HSTS preload | unset | 2-year + includeSubDomains + preload |
| X-Frame-Options | unset | DENY |
| X-Content-Type-Options | unset | nosniff |
| Referrer-Policy | browser-default | strict-origin-when-cross-origin |
| Permissions-Policy | unset | geo/cam/mic/payment/usb denied |

## Where Caddy lives

Multiple Caddy instances in the stack:
- **Coolify edge proxy** (managed by Coolify) — owns `aisha.guru` /
  `backend.id3a.cz` TLS termination, routes to per-app backends
- **`core-mesh-ingress`** in `docker-compose.coolify.yml` — sidecars
  netbird-agent for mesh→localhost traffic
- **`mesh-router`** stacks — split-arch edge for *.aisha.guru →
  NetBird mesh
- **Several per-stack reverse proxies** (langfuse, admin, etc.) —
  passthrough patterns

This WP ships the **canonical snippet pattern**. Operator adopts it per
Caddy instance via `import`.

## Deploy procedure

### 1. Mount the snippet directory

Per Caddy compose entry, add:

```yaml
volumes:
  - ./infra/caddy/Caddyfile.d:/etc/caddy/Caddyfile.d:ro
```

### 2. Reference the snippet in each site block

In the inline `cat > /etc/caddy/Caddyfile <<'CADDY' … CADDY` heredoc
(per existing pattern in `docker-compose.coolify.yml::core-mesh-ingress`):

```caddy
import /etc/caddy/Caddyfile.d/*.caddy

:443 {
  import security-headers          # <- AISHA convention
  reverse_proxy upstream:port
}
```

### 3. Enable HTTP/3 globally (per-Caddy-instance)

Add to the global block (top of Caddyfile):

```caddy
{
  servers {
    protocols h1 h2 h3
  }
  encode zstd br gzip
}
```

### 4. Open UDP 443 on the firewall

HTTP/3 = QUIC over UDP 443. If pfSense / Frontend firewall blocks UDP by
default, add the rule. Per `feedback_pfsense_ratelimit.md`, beware of
rate-limit blocks if you probe heavily during testing.

### 5. HSTS preload submission (one-time, after 7-day soak)

After all sub-domains have been serving HSTS for at least 7 days with no
breakage:
- Submit `aisha.guru` at https://hstspreload.org/
- Submit `backend.id3a.cz` at https://hstspreload.org/

**Important**: HSTS preload is one-way — once Chrome / Firefox / Safari
ship the new preload list, removing it can take months. Don't submit
unless you're confident every sub-domain has valid TLS.

## Verify

```bash
# 1. HSTS header present (long max-age)
curl -sI https://app.aisha.guru | grep -i strict-transport
# Expected: Strict-Transport-Security: max-age=63072000; includeSubDomains; preload

# 2. X-Frame-Options + nosniff + Referrer-Policy + Permissions-Policy
curl -sI https://app.aisha.guru | grep -iE '^(x-frame|x-content|referrer|permissions)'

# 3. HTTP/3 negotiated
curl -I --http3 https://app.aisha.guru
# Look for `HTTP/3` in response status line.
# (curl must be built with HTTP/3 support — check `curl --version`.)

# 4. Brotli serving (size comparison)
curl -sI -H 'Accept-Encoding: br'   https://app.aisha.guru/ | grep -i content-encoding
# Expected: content-encoding: br

# 5. ALPN advertised
openssl s_client -connect app.aisha.guru:443 -alpn h3,h2,http/1.1 </dev/null 2>/dev/null \
  | grep -i 'ALPN'
```

## Rollback

Remove the `import security-headers` lines from each site block (or
unmount the Caddyfile.d directory). Then `caddy reload`. No restart
needed. The site continues serving HTTP/1.1+H2 with previous headers.

For HSTS preload rollback specifically: Chrome / Firefox honour the
preload list cache for ~1 year. Remove `preload` flag in your Caddyfile
to stop adding NEW clients, but existing preloaded clients still enforce
HSTS for up to 1 year after they last visited. This is by design —
treat HSTS preload as a one-way ratchet.

## Tunable parameters

| Parameter | File | Default | Notes |
|---|---|---|---|
| HSTS max-age | `security-headers.caddy` | 63072000 (2y) | Per hstspreload.org guidance |
| Permissions-Policy list | `security-headers.caddy` | geo/cam/mic/payment/usb denied | Add feature when actually used |
| Compression preference | `Caddyfile.aisha-defaults` | zstd, br, gzip | Caddy picks best per Accept-Encoding |
| Max header size | `Caddyfile.aisha-defaults` | 16KB | Coolify + NetBird + auth headers stack up |

## References

- Phase 12 plan WP 4.4 spec
- HSTS preload: https://hstspreload.org/
- Caddy HTTP/3 docs: https://caddyserver.com/docs/caddyfile/options#protocols
- WP 4.7 follow-up: CSP (Content-Security-Policy) nonce-based, ships separately
- `feedback_pfsense_ratelimit.md` — beware UDP probe rate-limits during testing
