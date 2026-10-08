/**
 * Tabulka nájemců vynucovacího bodu — odvozená z deklarace uzlu, nikdy ručně.
 *
 * Deklaraci uzlu (operátorský overlay) vykládá jeden domov a do svazku VB z ní
 * zapíše `uzel.json`. VB ho čte, ověří CELÝ a teprve pak vymění tabulku najednou
 * (KJ1, KJ2). Nečitelný nebo neplatný soubor = DEKLARACE_NECITELNA pro všechny,
 * nikdy tichá stará tabulka ani „výchozí nájemce“ (X3).
 *
 * Klíče nájemců tu NEJSOU — jen otisky sha256 (KJ3). Klíč drží dispatch forku.
 */
import { z } from 'zod';
import { cisloVPodsiti, ipVPodsiti, parsujPodsit, podsitUvnitr, podsiteSePrekryvaji, type Podsit } from './sit-adresy.js';

const HEX64 = /^[0-9a-f]{64}$/;
/** Jméno adaptéru ve vLLM = prostor jmen nájemce: `<nájemce>.<jméno>` (nájemce vidí a volá jen své). */
export const ADAPTER = /^[a-z][a-z0-9-]{0,30}\.[a-z0-9][a-z0-9._-]{0,63}$/;

/** Uuid aplikace Coolify = projekt compose (`-p <uuid>`). Ochrana proti omylu — v raw režimu ho fork umí nastavit (O-2). */
const AplikaceCoolify = z.string().regex(/^[a-z0-9]{24}$/, 'uuid aplikace Coolify ([a-z0-9]{24})');
const IpV4 = z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/, 'IPv4 adresa');
const Cidr = z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, 'IPv4 CIDR');

const EngineSchema = z
  .object({
    druh: z.enum(['pooling', 'generate']),
    /** Adresa enginu na interní síti jádra (jen VB na ni dosáhne). */
    url: z.string().url(),
    zapnuto: z.boolean(),
    /** Jak dlouho smí engine startovat, než se z STARTUJE stane NEZDRAVY (z měření). */
    start_mez_s: z.number().int().positive(),
    /** Identita vah, kterou engine MUSÍ potvrdit (EM2) — změřená při stažení, ne převzatá. */
    identita: z.object({ format: z.string().min(1), sha256: z.string().regex(HEX64), revize: z.string().regex(/^[0-9a-f]{40}$/) }).strict(),
    /** Jméno modelu, pod kterým ho engine servíruje (served-model-name). */
    model: z.string().min(1),
    /** Zahřívací dotaz: plná deklarovaná délka (V6), syntetický text. */
    zahrati_tokenu: z.number().int().positive(),
    /** Část receptu, kterou drží lane (EM2) — jde do hlavičky odpovědi. */
    recept: z.string().min(1),
    /**
     * LoRA adaptéry enginu `generate` (jméno `<nájemce>.<adaptér>`). Načítá je za běhu VÝHRADNĚ vstup
     * (adaptery.ts) a jen odsud: z deklarovaného adresáře, po přeměření identity celého adresáře.
     */
    adaptery: z
      .record(
        z.string().regex(ADAPTER, 'adaptér <nájemce>.<jméno>'),
        z
          .object({
            sha256: z.string().regex(HEX64),
            revize: z.string().regex(/^[0-9a-f]{40}$/),
            /** Neměnný adresář ve svazku vah (RO, stáhl a změřil accel-vahy) — odsud a jen odsud se načítá. */
            adresar: z.string().regex(/^\/vahy\/[A-Za-z0-9._-]+@[0-9a-f]{40}$/, 'adresář /vahy/<repo>@<revize>'),
          })
          .strict(),
      )
      .optional(),
    /** Aplikace Coolify enginu (projekt compose). Je-li, hlídač ji vynucuje; chybí = jméno + služba a varování „nevázáno“. */
    aplikace_coolify: AplikaceCoolify.optional(),
  })
  .strict();

const KvotySchema = z
  .object({
    /** varovani = nad mez projde s varováním (x-aisha-kvota); vynucovat = 429 KVOTA_PREKROCENA. Bez výchozí hodnoty. */
    rezim: z.enum(['varovani', 'vynucovat']),
    okno_s: z.number().int().positive(),
    gpu_ms_za_okno: z.number().int().positive(),
    soubeh: z.object({ dotaz: z.number().int().positive(), davka: z.number().int().positive() }).strict(),
    davka_max_vstupu: z.number().int().positive(),
  })
  .strict();

/** Jméno nájemce: totéž pravidlo jako měření členství (clenstvi.ts) a deklarace operátora (accel-uzel.mjs). */
export const JMENO_NAJEMCE = /^[a-z][a-z0-9-]{0,30}$/;

