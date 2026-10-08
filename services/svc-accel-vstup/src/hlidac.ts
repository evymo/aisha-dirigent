/**
 * Hlídač členství sítí lane (O-2) — měří přes Docker API, kdo má přístup k sítím lane,
 * a zapisuje `clenstvi.json` pro VB (clenstvi.ts ho vynucuje).
 *
 * CO TO JE A CO NE: projekt forku v Coolify nasadí na uzel libovolný compose, takže je
 * fakticky root uzlu (O-2). Proti kontejneru s docker.sock, `privileged` nebo hostitelským
 * jmenným prostorem se v uzlu bránit nedá — ty hlídač jen HLÁSÍ (`varovani`). Vynucuje
 * to, co jde poznat spolehlivě a co by bylo tiché obejití lane:
 *   1. cizí člen sítě lane nebo jádra (i přechodný — z události Dockeru „připojení“);
 *   2. sdílení jmenného prostoru (síť, pid, ipc `container:`) se vstupem, enginem nebo
 *      agentem nájemce — takový kontejner v seznamu členů sítě vůbec není;
 *   3. zápisové připojení svazků operátora (`<vlastník>-accel-*`, i přes cestu na hostiteli):
 *      kdo může přepsat deklaraci nebo měření, obejde všechno ostatní;
 *   4. síť, která není deklarovaná (není `internal`, jiná podsíť).
 *
 * Kdo kam patří, se ODVOZUJE z deklarace a identity vlastníka, nepíše se ručně:
 *   - `<vlastník>-lane-<id>`   = { `<vlastník>-accel-vstup`, `<id>-model-mesh-agent` };
 *   - `<vlastník>-lane-volny-<n>` (volné sloty compose vstupu, n = 1..8) = { `<vlastník>-accel-vstup` };
 *     do jmenného prostoru agenta smí jen `<id>-model-klient` téhož projektu compose
 *     a jen PŘÍMO (svc-model tenkého stacku);
 *   - `<vlastník>-accel-jadro` = { `<vlastník>-accel-vstup` } ∪ { `<vlastník>-accel-<engine>` }.
 * Porovnává se JMÉNO kontejneru (jedinečné na hostiteli), ne alias (ten jedinečný není), A jeho PROJEKT
 * compose (Coolify `-p <uuid aplikace>`; služba, container_name i `coolify.applicationUuid` jsou v rukou forku,
 * a v raw režimu i projekt): operátor = projekt hlídače + služba z výčtu + jméno té
 * služby; engine = projekt == `enginy.<id>.aplikace_coolify` z deklarace + služba accel-<id>; agent =
 * projekt == `najemci.<id>.aplikace_coolify` + služba model-mesh-agent; klient = služba svc-model z projektu
 * agenta. Chybí-li vazba v deklaraci, platí jméno + služba a hlídač hlásí varování „nevázáno“. Vazba chrání proti
 * OMYLU, ne proti zlému forku: v raw režimu si fork projekt compose nastaví sám (O-2, změřeno 2026-10-07).
 * Členy sítě páruje podle ID (seznam kontejnerů je starší než inspect sítě). Hlídač zná sám sebe podle PLNÉHO ID (mountinfo), ne podle
 * hostname. Odkaz `container:<ref>` se vykládá VŠEMI způsoby (plné ID, přesné jméno, předpona
 * ID, výklad Dockeru) a sleduje se až k vlastníkům jmenného prostoru — stačí jediný výklad
 * vedoucí k chráněnému kontejneru. Adresa enginu v deklaraci MUSÍ být jeho jméno.
 *
 * INCIDENT SE DRŽÍ: cizí přístup mohl odposlechnout klíč. Incident sítě nájemce trvá, dokud
 * v deklaraci platí KTERÝKOLI klíč platný v době incidentu (rozpracovaná rotace [starý, nový]
 * nestačí) a dokud síť není čistá. Incident jádra trvá do výslovného potvrzení operátora
 * (`hlidac-main.js --potvrd <síť>`).
 *
 * Zbytkové riziko (vědomé, O-2): vše, co má root uzlu, a aplikace forku, kdyby uměla nastavit vlastní projekt
 * compose (měří Infra). Zavře až identita koncových bodů (mTLS) ve fázi 2.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Client, Pool } from 'undici';
import type { ClenstviData } from './clenstvi.js';
import type { Tabulka } from './tabulka.js';

/** Sítě nájemců žijí v prostoru vlastníka (deklarace v5): `<vlastník>-lane-<id>`. */
export const sitNajemce = (vlastnik: string, id: string) => `${vlastnik}-lane-${id}`;
/** Volné sloty compose vstupu: pevně 8 sítí `<vlastník>-lane-volny-<n>`; nájemce se tak jmenovat nesmí. */
export const POCET_SLOTU = 8;
export const sitVolna = (vlastnik: string, n: number) => `${vlastnik}-lane-volny-${n}`;
export const agentNajemce = (id: string) => `${id}-model-mesh-agent`;
export const klientNajemce = (id: string) => `${id}-model-klient`;
export const sitJadra = (vlastnik: string) => `${vlastnik}-accel-jadro`;
export const vstupOperatora = (vlastnik: string) => `${vlastnik}-accel-vstup`;
export const enginOperatora = (vlastnik: string, id: string) => `${vlastnik}-accel-${id}`;
/** Kontejnery Coolify, které docker.sock / pid host mají z povahy věci (jména jsou na hostiteli jedinečná). */
const COOLIFY_INFRA = new Set(['coolify-sentinel']);

