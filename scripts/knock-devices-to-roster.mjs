#!/usr/bin/env node
/**
 * knock-devices-to-roster.mjs — složí roster vrátného ze ZÁKLADU + SCHVÁLENÝCH ZAŘÍZENÍ.
 *
 * ⛔ PROČ TO DĚLÁ ČLOVĚK A NE SLUŽBA (rozhodnuto 2026-09-09). Automatický export
 * potřebuje komponentu, která má ZÁROVEŇ přístup k databázi a k rosteru. Dnes ji
 * nemá nikdo, komu by to rolí patřilo:
 *   · dveře samy    → široký DB token v nejexponovanější komponentě,
 *   · brána         → totéž o patro vedle + nový mezislužbový kontrakt,
 *   · nová DB role  → v tomhle repu bez precedensu (zná jen anon/authenticated/
 *                     service_role), tedy nový druh věci v cold-startu.
 * Změna, která rozhoduje o přístupu do sítě, nemá padnout mimochodem. Do té doby
 * ji dělá člověk SVÝM pověřením — a je to i provozně poctivé: roster instance
 * dnes bydlí v proměnné Coolify, takže tenhle skript mluví týmž jazykem.
 *
 * ⛔ ZÁKLAD VYHRÁVÁ NAD ZAŘÍZENÍMI. Kdyby zařízení mohlo přepsat `kid` ze
 * základu, dal by se jím vyměnit break-glass operátor za cizí klíč — a nikdo by
 * si toho nevšiml, protože ťukání se navenek chová identicky. Kolize je NÁLEZ.
 *
 * ⛔ ZE ZAŘÍZENÍ SE BERE JEN VER 2. Záznam bez veřejného klíče se NEPŘIJME, i
 * kdyby byl jinak v pořádku: kdyby touhle cestou šlo zavést pověření se sdíleným
 * tajemstvím, stačilo by zapsat do databáze a ťukat bez schválení.
 *
 * Použití:
 *   node scripts/knock-devices-to-roster.mjs                    # vypíše nový SPA_OPERATORS_B64
 *   node scripts/knock-devices-to-roster.mjs --diff             # jen co by se změnilo
 *
 * Čte `AISHA_POSTGREST_URL` a `SERVICE_ROLE_KEY` z kanonického řetězu
 * (`config/domains.env`, `.env.coolify`, …) — týmž způsobem jako ostatní skripty.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operatorDefects } from '../packages/knock-protocol/dist/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOUBORY = ['config/domains.env', '.env.coolify', '.env.local', '.env-prod-backup', '.env.aisha']
  .map((p) => join(ROOT, p));

/** Čte klíč z kanonického řetězu. `grep|cut` sémantika — `source` tiše ztrácí hodnoty. */
function konfig(klic) {
  if (process.env[klic]) return process.env[klic].replace(/^["']|["']$/g, '');
  for (const f of SOUBORY) {
    if (!existsSync(f)) continue;
    for (const radek of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const l = radek.trimStart();
      if (l.startsWith('#') || !l.startsWith(`${klic}=`)) continue;
      return l.slice(klic.length + 1).replace(/^["']|["']$/g, '');
    }
  }
  return '';
}

function konec(zprava, kod = 2) {
  process.stderr.write(`knock-devices-to-roster: ${zprava}\n`);
  process.exit(kod);
}

const POSTGREST = konfig('AISHA_POSTGREST_URL') || konfig('POSTGREST_URL');
const KLIC = konfig('SERVICE_ROLE_KEY');
if (!POSTGREST) konec('chybí AISHA_POSTGREST_URL — bez adresy nevím, koho se ptát');
if (!KLIC) konec('chybí SERVICE_ROLE_KEY — bez pověření se schválená zařízení nepřečtou');

const zakladB64 = konfig('SPA_OPERATORS_B64');
if (!zakladB64) konec('chybí SPA_OPERATORS_B64 — základ (lidé, break-glass) se NEODVOZUJE');

let zaklad;
try {
  zaklad = JSON.parse(Buffer.from(zakladB64, 'base64').toString('utf8'));
} catch (e) {
  // Důvod se NESE dál: „není platný base64 JSON" samo o sobě neřekne, jestli
  // je hodnota useknutá, obalená uvozovkami, nebo to prostě není roster.
  konec(`SPA_OPERATORS_B64 není platný base64 JSON: ${e instanceof Error ? e.message : String(e)}`);
}

// ⛔ ČASOVÝ LIMIT JE POVINNÝ. Bez něj skript při nedostupném endpointu (dveře
// zavřené, mesh dole, špatná adresa) jen VISÍ — a člověk u terminálu nepozná,
// jestli to pracuje, nebo je konec. Mlčící čekání je horší než chyba: chyba
// se dá přečíst. 20 s je nad rámec normální odpovědi a pod hranicí, kdy to
// kdokoli vzdá sám.
let res;
try {
  res = await fetch(`${POSTGREST.replace(/\/$/, '')}/rpc/admin_list_knock_devices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KLIC}`,
      Accept: 'application/json',
    },
    body: JSON.stringify({ p_user_id: null }),
    signal: AbortSignal.timeout(20_000),
  });
} catch (e) {
  // Rozlišit „nedoletělo" od „odmítli nás" — jsou to dvě různé poruchy
  // a řeší se jinde (síť/dveře × oprávnění).
  konec(
    e instanceof Error && e.name === 'TimeoutError'
      ? `${POSTGREST} neodpovědělo do 20 s — jsou dveře otevřené a mesh nahoře?`
      : `spojení s ${POSTGREST} selhalo: ${e instanceof Error ? e.message : String(e)}`,
  );
}
if (!res.ok) konec(`admin_list_knock_devices selhalo: HTTP ${res.status} ${await res.text()}`);
const zarizeni = await res.json();

const roster = { ...zaklad };
const kolize = [];
const odmitnuta = [];
let prijato = 0;

for (const d of zarizeni) {
  // Schválené a neodvolané. Odvolané se do rosteru NEVRACÍ — a nemažou se
  // z databáze, aby zůstalo z čeho poznat, že kdysi schválené byly.
  if (!d.approved_at || d.revoked_at) continue;
  if (d.kid in zaklad) { kolize.push(d.kid); continue; }

  const op = {
    publicKeyHex: d.public_key_hex,
    scopes: [d.scope],
    kind: 'device',
    ownedBy: d.owner_user_id,
  };
  // Ověřit TÝMŽ predikátem, jakým se řídí start služby — jinak by roster prošel
  // tudy a shodil `svc-knock` až při nasazení, daleko od místa, kde vznikl.
  const vady = operatorDefects(d.kid, op);
  if (vady.length) { odmitnuta.push(...vady); continue; }
  roster[d.kid] = op;
  prijato++;
}

const vysledek = Buffer.from(JSON.stringify(roster), 'utf8').toString('base64');

process.stderr.write(
  `\nzáklad: ${Object.keys(zaklad).length} · schválených zařízení přijato: ${prijato} · celkem: ${Object.keys(roster).length}\n`,
);
if (kolize.length)
  process.stderr.write(`\n⛔ KOLIZE (zařízení NEPŘIJATO, základ vyhrává): ${kolize.join(', ')}\n`);
if (odmitnuta.length)
  process.stderr.write(`\n⛔ ODMÍTNUTO:\n  ${odmitnuta.join('\n  ')}\n`);

if (process.argv.includes('--diff')) {
  const nove = Object.keys(roster).filter((k) => !(k in zaklad));
  process.stderr.write(`\npřibude: ${nove.length ? nove.join(', ') : '(nic)'}\n`);
  process.exit(0);
}

process.stderr.write('\nvlož jako SPA_OPERATORS_B64 u svc-knock (a restartuj službu):\n\n');
process.stdout.write(`${vysledek}\n`);
