/**
 * Start hlídače členství sítí lane (služba `accel-hlidac` operátorského stacku; týž obraz
 * jako VB, jiný příkaz). Jediná služba lane s Docker API — VB ho nikdy nemá.
 *
 *   ACCEL_OWNER_PREFIX    identita vlastníka uzlu (jména `<vlastník>-accel-*`)
 *   ACCEL_VB_DEKLARACE    deklarace uzlu (jen čtení; z ní se odvodí, kdo kam patří)
 *   ACCEL_VB_CLENSTVI     kam zapsat měření (svazek sdílený s VB; výchozí /clenstvi/clenstvi.json)
 *   ACCEL_HLIDAC_INCIDENTY držené incidenty (svazek JEN hlídače; výchozí /hlidac/incidenty.json)
 *   DOCKER_SOCKET         výchozí /var/run/docker.sock
 *
 * Měří každých 10 s, hned po události Dockeru (připojení k síti, start kontejneru) a po změně
 * deklarace. Incident se drží i po odchodu cizího kontejneru (klíč mohl uniknout).
 * Připojení k síti loguje (`sit_pripojeni`) a měření, které vyvolalo, taky (`premereno_po_udalosti`).
 *
 * Potvrzení incidentu operátorem (jádro vždy, síť nájemce jen když nejde rotací klíče):
 *   docker exec <vlastník>-accel-hlidac node dist/hlidac-main.js --potvrd <síť> --kdo <kdo> --duvod <proč>
 * Záznam (kdo, proč, co) jde nejdřív do potvrzeni.jsonl ve svazku hlídače a hlavní proces ho vypíše
 * do docker logs (výstup `docker exec` vidí jen volající). „kdo“ je deklarované: identitu uživatele
 * SSH na hostiteli kontejner ověřit neumí.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Deklarace } from './deklarace.js';
import { dockerApi, nactiIncidenty, zapisAtomicky, zmer, type Incidenty, type Prechodni } from './hlidac.js';

const INTERVAL_MS = 10_000;
const env = process.env;
const zaznam = (udalost: string, data: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), udalost, ...data })}\n`);
const souborIncidentu = env.ACCEL_HLIDAC_INCIDENTY ?? '/hlidac/incidenty.json';
const souborPotvrzeni = env.ACCEL_HLIDAC_POTVRZENI ?? join(dirname(souborIncidentu), 'potvrzeni.jsonl');
const argument = (jmeno: string) => {
  const i = process.argv.indexOf(jmeno);
  return i >= 0 ? (process.argv[i + 1] ?? '').trim() : '';
};

const potvrd = process.argv.indexOf('--potvrd');
if (potvrd >= 0) {
  const sit = process.argv[potvrd + 1] ?? '';
  const kdo = argument('--kdo');
  const duvod = argument('--duvod');
  if (!kdo || !duvod || kdo.length > 80 || duvod.length > 300) {
    zaznam('potvrzeni_odmitnuto', { sit, pricina: 'potvrzení musí nést --kdo (≤ 80 znaků) a --duvod (≤ 300 znaků)' });
    process.exit(2);
  }
  const i = nactiIncidenty(souborIncidentu);
  if (!i[sit]) {
    zaznam('potvrzeni_bez_incidentu', { sit, otevrene: Object.keys(i) });
    process.exit(1);
  }
  const { [sit]: potvrzeny, ...zbytek } = i;
  const zaznamPotvrzeni = { t: new Date().toISOString(), sit, od: potvrzeny.od, cizi: potvrzeny.cizi, kdo, duvod };
  // Nejdřív záznam o tom, kdo a proč, teprve potom uvolnění: potvrzení bez stopy nesmí vzniknout.
  appendFileSync(souborPotvrzeni, `${JSON.stringify(zaznamPotvrzeni)}\n`, { mode: 0o644 });
  zapisAtomicky(souborIncidentu, zbytek);
  zaznam('incident_potvrzen', zaznamPotvrzeni);
  process.exit(0);
}

const vlastnik = env.ACCEL_OWNER_PREFIX ?? '';
if (!/^[a-z][a-z0-9-]{0,30}$/.test(vlastnik)) {
  zaznam('hlidac_nenastartoval', { duvod: 'ACCEL_OWNER_PREFIX chybí nebo není jméno' });
  process.exit(1);
}
const vystup = env.ACCEL_VB_CLENSTVI ?? '/clenstvi/clenstvi.json';
const { docker, sleduj } = dockerApi(env.DOCKER_SOCKET);

let bezi: Promise<void> | null = null;
let znovu = false;
let posledniChyba = '';
let prechodni: Prechodni[] = [];

/** Potvrzení zapsaná `--potvrd` (jiný proces) do docker logs hlavního procesu; po startu i ta dřívější. */
let ctenoPotvrzeni = 0;
function potvrzeniDoLogu(): void {
  let text: string;
  try {
    text = readFileSync(souborPotvrzeni, 'utf8');
  } catch {
    return; // žádné potvrzení zatím nebylo
  }
  const nove = text.slice(ctenoPotvrzeni);
  const konec = nove.lastIndexOf('\n');
  if (konec < 0) return;
  for (const radek of nove.slice(0, konec).split('\n')) {
    if (!radek.trim()) continue;
    try {
      zaznam('incident_potvrzen', { ...JSON.parse(radek), zdroj: 'potvrzeni.jsonl' });
    } catch {
      zaznam('potvrzeni_necitelne', { delka: radek.length });
    }
  }
  ctenoPotvrzeni += konec + 1;
}