const NajemceSchema = z
  .object({
    /** `rozsah_klientu` = odkud smějí volat klienti nájemce (--ip-range jeho sítě); VB stojí mimo něj (N1). */
    sit: z.object({ podsit: Cidr, vstup_ip: IpV4, rozsah_klientu: Cidr }).strict(),
    /** Otisky platných klíčů — při rotaci [starý, nový], pak [nový] (KJ2). */
    otisky: z.array(z.string().regex(HEX64, 'otisk sha256 (64 hex)')).min(1).max(2),
    vypnuto: z.boolean(),
    trida_duvery: z.string().min(1),
    /** Diagnostika operátora (sonda): smí mířit na engine jiného nájemce. Jinak engine na nájemce (O-4). */
    diagnostika: z.boolean().optional(),
    /** Aliasy nájemce → engine (V1–V3: nájemce vidí jen své). */
    // max_tokenu: u pooling obsah vstupu bez speciálních tokenů, u generate strop vygenerovaných tokenů.
    modely: z.record(
      z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'alias bez lomítka'),
      z.object({ engine: z.string().min(1), max_tokenu: z.number().int().positive(), adapter: z.string().regex(ADAPTER).optional() }).strict(),
    ),
    kvoty: KvotySchema,
    /** Aplikace Coolify tenkého stacku nájemce (projekt compose agenta). Je-li, vynucuje se; chybí = varování „nevázáno“. */
    aplikace_coolify: AplikaceCoolify.optional(),
  })
  .strict();

export const UzelSchema = z
  .object({
    verze: z.literal(1),
    enginy: z.record(z.string().regex(/^[a-z0-9-]+$/), EngineSchema),
    // Jméno nájemce stejně jako v měření hlídače (clenstvi.ts): jiné by měření nepřečetlo → nikdo.
    najemci: z.record(z.string().regex(JMENO_NAJEMCE, 'jméno nájemce [a-z][a-z0-9-]{0,30}'), NajemceSchema),
  })
  .strict();

export type Uzel = z.infer<typeof UzelSchema>;
export type Engine = z.infer<typeof EngineSchema> & { id: string };
export type Kvoty = z.infer<typeof KvotySchema>;

export interface Najemce {
  id: string;
  podsit: Podsit;
  /** Jen odsud je klient nájemce (identita) — ne celá podsíť: brána .1 je hostitel. */
  rozsahKlientu: Podsit;
  vstupIp: string;
  otisky: Buffer[];
  vypnuto: boolean;
  tridaDuvery: string;
  modely: Map<string, { engine: string; maxTokenu: number; adapter?: string }>;
  kvoty: Kvoty;
  /** Projekt compose (uuid aplikace Coolify) tenkého stacku, nebo null = nevázáno. */
  aplikaceCoolify: string | null;
}

export interface Tabulka {
  /** Adresa vstupu (VB na síti nájemce) → nájemce. */
  podleVstupIp: Map<string, Najemce>;
  najemci: Map<string, Najemce>;
  /** Všechny otisky všech nájemců (rozliší KLIC_JINEHO_VSTUPU od KLIC_NEPLATNY). */
  vsechnyOtisky: Set<string>;
  enginy: Map<string, Engine>;
}

