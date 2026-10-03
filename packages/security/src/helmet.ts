/**
 * OWASP A05 — Security Misconfiguration: HTTP security headers.
 *
 * Default-deny configuration suitable for API services. Frontend services
 * (vite/web) need a different CSP — they should override `contentSecurityPolicy`.
 *
 * Header rationale:
 * - `X-Content-Type-Options: nosniff` — prevents MIME confusion attacks.
 * - `X-Frame-Options: DENY` — blocks clickjacking even on legacy browsers.
 * - `Strict-Transport-Security` — enforces HTTPS for 1y including subdomains.
 * - `Referrer-Policy: no-referrer` — strips Referer headers entirely.
 * - `Permissions-Policy` — disables camera/microphone/geolocation by default.
 * - `Cross-Origin-*` — locks the origin's window/process to itself.
 */

export interface HelmetConfigOptions {
  /** Set to true for browser-facing services (web/gateway). API services use false. */
  enableContentSecurityPolicy?: boolean;
  /** Override CSP directives — only used when `enableContentSecurityPolicy=true`. */
  cspDirectives?: Record<string, string[]>;
  /** When false, omits HSTS — useful for local-dev where HTTPS is absent. */
  enableHsts?: boolean;
}

/**
 * Returns options object compatible with `@fastify/helmet` v11+.
 * Caller is responsible for `app.register(helmet, buildHelmetOptions(...))`.
 */
export function buildHelmetOptions(opts: HelmetConfigOptions = {}): Record<string, unknown> {
  const { enableContentSecurityPolicy = false, cspDirectives, enableHsts = true } = opts;

  const base: Record<string, unknown> = {
    contentSecurityPolicy: enableContentSecurityPolicy
      ? {
          useDefaults: true,
          directives: cspDirectives ?? {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    hsts: enableHsts
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
    ieNoOpen: true,
    noSniff: true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    referrerPolicy: { policy: 'no-referrer' },
    xssFilter: true,
  };

  return base;
}

/** Permissions-Policy header value — disables sensitive browser APIs by default. */
export const DEFAULT_PERMISSIONS_POLICY =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';
