/**
 * Dveře: kdo je právě za nimi.
 *
 * Mapa otevřených adres je **efemérní** — klidový stav je prázdno a každý řádek
 * vznikl jedním ověřeným zaťukáním a má TTL. Není to plošný allowlist (ten
 * pravidla instance zakazují), je to odvozený, adresný a časově omezený otvor.
 *
 * ⭐ PROČ REDIS A NE PAMĚŤ PROCESU
 * Protože mapa je **kontrakt mezi více zapisovateli**. Dnes do ní zapisuje
 * a čte brána; podle zadání majitele (2026-08-06) do ní bude zapisovat i
 * samostatný kontejner, který sleduje UDP zaťukání, a edge z ní bude číst.
 * Kdyby žila v paměti brány, musel by si ten kontejner vést vlastní evidenci —
 * a dvě evidence téhož znamenají dvě pravdy o tom, kdo je uvnitř.
 *
 * ⛔ FAIL-CLOSED
 * Nedostupná mapa znamená „nevím, kdo je za dveřmi", a na „nevím" se zavírá.
 * Fail-open by z výpadku úložiště udělal otevřené dveře.
 *
 * ⭐ AKTUALIZOVÁNO 2026-08-23: tady stálo, že `auth/jwt-revocation` je naopak
 * vědomě fail-open. To UŽ NEPLATÍ — odvolávání tokenů bylo téhož dne otočeno
 * na fail-closed poté, co se naostro ukázalo, co ta volnost dělá: nedosažitelný
 * Redis a gateway přijímající odvolané tokeny, zatímco navenek vše fungovalo.
 * Obě cesty tedy dnes na „nevím" zavírají.
 *
 * ⚠️ ROZDÍL ZŮSTÁVÁ V ZÁCHRANNÉ CESTĚ: dveře ji mají (`staticAllow` níž),
 * gateway zatím ne. Fail-closed bez cesty ven je poloviční řešení — riziko
 * zamčení se tím nezruší, jen přesune.
 *
 * ⚠️ Tím ale vzniká riziko zamčení (invariant K4), a proto je záchranná cesta
 * ZÁMĚRNĚ MIMO REDIS: `staticAllow` se vyhodnocuje z konfigurace, takže platí
 * i když je úložiště dole. Táž úvaha jako v PoC, kde statické výjimky bydlí
 * ve vlastní ipset — aby je „flush všech přístupů" nesmazal spolu se zbytkem.
 */
import type { Redis } from 'ioredis';
import { jeDuveryhodna, type TrustedEntry } from './client-ip.js';

const KLIC_IP = 'knock:ip:';
const KLIC_KID = 'knock:kid:';

export type Verdikt =
  | { allowed: true; via: 'static' | 'knock'; kid?: string; expiresIn?: number }
  | { allowed: false; via: 'blacklist' | 'closed' | 'unknown-client' | 'store-down' };

export interface DoorOptions {
  /** Klient z `createNamespacedRedis`. `null` = úložiště vypnuté → jede jen `staticAllow`. */
  redis: Redis | null;
  /** Trvale otevřené adresy (kancelář, bootstrap admin) — bez TTL, mimo Redis. */
  staticAllow?: readonly TrustedEntry[];
  /**
   * Zakázaná místa. Platí i na jinak platné zaťukání a i na staticky povolenou
   * adresu — jinak by se dvě nastavení přetahovala a vyhrálo by to laskavější.
   * Zákaz musí být silnější než povolení, jinak není zákazem.
   */
  blacklist?: readonly TrustedEntry[];
  /** Jak dlouho otvor platí. */
  ttlSec: number;
  /**
   * Kam ohlásit selhání úložiště.
   *
   * ⛔ Bez tohohle by se chyba Redisu spolkla beze stopy: volající sice dostane
   * `store-down`, ale PROČ se nedozví nikdo. Tichá degradace je nejhorší druh
   * poruchy — vypadá jako klid. Callback, ne logger, aby si balíček nepřitáhl
   * závislost, kterou React Native nepobere.
   */
  onError?: (op: 'open' | 'verdict' | 'closeForKid' | 'close' | 'prodluz' | 'ping', err: unknown) => void;
}