export interface SitDockeru {
  interni: boolean;
  podsite: string[];
  /** Členové podle ID (klíče `Containers` v inspect sítě) + jméno v okamžiku inspectu sítě. */
  clenove: Array<{ id: string; jmeno: string }>;
}
export interface KontejnerDockeru {
  id: string;
  jmeno: string;
  /** Projekt compose (štítek nastavuje compose sám — z textu compose ho fork nepřepíše). */
  projekt: string;
  /** Klíč služby compose (štítek `com.docker.compose.service`, nastavuje compose). */
  sluzba: string;
  /** Aplikace Coolify (štítek `coolify.applicationUuid`), jinak ''. Volí ho fork — jen pro diagnostiku, NIKDY vazba. */
  aplikace: string;
  sit: string;
  pid: string;
  ipc: string;
  /** Surový odkaz `container:<ref>` v režimu sítě/pid/ipc (jméno, ID nebo předpona), jinak null. */
  sitRef: string | null;
  pidRef: string | null;
  ipcRef: string | null;
  /** Jak týž odkaz vyložil Docker při měření (plné ID), jinak null. Jen JEDNA z interpretací. */
  sitCil: string | null;
  pidCil: string | null;
  ipcCil: string | null;
  privilegovany: boolean;
  /** Běží (i restartuje). Chybějící stav = běží: výjimky pro zastavené kontejnery se neudělí naslepo. */
  bezi: boolean;
  pripojeni: Array<{ typ: string; jmeno?: string; zdroj?: string; rw: boolean }>;
}
export interface Docker {
  /** `null` = síť neexistuje. */
  sit(jmeno: string): Promise<SitDockeru | null>;
  kontejnery(): Promise<KontejnerDockeru[]>;
  /** Jeden kontejner podle ID (člen sítě, který v dřívějším seznamu chyběl); `null` = neexistuje. */
  kontejner(id: string): Promise<KontejnerDockeru | null>;
  /** Hlídač sám: plné ID (z /proc/self/mountinfo, ne z hostname) a projekt compose. */
  ja(): Promise<{ projekt: string; id: string }>;
  /** DockerRootDir démona (svazky leží v `<kořen>/volumes`). */
  korenDockeru(): Promise<string>;
}

/** Identita kontejneru pro rozhodnutí o členství (jméno + štítky compose / Coolify). */
export type Identita = Pick<KontejnerDockeru, 'jmeno' | 'projekt' | 'sluzba' | 'aplikace'>;
/** Připojení zachycené událostí; `identita` = štítky přečtené v OKAMŽIKU události (kontejner pak může zmizet). */
export interface Prechodni {
  sit: string;
  jmeno: string;
  identita?: Omit<Identita, 'jmeno'>;
}

export interface Incident {
  od: string;
  cizi: string[];
  /** Otisky klíčů nájemce v době incidentu (u jádra chybí — jen výslovné potvrzení). */
  klice?: string[];
}
export type Incidenty = Record<string, Incident>;

interface Ocekavani {
  jadro: { sit: string; smi: Set<string> };
  najemci: Map<string, { sit: string; podsit: string; smi: Set<string>; agent: string; klient: string; klice: string[]; aplikace: string | null }>;
  volne: string[];
  vstup: string;
  enginy: Set<string>;
  /** Jméno kontejneru enginu → vázaná aplikace Coolify (projekt compose) z deklarace, null = nevázáno. */
  aplikaceEnginu: Map<string, string | null>;
}