/** Ověř a postav tabulku. Chyba = seznam vad (všechny najednou), nikdy částečná tabulka. */
export function postavTabulku(surovy: unknown): { tabulka: Tabulka } | { vady: string[] } {
  const r = UzelSchema.safeParse(surovy);
  if (!r.success) return { vady: r.error.issues.map((i) => `${i.path.join('.') || '(kořen)'}: ${i.message}`) };
  const u = r.data;
  const vady: string[] = [];
  const enginy = new Map<string, Engine>(Object.entries(u.enginy).map(([id, e]) => [id, { ...e, id }]));
  const najemci = new Map<string, Najemce>();
  const podleVstupIp = new Map<string, Najemce>();
  const vsechnyOtisky = new Set<string>();
  const podsite: Array<[string, Podsit]> = [];

  for (const [id, n] of Object.entries(u.najemci)) {
    let podsit: Podsit;
    try {
      podsit = parsujPodsit(n.sit.podsit);
    } catch (e) {
      vady.push(`najemci.${id}.sit.podsit: ${(e as Error).message}`);
      continue;
    }
    if (!ipVPodsiti(n.sit.vstup_ip, podsit)) vady.push(`najemci.${id}.sit.vstup_ip: adresa vstupu leží mimo podsíť nájemce`);
    let rozsahKlientu: Podsit;
    try {
      rozsahKlientu = parsujPodsit(n.sit.rozsah_klientu);
    } catch (e) {
      vady.push(`najemci.${id}.sit.rozsah_klientu: ${(e as Error).message}`);
      continue;
    }
    if (!podsitUvnitr(rozsahKlientu, podsit)) vady.push(`najemci.${id}.sit.rozsah_klientu: rozsah klientů leží mimo podsíť nájemce`);
    if (ipVPodsiti(n.sit.vstup_ip, rozsahKlientu)) vady.push(`najemci.${id}.sit.rozsah_klientu: zahrnuje adresu vstupu — vstup lane stojí na pevné adrese mimo klienty`);
    // Brána sítě (první adresa podsítě) je HOSTITEL uzlu, ne klient — nesmí ležet v rozsahu klientů (N1).
    if (cisloVPodsiti((podsit.sit + 1) >>> 0, rozsahKlientu)) vady.push(`najemci.${id}.sit.rozsah_klientu: zahrnuje bránu podsítě (hostitel uzlu)`);
    for (const [jiny, p] of podsite) if (podsiteSePrekryvaji(p, podsit)) vady.push(`najemci.${id}.sit.podsit: překrývá se s podsítí nájemce ${jiny}`);
    podsite.push([id, podsit]);
    if (podleVstupIp.has(n.sit.vstup_ip)) vady.push(`najemci.${id}.sit.vstup_ip: adresu vstupu má už jiný nájemce`);
    for (const [alias, m] of Object.entries(n.modely)) {
      const e = enginy.get(m.engine);
      if (!e) {
        vady.push(`najemci.${id}.modely.${alias}: engine '${m.engine}' deklarace nezná`);
        continue;
      }
      if (m.adapter === undefined) continue;
      if (e.druh !== 'generate') vady.push(`najemci.${id}.modely.${alias}: adaptér jen u enginu generate (engine '${m.engine}' je ${e.druh})`);
      else if (!e.adaptery?.[m.adapter]) vady.push(`najemci.${id}.modely.${alias}: adaptér '${m.adapter}' engine '${m.engine}' nedeklaruje`);
      if (!m.adapter.startsWith(`${id}.`)) vady.push(`najemci.${id}.modely.${alias}: adaptér '${m.adapter}' není v prostoru jmen nájemce (${id}.<jméno>)`);
      const d = e.adaptery?.[m.adapter];
      if (d && !d.adresar.endsWith(`@${d.revize}`)) vady.push(`enginy.${m.engine}.adaptery.${m.adapter}: adresář ${d.adresar} nenese revizi ${d.revize}`);
    }
    for (const o of n.otisky) {
      if (vsechnyOtisky.has(o)) vady.push(`najemci.${id}.otisky: otisk klíče sdílí s jiným nájemcem — klíč musí být po forku (MJ2)`);
      vsechnyOtisky.add(o);
    }
    const najemce: Najemce = {
      id,
      podsit,
      rozsahKlientu,
      vstupIp: n.sit.vstup_ip,
      otisky: n.otisky.map((o) => Buffer.from(o, 'hex')),
      vypnuto: n.vypnuto,
      tridaDuvery: n.trida_duvery,
      modely: new Map(Object.entries(n.modely).map(([a, m]) => [a, { engine: m.engine, maxTokenu: m.max_tokenu, ...(m.adapter ? { adapter: m.adapter } : {}) }])),
      kvoty: n.kvoty,
      aplikaceCoolify: n.aplikace_coolify ?? null,
    };
    najemci.set(id, najemce);
    podleVstupIp.set(n.sit.vstup_ip, najemce);
  }
  // Jedna aplikace Coolify = jeden engine nebo jeden nájemce: sdílená vazba by pustila cizí stack pod cizí identitou.
  const aplikace = new Map<string, string>();
  for (const [id, e] of Object.entries(u.enginy)) {
    if (!e.aplikace_coolify) continue;
    const jiny = aplikace.get(e.aplikace_coolify);
    if (jiny) vady.push(`enginy.${id}.aplikace_coolify: aplikaci už má ${jiny}`);
    else aplikace.set(e.aplikace_coolify, `enginy.${id}`);
  }
  for (const [id, n] of Object.entries(u.najemci)) {
    if (/^volny-\d+$/.test(id)) vady.push(`najemci.${id}: jméno volny-<n> patří volným slotům compose vstupu`);
    if (!n.aplikace_coolify) continue;
    const jiny = aplikace.get(n.aplikace_coolify);
    if (jiny) vady.push(`najemci.${id}.aplikace_coolify: aplikaci už má ${jiny}`);
    else aplikace.set(n.aplikace_coolify, `najemci.${id}`);
  }
  // Engine na nájemce (O-4): gpu_ms = obsazení enginu, a to jde přičíst jen jedinému nájemci.
  const drzitel = new Map<string, string>();
  for (const [id, n] of Object.entries(u.najemci)) {
    if (n.diagnostika) continue;
    for (const engine of new Set(Object.values(n.modely).map((m) => m.engine))) {
      const jiny = drzitel.get(engine);
      if (jiny && jiny !== id) vady.push(`najemci.${id}: engine '${engine}' už slouží nájemci ${jiny} — engine na nájemce (O-4); sdílet smí jen diagnostika`);
      else drzitel.set(engine, id);
    }
  }
  if (vady.length > 0) return { vady };
  return { tabulka: { podleVstupIp, najemci, vsechnyOtisky, enginy } };
}