export function createDoor(opts: DoorOptions) {
  const staticAllow = opts.staticAllow ?? [];
  const blacklist = opts.blacklist ?? [];
  const ttlSec = Math.max(1, Math.floor(opts.ttlSec));

  return {
    /** Je úložiště nakonfigurované? Startu slouží k tomu, aby o tom mohl říct nahlas. */
    hasStore(): boolean {
      return opts.redis !== null;
    },

    /**
     * Odpovídá mapa DOOPRAVDY? `PING` s časovým limitem.
     *
     * ⛔ NAMĚŘENO 2026-09-15: `/ready` měřilo jen `hasStore()`, tedy existenci
     * KLIENTA — objekt, který vznikne i bez jediného spojení. Kontejner svc-knock
     * navíc sdílí netns držitele; po restartu držitele zůstane „running" v mrtvém
     * netns (jen `lo`) a mapu nevidí, a `/ready` hlásilo 200. Knock, který nemá
     * kam zapsat, je tichý výpadek — přesně ten, kvůli kterému `/ready` vzniklo.
     *
     * Limit je nutný: klient s frontou offline příkazů by na nedosažitelné
     * adrese čekal déle než healthcheck, a „nevím" se tu musí říct včas.
     */
    async ping(timeoutMs = 2000): Promise<boolean> {
      if (!opts.redis) return false;
      let casovac: ReturnType<typeof setTimeout> | undefined;
      try {
        const odpoved = await Promise.race([
          opts.redis.ping(),
          new Promise<never>((_, odmitni) => {
            casovac = setTimeout(() => odmitni(new Error(`PING mapy nedoběhl do ${timeoutMs} ms`)), timeoutMs);
          }),
        ]);
        return odpoved === 'PONG';
      } catch (e) {
        opts.onError?.('ping', e);
        return false;
      } finally {
        if (casovac) clearTimeout(casovac);
      }
    },

    /**
     * Otevře adresu na TTL a poznamená, komu patří.
     *
     * `kid` se drží v samostatné množině, aby šlo při odpojení zařízení zavřít
     * i to, co má právě otevřené. Bez toho by odvolané zařízení ještě TTL sekund
     * chodilo dovnitř — „nezaťuká si znovu" není totéž co „je venku".
     */
    async open(ip: string, kid: string): Promise<boolean> {
      if (!opts.redis) return false;
      if (jeDuveryhodna(ip, blacklist)) return false;
      try {
        const p = opts.redis.multi();
        p.set(KLIC_IP + ip, kid, 'EX', ttlSec);
        p.sadd(KLIC_KID + kid, ip);
        // Množina musí zestárnout taky, jinak by v Redisu zůstávaly seznamy
        // adres dávno zavřených dveří. Delší okno než otvor sám, ať se stihne
        // použít i na otvor otevřený těsně předtím.
        p.expire(KLIC_KID + kid, ttlSec * 2);
        await p.exec();
        return true;
      } catch (e) {
        opts.onError?.('open', e);
        return false;
      }
    },

    /**
     * ZAVŘE adresu okamžitě. Protipól `open` pro odhlášení.
     *
     * ⛔ Bez tohohle by odhlášení znamenalo jen „už si nezaťukám" — otvor by
     * ještě TTL sekund zůstal otevřený. Rozhodnutí majitele 2026-09-01:
     * „dokud je přihlášen, nebo dokud ho neodhlásíš z KC" — druhá půlka té
     * věty potřebuje mazání, ne čekání.
     *
     * Kid se z reverzní množiny odebírá taky: jinak by tam po odhlášení
     * zůstávaly adresy, které už nikomu nepatří, a hromadné zavření zařízení
     * by je zkoušelo zavírat podruhé.
     */
    async close(ip: string): Promise<boolean> {
      if (!opts.redis) return false;
      try {
        const kid = await opts.redis.get(KLIC_IP + ip);
        const p = opts.redis.multi();
        p.del(KLIC_IP + ip);
        if (kid) p.srem(KLIC_KID + kid, ip);
        await p.exec();
        return true;
      } catch (e) {
        opts.onError?.('close', e);
        return false;
      }
    },

    /**
     * PRODLOUŽÍ nájem adresy, která už otevřená JE. Nikdy neotevírá novou.
     *
     * ⛔ Rozdíl proti `open` je bezpečnostní: prodloužení volá brána po
     * úspěšném ověření tokenu, tedy na základě něčeho, co si klient přinesl.
     * Kdyby to umělo otevírat, stačil by platný token z jiné sítě a dveře by
     * se otevřely adrese, která NIKDY nezaťukala — zaťukání by přestalo být
     * podmínkou. Otevřít smí jen podepsané klepnutí.
     *
     * ⭐ Klouzavé okno, ne obnova na poslední chvíli: brána je ZA dveřmi, takže
     * po vypršení už se k ní žádný požadavek nedostane a nemá to kdo prodloužit.
     */
    async prodluz(ip: string): Promise<boolean> {
      if (!opts.redis) return false;
      if (jeDuveryhodna(ip, blacklist)) return false;
      try {
        const kid = await opts.redis.get(KLIC_IP + ip);
        if (!kid) return false; // není otevřeno — prodlužovat není co
        const p = opts.redis.multi();
        p.expire(KLIC_IP + ip, ttlSec);
        p.expire(KLIC_KID + kid, ttlSec * 2);
        await p.exec();
        return true;
      } catch (e) {
        opts.onError?.('prodluz', e);
        return false;
      }
    },

    /**
     * Rozhodne o jedné adrese. Pořadí je záměrné: zákaz → záchranná cesta →
     * mapa. Zákaz předbíhá i statickou výjimku; statická výjimka předbíhá mapu,
     * aby fungovala i při nedostupném úložišti (K4).
     */
    async verdict(ip: string | null): Promise<Verdikt> {
      // „Nevím, kdo je klient" není důvod pustit. Volající to dostane pojmenované,
      // aby v logu šlo odlišit špatně zapojenou proxy od zavřených dveří.
      if (!ip) return { allowed: false, via: 'unknown-client' };
      if (jeDuveryhodna(ip, blacklist)) return { allowed: false, via: 'blacklist' };
      if (jeDuveryhodna(ip, staticAllow)) return { allowed: true, via: 'static' };
      if (!opts.redis) return { allowed: false, via: 'store-down' };
      try {
        const p = opts.redis.multi();
        p.get(KLIC_IP + ip);
        p.ttl(KLIC_IP + ip);
        const out = await p.exec();
        const kid = (out?.[0]?.[1] ?? null) as string | null;
        const ttl = (out?.[1]?.[1] ?? -2) as number;
        if (!kid) return { allowed: false, via: 'closed' };
        return { allowed: true, via: 'knock', kid, expiresIn: ttl >= 0 ? ttl : undefined };
      } catch (e) {
        // Výpadek úložiště se NEPŘEVYPRÁVÍ na „zavřeno" — je to jiný stav a
        // obsluha ho musí umět odlišit od prázdné mapy. A musí se o něm dozvědět.
        opts.onError?.('verdict', e);
        return { allowed: false, via: 'store-down' };
      }
    },

    /**
     * Zavře vše, co má dané zařízení/osoba otevřené. Volá se při odvolání
     * pověření: odpojení musí zavřít i dveře, které jsou právě otevřené.
     */
    async closeForKid(kid: string): Promise<number> {
      if (!opts.redis) return 0;
      try {
        const ips = await opts.redis.smembers(KLIC_KID + kid);
        if (!ips.length) {
          await opts.redis.del(KLIC_KID + kid);
          return 0;
        }
        const p = opts.redis.multi();
        for (const ip of ips) p.del(KLIC_IP + ip);
        p.del(KLIC_KID + kid);
        await p.exec();
        return ips.length;
      } catch (e) {
        // ⚠️ Nezavřené dveře po odvolání jsou bezpečnostní událost, ne drobnost:
        // odvolané zařízení chodí dovnitř až do vypršení TTL.
        opts.onError?.('closeForKid', e);
        return 0;
      }
    },
  };
}

export type Door = ReturnType<typeof createDoor>;
