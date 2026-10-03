/**
 * Kontrakt prostředí pro naslouchání zaťukání.
 *
 * Fail-closed: chybějící vstup NENÍ „volnější nastavení". Bez rosteru operátorů
 * by listener naběhl zeleně a nikoho nepustil — nebo hůř, pustil kohokoli.
 * Proto se vady sbírají a start se odmítne.
 */
import { readFileSync } from 'node:fs';
import { operatorDefects, type Operator } from '@aisha/knock-protocol';

export interface KnockConfig {
  /** UDP port, na kterém se naslouchá. */
  port: number;
  bindHost: string;
  /** Kam se zapisuje mapa otevřených adres. */
  redisUrl: string;
  redisDb: number;
  /**
   * Prvky, přes které k nám klient PROCHÁZÍ — TÁŽ hodnota, jakou dostává
   * gateway (`lib/derive-subnets.mjs` → `GATEWAY_TRUSTED_PROXIES`). Jeden
   * zdroj: kdyby si každý seznam skládal sám, chůze zprava by u každého
   * skončila jinde a dveře by pouštěly někoho jiného, než koho pustí brána.
   */
  trustedProxies: string;
  /** Jak dlouho otvor platí. */
  pinholeTtlSec: number;
  /** Tolerance časového razítka rámce. */
  windowSec: number;
  otpStep: number;
  otpDigits: number;
  otpSkew: number;
  /** Roster: kid → pověření. */
  operators: Record<string, Operator>;
  /**
   * Roster z adresy — čte se za běhu, ne jen při startu. Prázdné = vypnuto
   * a platí jen `SPA_OPERATORS_B64` / `SPA_OPERATORS_FILE`.
   */
  operatorsUrl: string;
  /** Levná routa s otiskem a počtem. Bez ní se roster stahuje pokaždé. */
  operatorsVersionUrl: string;
  operatorsToken: string;
  operatorsRefreshSec: number;
  /** Trvale otevřené adresy (K4) a zakázaná místa. */
  staticAllow: string[];
  blacklist: string[];
  /** Obrana. */
  maxInvalid: number;
  rateWindowSec: number;
  cooldownSec: number;
  recentOkSec: number;
  /** Kam hlásit „doruč nový kód" a „na té síti někdo zkouší dveře". */
  alertWebhook: string;
  logLevel: string;
  /**
   * ⭐ MĚŘICÍ REŽIM. Bez operátorů, takže STRUKTURÁLNĚ nemůže nic otevřít.
   * Slouží k ověření, že datagram vůbec doletí a s jakou zdrojovou adresou.
   */
  diagnose: boolean;
}

/**
 * Číselná proměnná, kde PRÁZDNO znamená „nenastaveno", ne „nula".
 *
 * ⛔ NAMĚŘENO 2026-09-02 na `SPA_OTP_SKEW`. `Number("")` NENÍ `NaN`, je to `0` —
 * a nula projde stráží `Number.isFinite` jako platná hodnota, takže výchozí `1`
 * se nikdy nepoužije a okno OTP se tiše zúží na jediný krok. Nenastavená
 * proměnná se přitom chová správně (`Number(undefined)` je `NaN`), takže se
 * vada projeví JEN tam, kde někdo klíč deklaroval s prázdnou hodnotou.
 *
 * Týž tvar (a týž důvod) je v `services/svc-money/src/config.ts`.
 */
export function num(v: string | undefined, d: number): number {
  const t = (v ?? '').trim();
  if (t === '') return d;
  const n = Number(t);
  return Number.isFinite(n) ? n : d;
}

