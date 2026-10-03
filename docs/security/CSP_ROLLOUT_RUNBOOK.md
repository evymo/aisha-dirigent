# Content-Security-Policy Rollout Runbook — Phase 12 WP 4.7

> Snapshot 2026-05-20. Companion to `infra/caddy/Caddyfile.d/csp.caddy`.
> Builds on WP 4.4 (security headers) — adds the CSP layer.

## Goal

Lock down inline script injection (XSS class) via nonce-based CSP.
Replaces the implicit `'unsafe-inline'` default, blocks unsigned
inline scripts, and reports violations to Sentry for tracking.

| Header | Before WP 4.7 | After (Step 2) |
|---|---|---|
| Content-Security-Policy | (unset; browser permissive default) | nonce-based, no 'unsafe-inline' for scripts |
| Content-Security-Policy-Report-Only | (unset) | Step 1 transitional |

## Two-step rollout (NO BIG-BANG ENFORCE)

| Step | When | What | How |
|---|---|---|---|
| 1 | Week 1 | Report-Only mode | `import csp-report-only` in site blocks |
| ↳ Soak | 3+ days | Operator reviews `/csp-report` events in Sentry CSP UI | Fix offending inline scripts |
| 2 | Week 2 (when 0 violations for 3 days) | Enforce | `import csp-enforce` replaces `csp-report-only` |

Why two steps:
- CSP is a one-way switch for sites already using inline scripts/styles
- Report-Only surfaces every violation WITHOUT breaking users
- Operator fixes offending code OR adds nonces during the soak
- Only flip to enforce when the change has zero user impact

## Sentry PII filter — already done (in `src/lib/monitoring/sentry.ts`)

The Sentry PII filter is already comprehensive (committed pre-WP 4.7 but
satisfies WP 4.7 requirements). It uses `redactSensitive()` from
`src/lib/security/safeLogger.ts` and redacts FIVE event fields:

1. `event.message` (top-level error message)
2. `event.exception.values[].value` (each thrown exception)
3. `event.breadcrumbs[].message` + `breadcrumbs[].data` (console + user actions)
4. `event.extra` (extra context attached to the event)
5. `event.tags` (string tags that might contain identifiers)

`redactSensitive` patterns:
- Email
- UUID identifiers
- JWT tokens
- Bearer + apikey credentials

WP 4.7 adds NO new Sentry code — the existing setup meets spec.

## Step 1: Enable Report-Only

### Caddy compose (per-site)

Add `import csp-report-only` to each public-facing site block. Operator
mounts `infra/caddy/Caddyfile.d/csp.caddy` in the same way WP 4.4's
`security-headers.caddy` is mounted:

```yaml
volumes:
  - ./infra/caddy/Caddyfile.d:/etc/caddy/Caddyfile.d:ro
```

Then in each site block:

```caddy
:443 {
  import security-headers     # from WP 4.4
  import csp-report-only      # NEW (this WP, Step 1)
  reverse_proxy gateway:3001
}
```

### Wire `/csp-report` endpoint to Sentry

Add a separate site block in the same Caddyfile:

```caddy
/csp-report {
  reverse_proxy https://sentry.io/api/0/csp-report/{$SENTRY_PROJECT_ID}/?sentry_key={$SENTRY_PUBLIC_KEY}
}
```

Operator provides `SENTRY_PROJECT_ID` + `SENTRY_PUBLIC_KEY` via Coolify
env. These are public values (already exposed in the Sentry browser SDK
config) — safe to mount.

### Monitor violations

Open Sentry → Project Issues → filter by `issue.type:CSPReport`. Each
violation lists:
- `violated-directive` (e.g. `script-src`)
- `blocked-uri` (the URL or `inline` for inline scripts)
- `source-file` + `line-number` (where the offending code lives)

Common fixes:
- **Inline `<script>` tag**: add `nonce="{{nonce}}"` attribute, ensure
  Vite/server substitutes it with `{http.request.uuid}` placeholder
- **Inline event handler** (e.g. `onclick="..."`): refactor to
  `addEventListener` in an external script
- **Dynamic code execution APIs**: replace with JSON.parse or static dispatch
- **3rd-party widget loading scripts**: add to `script-src` allowlist
  in the CSP snippet (use specific origins, not 'unsafe-inline')

## Step 2: Flip to Enforce

After 3 consecutive days with zero new CSP violations in Sentry:

1. Edit each site block:
   ```caddy
   # Replace:
   import csp-report-only
   # With:
   import csp-enforce
   ```
2. `caddy reload` (no restart)
3. Watch Sentry for new CSP violations over next 7 days
4. If a regression appears → flip BACK to `csp-report-only`, fix code,
   re-soak before flipping again

## Vite HTML nonce substitution

Nonce placeholders in HTML need server-side substitution at render time.
The `{http.request.uuid}` placeholder is server-side (Caddy). Browser
gets a CSP header with the nonce value AND the HTML body with the same
nonce inlined.

Vite default doesn't have a CSP nonce plugin built-in. Options:
- **Manual**: rely on Caddy template module + post-build HTML
  substitution at delivery
- **Vite plugin**: `vite-plugin-csp-nonce` (community, ~3 kB)
- **Server-side render**: Vite SSR pre-renders HTML with nonce
  substitution (out of scope for current Vite SPA setup)

Recommended: defer nonce-substitution implementation to follow-up PR
(WP 4.7b). For now, ship the CSP snippet + run Report-Only mode +
collect violations. The set of inline scripts that need nonce
attention will reveal itself in Sentry CSP reports.

## Rollback

### From enforcing back to report-only (instant)
Replace `import csp-enforce` with `import csp-report-only`, `caddy reload`.

### Full removal
Remove both `import csp-*` lines + `/csp-report` endpoint, `caddy reload`.
No data loss. Sentry CSP-report queue empties naturally.

## Tunable parameters

| Parameter | File | Default | Notes |
|---|---|---|---|
| script-src 'unsafe-inline' | csp.caddy | NOT INCLUDED | Goal is enforce-mode without it |
| style-src 'unsafe-inline' | csp.caddy | INCLUDED (transition) | Revisit when CSS is fully externalized |
| connect-src origins | csp.caddy | `'self'`, `wss:`, `*.aisha.guru`, `*.backend.id3a.cz` | Add 3rd-party APIs as discovered |
| report-uri | csp.caddy | `/csp-report` | Sentry-managed; per-project URL |

## References

- WP 4.4 (companion, merged) — security headers (HSTS, X-Frame-Options, etc.)
- `src/lib/monitoring/sentry.ts` — already wired with PII filter
- `src/lib/security/safeLogger.ts` — `redactSensitive()` regex patterns
- Phase 12 plan WP 4.7
- MDN CSP: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
