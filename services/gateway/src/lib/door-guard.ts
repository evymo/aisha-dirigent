/**
 * Čtenář dveří na cestě požadavku.
 *
 * `svc-knock` do mapy otevřených adres ZAPISUJE, ale do 2026-08-08 ji nikdo
 * NEČETL — `createDoor` importoval v celém repu jen svc-knock sám. Platné
 * zaťukání tedy neotevřelo nic; dveře měly zapisovatele a neměly čtenáře.
 * Tohle je ten čtenář.
 *
 * ⭐ ROZHODNUTÍ MAJITELE (2026-08-08): **všechno, nebo nic.** Kdo není za
 * dveřmi, nedostane se k ničemu — ani k přihlášení. Zveřejnit něco (web, API)
 * je samostatná volba, kterou instance zatím nepotřebuje.
 *
 * ⭐ MÍSTO ODMÍTNUTÍ FORWARD — ale jen prohlížeči. Neznámá adresa má odejít na
 * adresu z administrace, aby zvenčí nebylo poznat, že tu něco je. API klient
 * ale potřebuje JEDNOZNAČNÝ signál: telefon podle něj pozná „jsem zamčený" a
 * teprve v tom stavu smí nabídnout zaťukání. Kdyby dostal forward, viděl by
 * odpověď cizí adresy (klidně 200 s HTML), vyhodnotil ji jako vadu svých dat
 * a po třech pokusech by zahodil práci, kterou řidič odvedl v terénu.
 * Nenápadnost patří neznámé adrese, ne našemu vlastnímu telefonu.
 *
 * ⭐ ODMÍTNUTÍ SE OZNAČUJE (2026-08-19, zadání majitele: *„vyhodnocení odpovědi
 * edge musí být jednoznačné — buď ho to přesměruje pryč a je problém
 * s dveřníkem, nebo mu to řekne ty chyby a víme, že je to na úrovni perms"*).
 *
 * Prohlížeč to má jednoznačné (307 pryč). API klient dostával holý 403 — jenže
 * **403 posílá i aplikace**, když člověk na ten úkon nemá nárok: PostgREST tak
 * vydává `errcode 42501` a osm míst v SoT ho používá („tenhle krok už není
 * tvůj"). Telefon ty dva případy nerozlišil a dispečerské přehození dodávky
 * mu zaseklo CELOU offline frontu a nabídlo zaťukání, přestože jeho identita
 * byla v pořádku.
 *
 * Hlavička `x-aisha-door: locked` ten rozdíl dělá JEDNOZNAČNÝM na naší straně.
 * ⚠️ Vědomě NE odvozováním z toho, že tělo nemá `code`: takové měřidlo by
 * stálo na tvaru cizí odpovědi, který nemáme čím doložit — a mlčky by přestalo
 * platit, kdyby PostgREST tvar změnil. Dveřník je NÁŠ, tak se označí sám.
 *
 * ⚠️ Neprozrazuje PROČ (to je dál zakázané) — říká jen ČÍ to odmítnutí je.
 * Nenápadnost tím netrpí: holý 403 už dnes API klientovi prozrazuje totéž,
 * a to je vědomá volba („nenápadnost patří neznámé adrese, ne našemu telefonu").
 *
 * ⛔ FAIL-CLOSED, na rozdíl od `auth/jwt-revocation`. Odvolávání tokenů je
 * vědomě fail-open (nedostupný Redis nesmí odstřihnout všechny). Tady je to
 * obráceně: nedostupná mapa znamená „nevím, kdo je za dveřmi", a na „nevím" se
 * zavírá. Fail-open by z výpadku úložiště udělal otevřené dveře.
 *
 * ⚠️ BEZ `staticAllow` (volba majitele): žádná trvalá výjimka neexistuje, takže
 * výpadek Redisu zamkne VŠECHNY včetně provozovatele a náprava vede jen přes
 * přímý přístup ke stroji. Právě proto se začíná režimem `measure`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { clientIpFrom, type TrustedEntry } from '@aisha/knock-protocol';
import { createDoor, type Verdikt } from '@aisha/knock-protocol/door';
import type { Redis } from 'ioredis';

/**
 * `off` — hook se vůbec nezaregistruje (instance dveře nemá).
 * `measure` — spočítá verdikt a ZAPÍŠE ho, ale pustí každého.
 * `enforce` — zavírá.
 *
 * ⭐ `measure` není opatrnost navíc, je to měřidlo: klientská adresa se odvozuje
 * z `x-forwarded-for` ZPRAVA přes seznam našich proxy, a špatně nastavený
 * seznam by zavřel dveře před správnými lidmi. Ostrý režim se tedy zapíná až
 * poté, co je z reálného provozu vidět, koho by hook odmítl.
 */