/** Očekávané členství z deklarace; nesoulad adresy enginu se jménem = výjimka (neměřit). */
export function ocekavane(t: Tabulka, vlastnik: string): Ocekavani {
  const vstup = vstupOperatora(vlastnik);
  const enginy = new Set<string>();
  const aplikaceEnginu = new Map<string, string | null>();
  for (const e of t.enginy.values()) {
    const jmeno = enginOperatora(vlastnik, e.id);
    const host = new URL(e.url).hostname;
    if (host !== jmeno) throw new Error(`engine ${e.id}: adresa '${host}' není jméno kontejneru '${jmeno}'`);
    enginy.add(jmeno);
    aplikaceEnginu.set(jmeno, e.aplikace_coolify ?? null);
  }
  const najemci = new Map(
    [...t.najemci.values()].map((n) => [
      n.id,
      {
        sit: sitNajemce(vlastnik, n.id),
        podsit: n.podsit.zapis,
        smi: new Set([vstup, agentNajemce(n.id)]),
        agent: agentNajemce(n.id),
        klient: klientNajemce(n.id),
        klice: n.otisky.map((o) => o.toString('hex')).sort(),
        aplikace: n.aplikaceCoolify,
      },
    ]),
  );
  const obsazene = new Set([...najemci.values()].map((n) => n.sit));
  const volne = Array.from({ length: POCET_SLOTU }, (_, i) => sitVolna(vlastnik, i + 1)).filter((j) => !obsazene.has(j));
  return { jadro: { sit: sitJadra(vlastnik), smi: new Set([vstup, ...enginy]) }, najemci, volne, vstup, enginy, aplikaceEnginu };
}

export interface Mereni {
  data: ClenstviData;
  incidenty: Incidenty;
}

/**
 * Jedno měření. `prechodni` = členové zachycení událostí „připojení“ od minulého měření
 * (i ti, kdo mezitím odešli). `drive` = držené incidenty. Chyba Dockeru = výjimka (nic nezapsat).
 */
