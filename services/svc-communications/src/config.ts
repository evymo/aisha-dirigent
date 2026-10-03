import { requireEnv } from '@aisha/security';
export const config = {
  port: parseInt(process.env.SVC_COMMUNICATIONS_PORT ?? '3027', 10),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',

  // ── PostgREST ──
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-communications', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  // ── Keycloak ──
  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'svc-communications', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'svc-communications', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),

  get jwksUrl(): string {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/certs`;
  },

  // ── SMS Providers ──
  smsProvider: (process.env.SMS_PROVIDER ?? 'twilio') as 'twilio' | 'messagebird' | 'vonage',

  // Twilio
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER ?? '',

  // MessageBird
  messagebirdApiKey: process.env.MESSAGEBIRD_API_KEY ?? '',
  messagebirdOriginator: process.env.MESSAGEBIRD_ORIGINATOR ?? 'Evymo',

  // Vonage
  vonageApiKey: process.env.VONAGE_API_KEY ?? '',
  vonageApiSecret: process.env.VONAGE_API_SECRET ?? '',
  vonageFromNumber: process.env.VONAGE_FROM_NUMBER ?? '',

  // ── OTP settings ──
  otpLength: parseInt(process.env.OTP_LENGTH ?? '6', 10),
  otpTtlMinutes: parseInt(process.env.OTP_TTL_MINUTES ?? '5', 10),
  otpMaxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '3', 10),
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

} as const;