export type DoorMode = 'off' | 'measure' | 'enforce';

export interface DoorGuardOptions {
  mode: DoorMode;
  /** Klient z `createNamespacedRedis`. `null` = úložiště není → fail-closed. */
  redis: Redis | null;
  ttlSec: number;
  /** Naše proxy — bez nich by si klient adresu nadiktoval hlavičkou. */
  trustedProxies: readonly TrustedEntry[];
  /** Kam odejde prohlížeč od zavřených dveří. Instanční hodnota z administrace. */
  forwardUrl: string;
  blacklist?: readonly TrustedEntry[];
  /** Kam hlásit verdikty. Callback, ať si modul netahá logger. */
  onVerdict?: (zaznam: DoorEvent) => void;
}

export interface DoorEvent {
  mode: DoorMode;
  /** `null` = adresu nešlo odvodit. Pro řízení přístupu je to „zavřeno". */
  ip: string | null;
  verdict: Verdikt['via'] | 'no-client-ip';
  allowed: boolean;
  /** Co se s požadavkem stalo doopravdy (v `measure` vždy `pass`). */
  action: 'pass' | 'forward' | 'deny';
  path: string;
  /**
   * VSTUP, ze kterého `ip` vznikla — vyplněný JEN v `measure`.
   *
   * ⛔ 2026-08-31: `measure` hlásil `ip:null` a nic víc. Závěr bez vstupu se
   * nedá přezkoumat, takže se třikrát po sobě HÁDALO, kterou hlavičkou
   * klientská adresa přichází, místo aby se přečetla. Měřidlo, které
   * neukazuje, co změřilo, není měřidlo.
   *
   * Univerzum se HLEDÁ, nepíše: bere se každá hlavička, jejíž hodnota nese
   * adresu — ať si ji předřazený prvek pojmenuje jakkoli. Ruční výčet by
   * spolkl přesně tu jedinou, kterou neznáme.
   */
  vstup?: Record<string, string>;
}

/**
 * Cesty, které dveře nehlídají.
 *
 * Jen zdraví — a to úmyslně úzce: kdyby se hlídalo i ono, zavřené dveře by
 * vypadaly jako mrtvá služba a orchestrátor by kontejner recykloval dokola.
 * Diagnostika musí zůstat možná i zavřeno, jinak se porucha dveří nedá odlišit
 * od poruchy služby.
 */
const MIMO_DVERE = new Set(['/health', '/api/health']);

/**
 * Značka odmítnutí OD DVEŘNÍKA. Klient podle ní pozná „jsem zamčený" a jen
 * v tom stavu smí nabídnout zaťukání; 403 bez ní je odpověď APLIKACE (nárok).
 *
 * Jméno je součást kontraktu s klientem — `api-core` ho čte a překládá na
 * `code`, aby offline fronta nemusela sahat na hlavičky.
 */
export const DOOR_HEADER = 'x-aisha-door';
export const DOOR_HEADER_VALUE = 'locked';

/** Ptá se prohlížeč? Rozhoduje o forwardu vs. jednoznačném odmítnutí. */
export function jePozadavekProhlizece(accept: string | string[] | undefined): boolean {
  const raw = Array.isArray(accept) ? accept.join(',') : (accept ?? '');
  // `text/html` musí být VYJMENOVANÉ. `*/*` posílá curl i každý API klient,
  // takže brát ho jako prohlížeč by poslalo telefon na forward — přesně to,
  // čemu se tenhle modul vyhýbá.
  return raw.toLowerCase().includes('text/html');
}

/**
 * Hlavičky, které NESOU ADRESU — hledané, ne vyjmenované.
 *
 * Předřazené prvky (HAProxy, Traefik, Caddy) si klientskou adresu pojmenují
 * po svém: `x-forwarded-for`, `x-real-ip`, `x-client-ip`, `forwarded`,
 * `cf-connecting-ip`, … Ruční seznam by z nich znal jen ty, na které jsme si
 * vzpomněli — a ta jediná chybějící je vždycky ta, kterou hledáme.
 *
 * Proto se tu nic nevyjmenovává: projde se CELÁ hlavičková sada a vezme se
 * každá, jejíž hodnota obsahuje IPv4 nebo IPv6 token. `cookie` a
 * `authorization` se vynechávají — nesou tajemství, ne adresy.
 */
const NIKDY_NELOGOVAT = new Set(['cookie', 'authorization', 'proxy-authorization']);
/** Strop dřív než test: hodnota je vstup zvenku, měřidlo nesmí jít zahltit. */
const STROP = 512;
const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6_ZNAKY = /^[0-9a-f:]+$/i;

