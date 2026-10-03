/**
 * svc-web-artifact runtime config — env-derived, validated at boot.
 */
export interface ServiceConfig {
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  gatewayUrl: string;
  serviceKey: string;
  /** PostgREST service-role JWT — n8n + self-trigger present this for /parse and /seed-default. */
  postgrestServiceToken: string;
  /** Comma-separated list of allowed CORS origins (applySecurity consumes this). */
  corsAllowlist: string;
  llmMock: boolean;
  domainsDir: string;
  /** Operator's public domain (e.g. "aisha.guru"). Convention: a folder named
   *  domains/templates/<seedDomain>/ is auto-imported by /seed-default when
   *  present; otherwise the neutral domains/default/ is seeded. */
  seedDomain: string;
  defaultPageSlug: string;
  maxUploadBytes: number;
  maxZipEntries: number;
  maxZipUncompressedBytes: number;
}

const num = (v: string | undefined, fallback: number): number =>
  v === undefined || v === '' ? fallback : Number(v);

const bool = (v: string | undefined): boolean => v === '1' || v === 'true';

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

export const config: ServiceConfig = {
  port: num(process.env.PORT, 3030),
  logLevel: (process.env.LOG_LEVEL as ServiceConfig['logLevel']) ?? 'info',
  gatewayUrl: vyzadovanaAdresa('AISHA_GATEWAY_URL', 'gateway'),
  serviceKey: process.env.AISHA_SERVICE_KEY ?? '',
  // Falls back to AISHA_SERVICE_KEY when POSTGREST_SERVICE_TOKEN isn't set —
  // historically both names referenced the same secret in some envs.
  postgrestServiceToken: process.env.POSTGREST_SERVICE_TOKEN ?? process.env.AISHA_SERVICE_KEY ?? '',
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  llmMock: bool(process.env.AISHA_LLM_MOCK),
  domainsDir: process.env.DOMAINS_DIR ?? '/app/domains',
  // Folder-name == domain convention. AISHA_SEED_DOMAIN is explicit; PUBLIC_TLD
  // is the operator's resolved public domain (config/domains.env). Empty → default.
  seedDomain: (process.env.AISHA_SEED_DOMAIN ?? process.env.PUBLIC_TLD ?? '').trim(),
  defaultPageSlug: process.env.DEFAULT_PAGE_SLUG ?? 'index',
  maxUploadBytes: num(process.env.MAX_UPLOAD_BYTES, 52428800),
  maxZipEntries: num(process.env.MAX_ZIP_ENTRIES, 200),
  maxZipUncompressedBytes: num(process.env.MAX_ZIP_UNCOMPRESSED_BYTES, 104857600),
};