async function jednou(): Promise<void> {
  potvrzeniDoLogu();
  const t = deklarace.tabulka();
  // Bez deklarace nevíme, kdo kam patří: nezapsat nic (měření zestárne, VB neobslouží nikoho).
  if ('necitelna' in t) return;
  const zachycene = prechodni;
  prechodni = [];
  try {
    const drive: Incidenty = nactiIncidenty(souborIncidentu);
    const m = await zmer(t, vlastnik, docker, { ted: Date.now(), otiskDeklarace: deklarace.otiskObsahu(), drive, prechodni: zachycene });
    // Nejdřív incidenty (drží se), potom měření pro VB — pád mezi nimi nic neztratí.
    if (JSON.stringify(m.incidenty) !== JSON.stringify(drive)) {
      zapisAtomicky(souborIncidentu, m.incidenty);
      for (const s of Object.keys(m.incidenty)) if (!drive[s]) zaznam('incident', { sit: s, cizi: m.incidenty[s].cizi });
      for (const s of Object.keys(drive)) if (!m.incidenty[s]) zaznam('incident_napraven', { sit: s, duvod: 'rotace klíče a síť čistá' });
    }
    zapisAtomicky(vystup, m.data);
    // Pozitivní kotva (N3 c): měření vyvolané událostí sítě je vidět v logu (jen jména sítí a stav, žádná tajemství).
    if (zachycene.length > 0) {
      const najemci = Object.fromEntries(Object.entries(m.data.najemci).map(([id, s]) => [id, s.ok]));
      zaznam('premereno_po_udalosti', { site: [...new Set(zachycene.map((p) => p.sit))].sort(), zmereno: m.data.zmereno, jadro_ok: m.data.jadro.ok, najemci });
    }
    if (posledniChyba) zaznam('mereni_obnoveno', {});
    posledniChyba = '';
  } catch (e) {
    prechodni = [...zachycene, ...prechodni]; // zachycené připojení se nesmí ztratit
    const zprava = (e as Error).message;
    if (zprava !== posledniChyba) zaznam('mereni_selhalo', { chyba: zprava });
    posledniChyba = zprava;
  }
}

/** Měření jdou za sebou, nikdy souběžně; žádost během běhu = ještě jedno měření potom. */
function mer(): void {
  if (bezi) {
    znovu = true;
    return;
  }
  bezi = jednou().finally(() => {
    bezi = null;
    if (znovu) {
      znovu = false;
      mer();
    }
  });
}

const deklarace = new Deklarace(env.ACCEL_VB_DEKLARACE ?? '/deklarace/uzel.json', (udalost, data) => {
  zaznam(udalost, data);
  if (udalost === 'deklarace_nactena') mer();
});
deklarace.sleduj();
mer();
setInterval(mer, INTERVAL_MS);
sleduj(
  (p) => {
    if (p) {
      prechodni.push(p);
      zaznam('sit_pripojeni', { sit: p.sit, kontejner: p.jmeno });
    }
    mer();
  },
  (e) => zaznam('udalosti_dockeru_vypadek', { chyba: (e as Error).message }),
);
zaznam('hlidac_bezi', { vlastnik, vystup });
