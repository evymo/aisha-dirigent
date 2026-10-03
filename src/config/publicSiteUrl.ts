const readNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Získá veřejnou URL aplikace.
 * 
 * Používá se pro generování odkazů (např. v emailech) a redirecty.
 * V produkci vyžaduje nastavení `VITE_PUBLIC_SITE_URL`.
 * V dev prostředí může použít `window.location.origin`.
 * 
 * @returns Normalizovaná URL (origin)
 * @throws Error pokud URL není nastavena nebo je localhost v produkci
 */
export function getPublicSiteOrigin(): string {
  // Access Vite env directly - the generic getMetaEnv() can return {} in some edge cases
  const env = import.meta.env as Record<string, unknown>;

  // Use an explicit public origin when the frontend is not served from the same origin
  // as the instance that should handle auth redirects.
  const configured = readNonEmptyString(env.VITE_PUBLIC_SITE_URL);
  const gatewayConfigured = readNonEmptyString(env.VITE_AISHA_GATEWAY_URL);

  const isDev = Boolean(env.DEV);
  const fallback = typeof window !== 'undefined' ? window.location.origin : undefined;
  // In prod we fail-closed unless explicitly configured; in dev we allow fallback.
  const candidate = configured ?? (isDev ? fallback : undefined);

  if (!candidate) {
    throw new Error('Missing public site origin. Set VITE_PUBLIC_SITE_URL.');
  }

  const normalizeOrigin = (value: string): string => {
    try {
      return new URL(value).origin;
    } catch {
      return value;
    }
  };

  const origin = normalizeOrigin(candidate);
  const gatewayOrigin = gatewayConfigured ? normalizeOrigin(gatewayConfigured) : undefined;

  if (gatewayOrigin && origin === gatewayOrigin) {
    throw new Error(
      'Invalid public site origin. VITE_PUBLIC_SITE_URL points to the AISHA gateway API host; set it to the web app domain.'
    );
  }

  // Safety: never generate auth redirect URLs to localhost/loopback in production.
  // This prevents onboarding links in signup emails from pointing at dev machines.
  // Exception: allow localhost in E2E test mode (VITE_E2E=true).
  const isE2E = Boolean(env.VITE_E2E);
  if (!isE2E) {
    try {
      const { hostname } = new URL(origin);
      const isLocalhost =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname.endsWith('.localhost');
      if (isLocalhost) {
        throw new Error('Refusing to use localhost as public site origin. Set VITE_PUBLIC_SITE_URL to your real web URL.');
      }
    } catch {
      // If parsing fails, keep the previous behavior and return the raw string.
    }
  }

  return origin;
}

export function buildPublicUrl(pathname: string): string {
  return new URL(pathname, getPublicSiteOrigin()).toString();
}