export async function zmer(
  t: Tabulka,
  vlastnik: string,
  docker: Docker,
  opts: { ted: number; otiskDeklarace: string; drive?: Incidenty; prechodni?: Prechodni[] },
): Promise<Mereni> {
  const o = ocekavane(t, vlastnik);
  const nalez = new Map<string, Set<string>>();
  const pridej = (sit: string, co: string) => (nalez.get(sit) ?? nalez.set(sit, new Set()).get(sit)!).add(co);
  const zmerene = new Set<string>();
  const vlastniProjekt = (await docker.ja()).projekt;
  if (!vlastniProjekt) throw new Error('hlídač nezná projekt compose svého stacku — výjimky operátora nejde vázat');
  const svazky = `${(await docker.korenDockeru()).replace(/\/+$/, '')}/volumes`;
  const kontejnery = await docker.kontejnery();
  const podleJmena = new Map(kontejnery.map((k) => [k.jmeno, k]));
  const podleId = new Map(kontejnery.map((k) => [k.id, k]));
  // IDENTITA (v5) = jméno kontejneru A projekt compose (operátor = projekt hlídače; engine a agent = aplikace
  // z deklarace, je-li v ní). Ochrana proti omylu; zlý fork s přístupem do Coolify GPU uzlu je O-2. Jméno je na hostiteli jedinečné, ale samo jde podvrhnout (když pravý kontejner
  // neběží). Coolify v raw režimu jména nepřepisuje (naměřeno 2026-10-06), takže jméno zůstává klíčem.
  // Služby operátorského stacku (klíče compose vstupu lane) a JEDINÉ svazky, do kterých každá smí zapisovat.
  // Výjimka je zápis do vlastního svazku, nic víc: deklarace do váh nepíše, bind kořene nebo svazků
  // Dockeru zůstává incidentem i u operátora. Socket démona smí držet jen proxy.
  const svazkyOperatora = new Map<string, ReadonlySet<string>>([
    ['accel-vstup', new Set()],
    ['accel-hlidac', new Set([`${vlastnik}-accel-clenstvi`, `${vlastnik}-accel-hlidac`])],
    ['accel-vahy', new Set([`${vlastnik}-accel-vahy`])],
    ['accel-deklarace', new Set([`${vlastnik}-accel-deklarace`])],
    ['accel-prava', new Set([`${vlastnik}-accel-vahy`, `${vlastnik}-accel-deklarace`, `${vlastnik}-accel-clenstvi`, `${vlastnik}-accel-hlidac`])],
    ['accel-docker-proxy', new Set([`${vlastnik}-accel-docker-proxy`])],
  ]);
  // Operátor = projekt hlídače A služba z výčtu A jméno té služby `<vlastník>-<služba>`. Compose (v5.4.0, reconcile.go
  // planRecreateContainer) při znovuvytvoření nový kontejner nejdřív VYTVOŘÍ pod dočasným jménem `<12 hex ID STARÉHO>_<jméno>`
  // a spustí ho až pod pravým jménem (naměřeno 2026-10-06): dočasný tvar proto platí jen pro NEBĚŽÍCÍ kontejner.
  const operator = (k: (Identita & { bezi?: boolean }) | undefined) => {
    if (k === undefined || k.projekt !== vlastniProjekt || !svazkyOperatora.has(k.sluzba)) return false;
    const jmeno = `${vlastnik}-${k.sluzba}`;
    return k.jmeno === jmeno || (k.bezi === false && /^[0-9a-f]{12}_/.test(k.jmeno) && k.jmeno.slice(13) === jmeno);
  };
  // VAZBA NA DEKLARACI = OCHRANA PROTI OMYLU, ne proti zlému forku (O-2, změřeno 2026-10-07: v raw režimu si
  // fork nastaví projekt compose `name:` / COMPOSE_PROJECT_NAME a podvrhne i coolify.applicationUuid; fork, který
  // nasazuje tenký stack sám, je přijaté riziko). Nese-li deklarace `aplikace_coolify`, projekt se vynucuje;
  // chybí-li, platí jméno + služba a hlídač hlásí VAROVÁNÍ „nevázáno“ (ne incident — lane slouží dál).
  const nevazane = new Set<string>();
  const prefixEnginu = `${vlastnik}-accel-`;
  const engine = (k: Identita) => {
    if (k.sluzba !== `accel-${k.jmeno.slice(prefixEnginu.length)}` || k.projekt === vlastniProjekt) return false;
    const vazba = o.aplikaceEnginu.get(k.jmeno);
    if (vazba == null) nevazane.add(k.jmeno);
    return vazba == null || k.projekt === vazba;
  };
  const agenti = new Map([...o.najemci.values()].map((n) => [n.agent, n.aplikace]));
  /** Člen sítě smí být jen očekávané JMÉNO s odpovídající IDENTITOU (jméno samo nestačí). */
  const smiByt = (k: Identita | undefined, smi: Set<string>) => {
    if (!k || !smi.has(k.jmeno)) return false;
    // Jméno vstupu u operátora už znamená službu accel-vstup (operátor = jméno <vlastník>-<služba>).
    if (k.jmeno === o.vstup) return operator(k);
    if (o.enginy.has(k.jmeno)) return engine(k);
    if (agenti.has(k.jmeno)) {
      if (k.sluzba !== 'model-mesh-agent' || k.projekt === '' || k.projekt === vlastniProjekt) return false;
      const vazba = agenti.get(k.jmeno);
      if (vazba == null) nevazane.add(k.jmeno);
      return vazba == null || k.projekt === vazba;
    }
    return false;
  };
  const cizi = (identita: Identita | undefined, smi: Set<string>) => !smiByt(identita, smi);
  // Člen sítě se páruje podle ID, ne jména: seznam kontejnerů je starší než inspect sítě a mezitím mohl
  // proběhnout přenasazení (dočasné jméno compose → přejmenování). Neznámé ID se dohledá inspectem.
  const clen = async (c: { id: string; jmeno: string }): Promise<{ identita: KontejnerDockeru | undefined; jmeno: string }> => {
    const k = podleId.get(c.id) ?? (await docker.kontejner(c.id)) ?? undefined;
    return { identita: k, jmeno: k?.jmeno ?? c.jmeno };
  };
  const jenVstup = new Set([o.vstup]);

  // 1 + 4: členové sítí a jejich tvar.
  const jadro = await docker.sit(o.jadro.sit);
  zmerene.add(o.jadro.sit);
  if (!jadro) pridej(o.jadro.sit, '(síť jádra neexistuje)');
  else {
    if (!jadro.interni) pridej(o.jadro.sit, '(síť jádra není internal)');
    for (const c of jadro.clenove) {
      const m = await clen(c);
      if (cizi(m.identita, o.jadro.smi)) pridej(o.jadro.sit, m.jmeno);
    }
  }
  // Volné sloty compose vstupu: smí v nich být jen vstup operátora; síť, která neexistuje (slot obsadil nájemce), se přeskočí.
  for (const v of o.volne) {
    const s = await docker.sit(v);
    if (!s) continue;
    zmerene.add(v);
    if (!s.interni) pridej(v, '(síť volného slotu není internal)');
    for (const c of s.clenove) {
      const m = await clen(c);
      if (cizi(m.identita, jenVstup)) pridej(v, m.jmeno);
    }
  }
  for (const [, n] of o.najemci) {
    const s = await docker.sit(n.sit);
    if (!s) continue; // síť nájemce není = nezměřeno (VB nájemce neobslouží)
    zmerene.add(n.sit);
    if (!s.interni || s.podsite.length !== 1 || s.podsite[0] !== n.podsit) pridej(n.sit, `(síť neodpovídá deklaraci: internal=${s.interni}, podsíť ${s.podsite.join(',') || '—'})`);
    for (const c of s.clenove) {
      const m = await clen(c);
      if (cizi(m.identita, n.smi)) pridej(n.sit, m.jmeno);
    }
  }
  // Přechodný člen (připojil se a mezi měřeními odešel) se posuzuje STEJNĚ jako živý. Identitu nese z OKAMŽIKU
  // připojení (štítky čtené při události); bez ní (zmizel dřív, než šel přečíst) platí jen živý stav → jinak cizí.
  for (const p of opts.prechodni ?? []) {
    const smi = p.sit === o.jadro.sit ? o.jadro.smi : o.volne.includes(p.sit) ? jenVstup : [...o.najemci.values()].find((n) => n.sit === p.sit)?.smi;
    const identita = p.identita ? { jmeno: p.jmeno, ...p.identita } : podleJmena.get(p.jmeno);
    if (smi && cizi(identita, smi)) pridej(p.sit, p.jmeno);
  }

  // 2: jmenné prostory. Cíl `container:` vykládá Docker (plné ID); řetěz se sleduje až
  // k vlastníkovi jmenného prostoru (`container:<klient>` je ve skutečnosti netns agenta).
  const chranene = new Map<string, { sit: string; agentNajemce?: string }>();
  for (const k of kontejnery) {
    if ((k.jmeno === o.vstup && operator(k)) || o.enginy.has(k.jmeno)) chranene.set(k.id, { sit: o.jadro.sit });
    for (const [id, n] of o.najemci) if (k.jmeno === n.agent) chranene.set(k.id, { sit: n.sit, agentNajemce: id });
  }
  // ŽÁDNÝ JEDINÝ VÝKLAD ODKAZU: Docker hledá `container:<ref>` nejdřív podle přesného jména,
  // pak podle předpony ID. Útočník se připojí odkazem na předponu ID vstupu a pak založí
  // návnadu POJMENOVANOU tou předponou — nové vyložení by ukázalo na návnadu. Kandidáty
  // proto jsou VŠECHNY výklady (plné ID, přesné jméno, předpona ID) + výklad Dockeru;
  // stačí, aby jediný vedl k chráněnému kontejneru.
  type Druh = 'síť' | 'pid' | 'ipc';
  const odkaz = (k: KontejnerDockeru, d: Druh) => (d === 'síť' ? k.sitRef : d === 'pid' ? k.pidRef : k.ipcRef);
  const dockerCil = (k: KontejnerDockeru, d: Druh) => (d === 'síť' ? k.sitCil : d === 'pid' ? k.pidCil : k.ipcCil);
  const kandidati = (k: KontejnerDockeru, d: Druh): KontejnerDockeru[] => {
    const ref = odkaz(k, d);
    if (!ref) return [];
    const out = new Map<string, KontejnerDockeru>();
    for (const c of kontejnery) {
      if (c.id === k.id) continue;
      if (c.id === ref || c.jmeno === ref || (/^[0-9a-f]+$/.test(ref) && c.id.startsWith(ref))) out.set(c.id, c);
    }
    const dc = dockerCil(k, d);
    if (dc && podleId.has(dc)) out.set(dc, podleId.get(dc)!);
    return [...out.values()];
  };
  /** Všichni možní vlastníci jmenného prostoru (řetěz přes VŠECHNY výklady, hloubka ≤ 8). */
  const vlastniciNs = (k: KontejnerDockeru, d: Druh): KontejnerDockeru[] => {
    const vysledek = new Map<string, KontejnerDockeru>();
    const videno = new Set([k.id]);
    const fronta: Array<[KontejnerDockeru, number]> = [[k, 0]];
    while (fronta.length > 0) {
      const [x, h] = fronta.shift()!;
      const dalsi = kandidati(x, d);
      if (dalsi.length === 0) {
        if (x !== k) vysledek.set(x.id, x);
        continue;
      }
      if (h >= 8) continue;
      for (const c of dalsi) {
        vysledek.set(c.id, c); // i mezičlánek: chráněný kontejner kdekoli v řetězu = zásah
        if (!videno.has(c.id)) {
          videno.add(c.id);
          fronta.push([c, h + 1]);
        }
      }
    }
    return [...vysledek.values()];
  };
  const varovani: string[] = [];
  for (const k of kontejnery) {
    for (const druh of ['síť', 'pid', 'ipc'] as const) {
      if (!odkaz(k, druh)) continue;
      const zasahy = vlastniciNs(k, druh).filter((v) => chranene.has(v.id));
      if (zasahy.length === 0) continue;
      // Jediná výjimka: klient nájemce PŘÍMO a JEDNOZNAČNĚ v síti svého agenta, ze stejného projektu.
      const prime = kandidati(k, druh);
      const v = prime.length === 1 ? prime[0] : undefined;
      const roleV = v ? chranene.get(v.id) : undefined;
      const agent = roleV?.agentNajemce !== undefined ? o.najemci.get(roleV.agentNajemce)! : undefined;
      const povoleno =
        druh === 'síť' && v !== undefined && agent !== undefined && zasahy.every((z) => z.id === v.id) &&
        k.jmeno === agent.klient && k.sluzba === 'svc-model' && k.projekt !== '' && (agent.aplikace === null || v.projekt === agent.aplikace) && k.projekt === v.projekt;
      if (povoleno) continue;
      for (const z of zasahy) pridej(chranene.get(z.id)!.sit, `${k.jmeno} (sdílí ${druh})`);
    }
    const vlastni = operator(k) ? svazkyOperatora.get(k.sluzba)! : new Set<string>();
    // 3: zápis do svazků operátora (jménem, cestou ve svazcích Dockeru, nebo jejich předkem).
    for (const m of k.pripojeni) {
      const z = m.zdroj?.replace(/\/+$/, '') || (m.zdroj ? '/' : undefined);
      const svazekOperatora = (m.typ === 'volume' && m.jmeno?.startsWith(`${vlastnik}-accel-`)) || (m.typ === 'bind' && z !== undefined && (z.startsWith(`${svazky}/${vlastnik}-accel-`) || z === svazky || z === '/' || svazky.startsWith(`${z}/`)));
      const svuj = m.typ === 'volume' && m.jmeno !== undefined && vlastni.has(m.jmeno);
      if (svazekOperatora && m.rw && !svuj) pridej(o.jadro.sit, `${k.jmeno} (zápis do svazků operátora: ${m.jmeno ?? m.zdroj})`);
      const socketProxy = k.sluzba === 'accel-docker-proxy' && operator(k) && m.typ === 'bind' && m.zdroj === '/var/run/docker.sock';
      if (m.zdroj?.endsWith('.sock') && !COOLIFY_INFRA.has(k.jmeno) && !socketProxy) varovani.push(`${k.jmeno}: ${m.zdroj}`);
    }
    if (COOLIFY_INFRA.has(k.jmeno)) continue;
    if (k.privilegovany) varovani.push(`${k.jmeno}: privileged`);
    for (const [druh, rezim] of [['síť', k.sit], ['pid', k.pid], ['ipc', k.ipc]] as const) if (rezim === 'host') varovani.push(`${k.jmeno}: ${druh} hostitele`);
  }

  // Držení incidentů.
  const iso = new Date(opts.ted).toISOString();
  const incidenty: Incidenty = {};
  const kliceSite = new Map([...o.najemci.values()].map((n) => [n.sit, n.klice]));
  for (const sit of new Set([...Object.keys(opts.drive ?? {}), ...nalez.keys()])) {
    const ted = [...(nalez.get(sit) ?? [])];
    const drive = opts.drive?.[sit];
    const klice = kliceSite.get(sit);
    // Náprava sítě nájemce: ŽÁDNÝ klíč platný v době incidentu už neplatí (rotace dokončená,
    // ne rozpracovaná [starý, nový]) a síť je teď čistá.
    if (drive && ted.length === 0 && drive.klice !== undefined && klice !== undefined && !drive.klice.some((k) => klice.includes(k))) continue;
    if (!drive && ted.length === 0) continue;
    incidenty[sit] = { od: drive?.od ?? iso, cizi: [...new Set([...(drive?.cizi ?? []), ...ted])].sort(), ...(sit === o.jadro.sit ? {} : { klice: drive?.klice ?? klice }) };
  }

  const stav = (sit: string) => (incidenty[sit] ? { ok: false, cizi: incidenty[sit].cizi.slice(0, 64) } : { ok: true, cizi: [] as string[] });
  const najemci: ClenstviData['najemci'] = {};
  for (const [id, n] of o.najemci) if (zmerene.has(n.sit) || incidenty[n.sit]) najemci[id] = stav(n.sit);
  return {
    data: {
      verze: 1,
      zmereno: iso,
      deklarace: opts.otiskDeklarace,
      jadro: stav(o.jadro.sit),
      najemci,
      // Volný slot nemá nájemce, kterého by šlo zastavit: cizí člen je VAROVÁNÍ (incident se drží do potvrzení operátora).
      varovani: [...new Set([...varovani, ...[...nevazane].map((j) => `${j}: nevázáno (deklarace uzlu bez aplikace_coolify)`), ...o.volne.filter((v) => incidenty[v]).map((v) => `${v}: cizí člen volného slotu (${incidenty[v].cizi.join(', ')})`)])].sort().slice(0, 64),
    },
    incidenty,
  };
}