function list(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function loadOperators(env: NodeJS.ProcessEnv): Record<string, Operator> {
  // Dvě cesty, obě z prostředí: soubor (svazek/secret) nebo base64 přímo.
  // ⛔ Roster se NEČTE z repa a NEPEČE do obrazu — pověření by tak zestárla
  // spolu s obrazem a rotace by znamenala přestavbu, kterou nikdo neudělá.
  const b64 = env.SPA_OPERATORS_B64;
  if (b64) return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  const file = env.SPA_OPERATORS_FILE;
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  return {};
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KnockConfig {
  return {
    port: num(env.SPA_KNOCK_PORT, 18181),
    bindHost: env.SPA_BIND ?? '0.0.0.0',
    redisUrl: env.AISHA_SHARED_REDIS_URL ?? '',
    redisDb: num(env.SPA_REDIS_DB, 4),
    trustedProxies: env.GATEWAY_TRUSTED_PROXIES ?? '',
    pinholeTtlSec: num(env.SPA_PINHOLE_TTL, 120),
    windowSec: num(env.SPA_WINDOW_SEC, 30),
    otpStep: num(env.SPA_OTP_STEP, 30),
    otpDigits: num(env.SPA_OTP_DIGITS, 6),
    otpSkew: num(env.SPA_OTP_SKEW, 1),
    operators: loadOperators(env),
    operatorsUrl: env.SPA_OPERATORS_URL ?? '',
    operatorsVersionUrl: env.SPA_OPERATORS_VERSION_URL ?? '',
    operatorsToken: env.SPA_OPERATORS_TOKEN ?? '',
    operatorsRefreshSec: num(env.SPA_OPERATORS_REFRESH_SEC, 30),
    staticAllow: list(env.SPA_STATIC_ALLOW),
    blacklist: list(env.SPA_BLACKLIST),
    maxInvalid: num(env.SPA_MAX_INVALID, 10),
    rateWindowSec: num(env.SPA_RATE_WINDOW_SEC, 60),
    cooldownSec: num(env.SPA_COOLDOWN_SEC, 300),
    recentOkSec: num(env.SPA_RECENT_OK_SEC, 3600),
    alertWebhook: env.SPA_ALERT_WEBHOOK ?? '',
    logLevel: env.LOG_LEVEL ?? 'info',
    diagnose: env.SPA_DIAGNOSE === '1',
  };
}

/** Vrací důvody, proč služba nesmí nastartovat. Prázdné pole = v pořádku. */
export function configDefects(env: NodeJS.ProcessEnv = process.env): string[] {
  let cfg: KnockConfig;
  try {
    cfg = loadConfig(env);
  } catch (e) {
    return [`roster operátorů se nepodařilo načíst: ${e instanceof Error ? e.message : String(e)}`];
  }
  const bad: string[] = [];

  if (!cfg.redisUrl) {
    bad.push(
      'AISHA_SHARED_REDIS_URL chybí — bez mapy dveří nemá listener kam zapsat, ' +
        'že se někdo dostal dovnitř (tichý knock, který nic neotevře, je horší než žádný)',
    );
  }

  const kids = Object.keys(cfg.operators);
  if (cfg.diagnose) {
    // Měření nesmí mít pověření: kdyby je mělo, přestalo by to být měření
    // a stalo by se z toho provoz, o kterém nikdo neví, že běží.
    if (kids.length) {
      bad.push(`SPA_DIAGNOSE=1 je čisté měření a nesmí mít operátory (našel jsem: ${kids.join(', ')})`);
    }
    if (cfg.operatorsUrl) {
      bad.push('SPA_DIAGNOSE=1 a SPA_OPERATORS_URL se vylučují — měření, které si dotáhne pověření, přestává být měření');
    }
  } else if (cfg.operatorsUrl) {
    // Roster se dotáhne z adresy, takže prázdná mapa při startu není vada.
    // Dokud nedorazí, zaťukání nikoho neotevře — to je fail-closed a přiznává
    // se to stavovým kódem na /ready, ne mlčením.
    //
    // Bez SPA_OPERATORS_VERSION_URL to funguje taky, jen se při každém kole
    // tahá celý roster i s tajemstvími místo levného otisku.
    //
    // Základ z prostředí (kódy techniků) platí vedle rosteru z adresy, takže se
    // posuzuje stejně přísně jako bez něj.
    bad.push(...kids.flatMap((k) => operatorDefects(k, cfg.operators[k])));
  } else if (!kids.length) {
    bad.push(
      'žádný operátor — pro pouhé změření, co doletí, spusť SPA_DIAGNOSE=1 (nic neotevře); ' +
        'jinak dodej SPA_OPERATORS_B64, SPA_OPERATORS_FILE nebo SPA_OPERATORS_URL',
    );
  } else {
    bad.push(...kids.flatMap((k) => operatorDefects(k, cfg.operators[k])));
  }

  if (cfg.pinholeTtlSec <= 0) bad.push('SPA_PINHOLE_TTL musí být kladné — otvor bez trvání se zavře dřív, než se použije');
  if (cfg.windowSec <= 0) bad.push('SPA_WINDOW_SEC musí být kladné');

  return bad;
}
