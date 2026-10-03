/**
 * svc-playwright-runner config — env-derived, validated at boot.
 * Uses @aisha/security primitives so audit logs are structured + safe.
 */
import { createSafeLogger } from '@aisha/security';

export const log = createSafeLogger('svc-playwright-runner');

const num = (v: string | undefined, fallback: number): number =>
  v === undefined || v === '' ? fallback : Number(v);

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
  gatewayUrl: vyzadovanaAdresa('AISHA_GATEWAY_URL', 'gateway'),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),
  pollS: num(process.env.AISHA_PLAYWRIGHT_POLL_S, 30),
  runTimeoutS: num(process.env.AISHA_PLAYWRIGHT_TIMEOUT_S, 1800),
  specsDir: process.env.AISHA_PLAYWRIGHT_SPECS_DIR ?? '/app/e2e',
  playwrightConfig: process.env.AISHA_PLAYWRIGHT_CONFIG ?? '/app/playwright.config.ts',
  reportBase: process.env.AISHA_PLAYWRIGHT_REPORT_BASE ?? '/tmp/playwright-report',
  heartbeatPath: '/tmp/.aisha-pw-heartbeat',
} as const;

if (!config.postgrestServiceToken) {
  log.safeError("error", null, { msg: 'POSTGREST_SERVICE_TOKEN not set; runner cannot authenticate' });
  process.exit(1);
}