/** Štítky, ze kterých se skládá identita (nastavuje je compose / Coolify, ne text compose forku). */
export function stitky(l: Record<string, string> | undefined): Omit<Identita, 'jmeno'> {
  return { projekt: l?.['com.docker.compose.project'] ?? '', sluzba: l?.['com.docker.compose.service'] ?? '', aplikace: l?.['coolify.applicationUuid'] ?? '' };
}

/** Docker Engine API přes unixový socket (jen čtení: inspect sítí a kontejnerů, proud událostí). */
/** Plné ID vlastního kontejneru z /proc/self/mountinfo (Docker připojuje /etc/hostname z
 *  `<kořen>/containers/<id>/`). Víc různých nebo žádné = null (neměřit). */
export function vlastniIdKontejneru(mountinfo?: string): string | null {
  let text = mountinfo;
  if (text === undefined) {
    try {
      text = readFileSync('/proc/self/mountinfo', 'utf8');
    } catch {
      return null;
    }
  }
  const ids = new Set([...text.matchAll(/\/containers\/([0-9a-f]{64})\//g)].map((m) => m[1]));
  return ids.size === 1 ? [...ids][0] : null;
}

export function dockerApi(socket = '/var/run/docker.sock', { vlastniId = () => vlastniIdKontejneru() }: { vlastniId?: () => string | null } = {}) {
  // Proud událostí drží svoje spojení navždy: dotazy (inspect) proto jdou JINÝM spojením,
  // jinak by čekaly ve frontě za nekonečnou odpovědí a hlídač by přestal měřit.
  const dotazy = new Pool('http://docker', { socketPath: socket, connections: 4, connect: { timeout: 2000 } });
  const proud = new Client('http://docker', { socketPath: socket, connect: { timeout: 2000 } });
  const get = async (path: string): Promise<unknown | null> => {
    // Bez verze v cestě: démon odpoví svou aktuální verzí API. Pevná verze v cestě by po upgradu Dockeru
    // (29+: minimum 1.44) padala a měření by zestárlo → VB neobslouží nikoho.
    const r = await dotazy.request({ path, method: 'GET', headersTimeout: 5000, bodyTimeout: 5000 });
    if (r.statusCode === 404) {
      await r.body.dump();
      return null;
    }
    if (r.statusCode !== 200) {
      await r.body.dump();
      throw new Error(`Docker API: ${path.split('?')[0]} vrátil ${r.statusCode}`);
    }
    return r.body.json();
  };
  /** Připojení z události: jméno A identita v OKAMŽIKU události (kontejner může do měření zmizet). */
  const pripojenyKontejner = async (sit: string, id: string): Promise<Prechodni> => {
    const k = (await get(`/containers/${encodeURIComponent(id)}/json`)) as { Name?: string; Config?: { Labels?: Record<string, string> } } | null;
    if (!k?.Name) return { sit, jmeno: `(zmizel ${id.slice(0, 12)})` };
    return { sit, jmeno: k.Name.replace(/^\//, ''), identita: stitky(k.Config?.Labels) };
  };
  /** Inspect jednoho kontejneru → KontejnerDockeru; `null` = mezitím smazán. */
  const nactiKontejner = async (id: string): Promise<KontejnerDockeru | null> => {
    const k = (await get(`/containers/${encodeURIComponent(id)}/json`)) as {
      Id: string;
      Name: string;
      Config?: { Labels?: Record<string, string> };
      HostConfig?: { NetworkMode?: string; PidMode?: string; IpcMode?: string; Privileged?: boolean };
      State?: { Running?: boolean; Restarting?: boolean };
      Mounts?: Array<{ Type?: string; Name?: string; Source?: string; RW?: boolean }>;
    } | null;
    if (!k) return null; // mezitím smazán
    // `container:<ref>` vyloží Docker sám (jméno, ID i libovolně krátká předpona) — žádný vlastní výklad.
    const vylozCil = async (rezim: string | undefined) => {
      if (!rezim?.startsWith('container:')) return null;
      const cilovy = (await get(`/containers/${encodeURIComponent(rezim.slice('container:'.length))}/json`)) as { Id?: string } | null;
      return cilovy?.Id ?? `(neexistuje: ${rezim.slice('container:'.length)})`;
    };
    const surovy = (rezim: string | undefined) => (rezim?.startsWith('container:') ? rezim.slice('container:'.length) : null);
    return {
      id: k.Id,
      jmeno: k.Name.replace(/^\//, ''),
      ...stitky(k.Config?.Labels),
      sitRef: surovy(k.HostConfig?.NetworkMode),
      pidRef: surovy(k.HostConfig?.PidMode),
      ipcRef: surovy(k.HostConfig?.IpcMode),
      sit: k.HostConfig?.NetworkMode ?? '',
      pid: k.HostConfig?.PidMode ?? '',
      ipc: k.HostConfig?.IpcMode ?? '',
      sitCil: await vylozCil(k.HostConfig?.NetworkMode),
      pidCil: await vylozCil(k.HostConfig?.PidMode),
      ipcCil: await vylozCil(k.HostConfig?.IpcMode),
      privilegovany: k.HostConfig?.Privileged === true,
      bezi: !(k.State?.Running === false && k.State?.Restarting !== true),
      pripojeni: (k.Mounts ?? []).map((m) => ({ typ: m.Type ?? '', ...(m.Name ? { jmeno: m.Name } : {}), ...(m.Source ? { zdroj: m.Source } : {}), rw: m.RW !== false })),
    };
  };
  const docker: Docker = {
    async sit(jmeno) {
      const n = (await get(`/networks/${encodeURIComponent(jmeno)}`)) as {
        Name?: string;
        Internal?: boolean;
        IPAM?: { Config?: Array<{ Subnet?: string }> };
        Containers?: Record<string, { Name?: string }>;
      } | null;
      if (!n) return null;
      // Inspect přijímá i ID nebo jeho předponu — bereme jen přesnou shodu jména.
      if (n.Name !== jmeno) throw new Error(`Docker API: síť '${jmeno}' se vrátila jako '${n.Name}'`);
      return {
        interni: n.Internal === true,
        podsite: (n.IPAM?.Config ?? []).map((x) => x.Subnet ?? '').filter(Boolean),
        clenove: Object.entries(n.Containers ?? {}).map(([id, k]) => ({ id, jmeno: k.Name ?? '(bez jména)' })),
      };
    },
    async kontejnery() {
      const seznam = ((await get('/containers/json?all=1')) as Array<{ Id: string }> | null) ?? [];
      const ven: KontejnerDockeru[] = [];
      for (const { Id } of seznam) {
        const k = await nactiKontejner(Id);
        if (k) ven.push(k);
      }
      return ven;
    },
    kontejner: (id) => nactiKontejner(id),
    async ja() {
      // PLNÉ ID, ne hostname: krátké ID z hostname Docker vykládá až PO přesném jménu, takže
      // kontejner pojmenovaný tou předponou by se vydával za hlídače (a za operátora).
      const id = vlastniId();
      if (!id) throw new Error('hlídač nezná své plné ID kontejneru (/proc/self/mountinfo) — neměřím');
      const k = (await get(`/containers/${id}/json`)) as { Id?: string; Config?: { Labels?: Record<string, string> } } | null;
      if (k?.Id !== id) throw new Error('Docker vrátil pro ID hlídače jiný kontejner — neměřím');
      return { projekt: k.Config?.Labels?.['com.docker.compose.project'] ?? '', id };
    },
    async korenDockeru() {
      const i = (await get('/info')) as { DockerRootDir?: string } | null;
      if (!i?.DockerRootDir) throw new Error('Docker API: /info bez DockerRootDir');
      return i.DockerRootDir;
    },
  };
  /**
   * Proud událostí: připojení kontejneru k síti (s jeho jménem — i když mezitím zmizel) a start
   * kontejneru. `pri` dostane připojení, nebo nic (jen podnět k měření). Výpadek = nové spojení po 5 s.
   */
  const sleduj = (pri: (pripojeni?: Prechodni) => void, chyba: (e: unknown) => void): (() => void) => {
    let konec = false;
    let ac = new AbortController();
    const filtr = encodeURIComponent(JSON.stringify({ type: ['network', 'container'], event: ['connect', 'start'] }));
    const smycka = async () => {
      while (!konec) {
        ac = new AbortController();
        try {
          const r = await proud.request({ path: `/events?filters=${filtr}`, method: 'GET', signal: ac.signal, bodyTimeout: 0, headersTimeout: 5000 });
          let zbytek = '';
          for await (const kus of r.body) {
            zbytek += String(kus);
            const radky = zbytek.split('\n');
            zbytek = radky.pop() ?? '';
            for (const radek of radky) {
              if (!radek.trim()) continue;
              let u: { Type?: string; Action?: string; Actor?: { Attributes?: Record<string, string> } };
              try {
                u = JSON.parse(radek);
              } catch {
                pri();
                continue;
              }
              const a = u.Actor?.Attributes ?? {};
              if (u.Type === 'network' && u.Action === 'connect' && a.name && a.container) pri(await pripojenyKontejner(a.name, a.container).catch(() => ({ sit: a.name, jmeno: `(nezjištěno ${a.container.slice(0, 12)})` })));
              else pri();
            }
          }
        } catch (e) {
          if (!konec) chyba(e);
        }
        if (!konec) await new Promise((x) => setTimeout(x, 5000).unref());
      }
    };
    void smycka();
    return () => {
      konec = true;
      ac.abort();
    };
  };
  return { docker, sleduj, zavri: async () => void (await Promise.all([dotazy.close(), proud.destroy()])) };
}

/** Zápis atomicky (dočasný soubor ve stejném adresáři + přejmenování): čtenář nikdy nevidí půlku. */
export function zapisAtomicky(cesta: string, data: unknown): void {
  const docasny = join(dirname(cesta), `.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(docasny, `${JSON.stringify(data)}\n`, { mode: 0o644 });
  renameSync(docasny, cesta);
}

/** Držené incidenty ze svazku hlídače. Chybí = žádné; nečitelné = výjimka (neměřit, nezapomenout). */
export function nactiIncidenty(cesta: string): Incidenty {
  let text: string;
  try {
    text = readFileSync(cesta, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
  const j = JSON.parse(text) as unknown;
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('incidenty.json není objekt');
  for (const [sit, i] of Object.entries(j as Record<string, Incident>)) {
    if (typeof i?.od !== 'string' || !Array.isArray(i.cizi)) throw new Error(`incidenty.json: neplatný záznam sítě ${sit}`);
  }
  return j as Incidenty;
}
