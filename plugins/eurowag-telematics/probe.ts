/**
 * Ruční smoke test připojení k Eurowag Telematics (customer-api) — pro
 * ladění/ověření mimo cron. Produkční sync jede jako plugin (viz README.md).
 *
 *   node --experimental-transform-types plugins/eurowag-telematics/probe.ts
 *
 * POZOR: ne `--experimental-strip-types` (jako u avp-portal v jiném repu) —
 * `ew-client.ts` používá TS parameter properties
 * (`constructor(readonly status: number...)`), které čisté odstranění typů
 * neumí; potřeba `--experimental-transform-types`.
 *
 * Přihlásí se (Keycloak password grant), vypíše stav flotily, počet řidičů
 * a posledních 7 dní jízd prvního vozidla. Přístupy bere z kořenového .env
 * monorepa (`../../../.env` — tenhle plugin žije jako worktree přímo pod
 * monorepo rootem, stejně jako sourozenecké `*-wd` worktree; odtud tři
 * úrovně nahoru), blok „weurowag api klič" / user / heslo — viz
 * README.md → „Ruční probe".
 */
import { readFileSync } from 'node:fs';
import { EwClient, odometerKm, type FetchLike } from './src/ew-client.ts';

const TOKEN_URL = 'https://login.eurowag.com/auth/realms/eurowag/protocol/openid-connect/token';
const BASE_URL = 'https://telematics.eurowag.com/customer-api/v1';
const CLIENT_ID = 'dfo-client';

// Cloudflare na login.eurowag.com vrací "Error 1010: Access denied" na výchozí
// User-Agent Node/knihoven — bez týhle hlavičky token endpoint neprojde
// (past v README). Produkční sandbox fetch UA prohlížeče posílá sám, tady ho
// musíme přidat ručně.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const browserFetch: FetchLike = (url, init) =>
  fetch(url, { ...init, headers: { ...(init?.headers ?? {}), 'user-agent': BROWSER_UA } });

/**
 * Načte přístupy z volného textu kořenového .env. Eurowagův blok tam NENÍ ve
 * tvaru KEY=VALUE (na rozdíl od `ctx.config` v produkci) — je to psaný text
 * „weurowag api klič <klíč>" / „user <email>" / „heslo <heslo>". `user`/`heslo`
 * se hledají až OD pozice markeru „eurowag", jinak by regex chytil první shodu
 * odjinud (AVP i T-cars bloky mají vlastní „Heslo:"/"Přihlašovací jméno:" o
 * pár řádků výš).
 */
function loadEurowagCreds(path: string): { apiKey: string; username: string; password: string } {
  const text = readFileSync(path, 'utf8');
  const markerAt = text.toLowerCase().indexOf('eurowag');
  if (markerAt < 0) {
    throw new Error(`V ${path} nenašel blok "eurowag" — přístupy chybí nebo se přejmenovaly.`);
  }
  const scoped = text.slice(markerAt);
  const apiKey = /api kli[čc]\s+(\S+)/i.exec(text)?.[1];
  const username = /user\s+(\S+@\S+)/i.exec(scoped)?.[1];
  const password = /heslo\s+(\S+)/i.exec(scoped)?.[1];
  if (!apiKey || !username || !password) {
    throw new Error(
      'Chybí některý z přístupů (api klič/user/heslo) v .env — zkontroluj formát bloku ručně.',
    );
  }
  return { apiKey, username, password };
}

const creds = loadEurowagCreds(new URL('../../../.env', import.meta.url).pathname);

const client = new EwClient(creds, {
  baseUrl: BASE_URL,
  tokenUrl: TOKEN_URL,
  clientId: CLIENT_ID,
  timeoutMs: 20_000,
  fetchImpl: browserFetch,
});

interface FuelTank {
  level: number | null;
}
interface VehicleState {
  monitoredObjectId: string;
  rn?: string | null;
  odometer?: number | null;
  fuelTanks?: FuelTank[];
}
interface DriversResponse {
  data: { id: number; name: string; surname: string }[];
  total: number;
}

const vehicles = await client.vehiclesStates<VehicleState[]>();
console.log(`✓ přihlášeno — flotila: ${vehicles.length} vozidel`);
for (const v of vehicles) {
  const km = odometerKm(v.odometer);
  const level = v.fuelTanks?.[0]?.level;
  console.log(
    `  ${v.monitoredObjectId.padStart(7)}  ${(v.rn ?? '—').padEnd(10)}  ` +
      `${km === null ? '      — km' : `${km.toFixed(0).padStart(8)} km`}  ` +
      `palivo ${level == null ? '—' : `${level}`}`,
  );
}

const drivers = await client.drivers<DriversResponse>();
console.log(`\nŘidiči: ${drivers.total} (v odpovědi ${drivers.data.length})`);

const first = vehicles.find((v) => v.rn);
if (first) {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const trips = await client.trips<unknown[]>(
    Number(first.monitoredObjectId),
    from.toISOString(),
    to.toISOString(),
  );
  console.log(`\nPosledních 7 dní pro ${first.rn} (mo ${first.monitoredObjectId}): ${trips.length} jízd`);
} else {
  console.log('\n(žádné vozidlo s SPZ v odpovědi — jízdy se nevyzkoušely)');
}
