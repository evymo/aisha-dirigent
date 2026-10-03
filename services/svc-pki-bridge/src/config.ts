import { requireEnv } from '@aisha/security';
/**
 * Adresa jiné služby se NEHÁDÁ.
 *
 * ⛔ NAMĚŘENO 2026-08-19. Dřív tu stálo `?? 'http://aisha-<služba>:port'` —
 * dvojí vada: jméno CIZÍ instance (`aisha`, my jsme `riq`) a TICHÝ default.
 * Když proměnná dorazí, funguje to a nikdo nic nepozná; když nedorazí, služba
 * se mlčky připojí jinam. A na sdíleném Coolify hostiteli `aisha-keycloak`
 * NENÍ neexistující jméno — je to skutečný cizí kontejner, takže by se identita
 * tiše zaměnila místo hlasitého selhání.
 *
 * Chybějící adresa proto službu zastaví PŘI STARTU, u zdroje — ne o tři vrstvy
 * dál na záhadném 401 nebo timeoutu. Prázdný řetězec je totéž co chybějící.
 */
function vyzadovanaAdresa(klic: string, kSluzbe: string): string {
  const v = process.env[klic];
  if (v && v.trim()) return v.trim();
  throw new Error(
    `${klic} není nastavené (adresa služby ${kSluzbe}) — adresa se NEHÁDÁ.\n` +
      `  Výchozí hodnota by ukázala na kontejner JINÉ instance; na sdíleném hostiteli\n` +
      `  by to byla cizí běžící služba, tedy tichá záměna identity.\n` +
      `  Doručuje ji cold-start (scripts/coolify-sync-envs.sh) z .env.coolify.`,
  );
}

export const config = {
  port: parseInt(process.env.SVC_PKI_BRIDGE_PORT ?? process.env.PORT ?? '3040', 10),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',

  // ── Keycloak OIDC (JWT validation) ──
  //
  // Two URLs here, both pointing at the same KC, but used for different purposes:
  //
  //   1. `keycloakUrl` (PUBLIC canonical) — used to compute the expected `iss`
  //      claim. Must EXACTLY match what KC puts in the token's `iss`, which is
  //      derived from KC_HOSTNAME.
  //
  //   2. `keycloakInternalUrl` (INTERNAL Docker DNS) — used to fetch the JWKS.
  //      Backend-to-backend on the shared `coolify` Docker network can reach KC
  //      directly via its container name, bypassing the public Traefik route.
  //      This is critical because the public route goes pki-bridge container →
  //      host-gateway → Coolify Traefik → KC, which fails for various reasons
  //      (Docker for Linux host-gateway flakiness, Traefik routing edge cases,
  //      Node TLS cert validation issues in Alpine containers). jose only
  //      needs the signing keys from JWKS — the URL doesn't have to match `iss`.
  //
  //   Operator can confirm both work via /diag (probes.docker_dns_keycloak +
  //   probes.jwks_canonical).
  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'svc-pki-bridge', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakPublicUrl: process.env.KEYCLOAK_PUBLIC_URL ?? '',
  keycloakInternalUrl: vyzadovanaAdresa('KEYCLOAK_INTERNAL_URL', 'keycloak'),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'svc-pki-bridge', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),

  /**
   * Bootstrap JWKS — the realm's PUBLIC signing keys, DELIVERED by the deploy
   * pipeline instead of fetched over the network.
   *
   * WHY: verifying a token needs the JWKS; reaching KC from another node needs
   * the mesh; the mesh needs a cert from /v1/issue; /v1/issue needs a verified
   * token. On a single node the shared-network alias breaks that cycle — on a
   * multi-node fleet nothing does (the public hostname measurably does not
   * resolve from inside containers: cert mismatch → 503, 2026-07-20).
   *
   * So cold-start fetches the JWKS from the PUBLIC face (reachable from the
   * operator machine, which is off-mesh by definition) and delivers it here as
   * env — one more delivered unknown, same rails as every other secret. This
   * is NOT a second trust anchor: they are the same issuer's keys, verified
   * with the same `iss` + `aud` checks; only the transport differs. Empty =
   * no bootstrap rung (fresh cold start before KC exists) — the live fetch
   * stays the primary path either way.
   */
  bootstrapJwks: process.env.PKI_BOOTSTRAP_JWKS ?? '',

  /** JWKS fetch URL — uses internal Docker DNS to avoid public-route flakiness. */
  get jwksUrl(): string {
    return `${this.keycloakInternalUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/certs`;
  },

  /** Expected `iss` claim — uses public canonical (matches KC_HOSTNAME). */
  get expectedIssuer(): string {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}`;
  },

  /** Expected JWT audience — shared with OAuth2 Proxy's pki-proxy client. */
  jwtAudience: process.env.PKI_BRIDGE_JWT_AUDIENCE ?? 'pki-proxy',

  // ── OpenXPKI RPC ──
  /** Base URL for OpenXPKI RPC endpoint (through pki-webui Apache). */
  openxpkiRpcUrl: process.env.OPENXPKI_RPC_URL ?? 'http://pki-webui:80/rpc',

  /** HMAC shared secret for OpenXPKI RPC request authentication.
   *  Must match the `hmac:` value in the realm's rpc/generic.yaml. */
  openxpkiRpcHmac: process.env.OPENXPKI_RPC_HMAC ?? '',

  /** OpenXPKI realm to issue certs under. */
  openxpkiRealm: process.env.OPENXPKI_REALM ?? 'orchestration-plane',

  /** Default certificate profile for issued certs. */
  certProfile: process.env.PKI_CERT_PROFILE ?? 'tls-server',

  /** EC key algorithm. P-384 = CNSA 2.0 compliant (aligns with AISHA PKI config). */
  keyAlgorithm: (process.env.PKI_KEY_ALGORITHM ?? 'P-384') as 'P-256' | 'P-384' | 'P-521',

  // ── SAN policy ──
  /** Allowed SAN domain patterns (comma-separated). Bridge rejects any SAN
   *  not matching at least one pattern. Prevents token holder from issuing
   *  arbitrary certs beyond their intended scope. */
  // Default derives from the per-instance MESH_TLD so a FORK's bridge validates
  // ITS mesh SANs, not the donor's — the real deploy always sets PKI_ALLOWED_SAN_PATTERNS
  // (compose, = *.${MESH_TLD},…); the MESH_TLD-derived fallback + literal are only for
  // paths without the compose override (tests/local), keeping the upstream identical.
  allowedSanPatterns: (process.env.PKI_ALLOWED_SAN_PATTERNS ?? `*.${process.env.MESH_TLD ?? 'mesh.aisha.internal'}`).split(',').map(s => s.trim()),
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

} as const;