/**
 * Nese token adresu? Testuje se PO ROZDĚLENÍ na tokeny, ne výrazem přes celou
 * hodnotu: vnořené kvantifikátory nad řetězcem, který si píše návštěvník, jsou
 * ReDoS (ESLint `security/detect-unsafe-regex`). Tohle je lineární.
 */
function jeAdresa(token: string): boolean {
  if (IPV4.test(token)) return true;
  return token.length >= 3 && token.length <= 45 && token.includes(':') && IPV6_ZNAKY.test(token);
}

export function hlavickySAdresou(
  headers: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const klic = k.toLowerCase();
    if (NIKDY_NELOGOVAT.has(klic)) continue;
    const cela = Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '';
    if (!cela) continue;
    const hodnota = cela.length > STROP ? `${cela.slice(0, STROP)}…` : cela;
    if (!hodnota.split(/[\s,;=]+/).some(jeAdresa)) continue;
    out[klic] = hodnota;
  }
  return out;
}

export function rozhodni(
  verdikt: Verdikt,
  ip: string | null,
  mode: DoorMode,
  path: string,
  prohlizec: boolean,
  vstup?: Record<string, string>,
): DoorEvent {
  const via = ip === null ? ('no-client-ip' as const) : verdikt.via;
  const allowed = ip !== null && verdikt.allowed;
  // V měřicím režimu se verdikt spočítá a zapíše, ale NIC se nezavře. Kdyby
  // měření zavíralo, nebylo by to měření.
  const action: DoorEvent['action'] =
    mode !== 'enforce' || allowed ? 'pass' : prohlizec ? 'forward' : 'deny';
  // Vstup se přikládá jen v `measure`: tam je záznam JEDINÝ výstup a bez
  // vstupu nepřezkoumatelný. V `enforce` je hodnotou verdikt, ne materiál.
  return mode === 'measure'
    ? { action, allowed, ip, mode, path, verdict: via, vstup: vstup ?? {} }
    : { action, allowed, ip, mode, path, verdict: via };
}

/**
 * Zaregistruje hook. Při `mode: 'off'` neudělá nic — instance bez dveří tak
 * nenese ani jejich režii, ani riziko.
 */
export function registerDoorGuard(app: FastifyInstance, opts: DoorGuardOptions): void {
  if (opts.mode === 'off') return;

  const door = createDoor({
    // Bez trvalých výjimek: rozhodnutí majitele 2026-08-08. Jediná cesta dovnitř
    // je zaťukání, takže tu vědomě NENÍ záchranná cesta mimo Redis.
    blacklist: opts.blacklist ?? [],
    redis: opts.redis,
    staticAllow: [],
    ttlSec: opts.ttlSec,
    onError: (op, err) => opts.onVerdict?.({
      action: 'deny', allowed: false, ip: null, mode: opts.mode,
      path: `door:${op}:${err instanceof Error ? err.message : 'chyba'}`, verdict: 'store-down',
    }),
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (MIMO_DVERE.has(req.url.split('?')[0])) return;

    const ip = clientIpFrom(req.headers['x-forwarded-for'], opts.trustedProxies);
    // `null` = adresu nešlo odvodit (hlavička chybí, je nečitelná, nebo jsou v
    // ní samé naše proxy). Pro řízení přístupu se na „nevím" ZAVÍRÁ, nedosazuje
    // se adresa socketu — ta by za proxy ukazovala na proxy, tedy na nás.
    const verdikt: Verdikt = ip === null
      ? { allowed: false, via: 'unknown-client' }
      : await door.verdict(ip);

    const ev = rozhodni(
      verdikt,
      ip,
      opts.mode,
      req.url,
      jePozadavekProhlizece(req.headers.accept),
      // Vstup se sbírá jen v `measure` — jinde by to byl náklad bez odběratele.
      opts.mode === 'measure'
        ? hlavickySAdresou(req.headers as Record<string, unknown>)
        : undefined,
    );
    opts.onVerdict?.(ev);

    if (ev.action === 'forward') {
      // 307 zachová metodu i tělo — návštěvník se má ocitnout jinde, ne přijít
      // o to, co odesílal.
      await reply.code(307).header('location', opts.forwardUrl).send();
      return reply;
    }
    if (ev.action === 'deny') {
      // Bez těla a bez podrobností: odmítnutí nesmí prozradit, PROČ — ale MUSÍ
      // prozradit ČÍ je, jinak ho klient nerozliší od odmítnutí nároku, které
      // aplikace posílá týmž statusem (viz hlavička souboru).
      await reply.code(403).header(DOOR_HEADER, DOOR_HEADER_VALUE).send();
      return reply;
    }
    return;
  });
}
