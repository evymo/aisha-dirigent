/**
 * Proaktivní obrana klepacího portu — rate-limit, krátkodobý cooldown, počitadla.
 *
 * ⛔ PROČ NE „trvalý ban podle zdrojové IP"
 * Zdrojová IP v UDP se podvrhne triviálně a listener zásadně neodpovídá (K2),
 * takže neexistuje handshake, který by dokázal, že odesílatel tu adresu vlastní.
 * Trvalý ban je proto **páka na DoS proti nám**: útočník pošle vadné knocky
 * jménem našeho uživatele a nechá ho odstřihnout. Navíc pro neověřený knock je
 * „ban" a „zahodit" navenek TOTÉŽ — zahazuje se tak jako tak. Ban tedy nepřidává
 * bezpečnost, jen šetří CPU při zaplavení.
 *
 * Čas se předává zvenčí (`nowSec`), aby to šlo testovat bez čekání.
 *
 * Přeneseno z `artefakty/spa-poc/spa-defense.mjs` (PoC, 109 testů) — chování se
 * nemění, jen se to učí mluvit TypeScriptem a bere klasifikaci důvodů ze
 * sdíleného balíčku, aby ta znalost zůstala na JEDNOM místě.
 */
import { deservesFreshCode, provesKeyPossession } from '@aisha/knock-protocol';

/** Bezpečnostní strop paměti — klepací port je veřejný, mapy nesmí růst bez konce. */
export const DEFAULT_MAX_TRACKED = 10_000;

export interface DefenseOptions {
  maxInvalid?: number;
  windowSec?: number;
  cooldownSec?: number;
  recentOkSec?: number;
  maxTracked?: number;
  alertAfter?: number;
  alertRepeatSec?: number;
  freshCodeMinGapSec?: number;
}

export interface InvalidOutcome {
  cooldownStarted: boolean;
  until?: number;
  after?: number;
  count?: number;
  /** Drží klíč z rosteru → ban nepatří. */
  keyHolder?: boolean;
  reason?: string;
  /** Klíč sedí, kód ne → doručit nový. */
  sendFreshCode?: boolean;
  freshCodeThrottled?: boolean;
  /** Adresa je autorizovaná; na té síti zkouší dveře ještě někdo jiný. */
  protected?: boolean;
  alert?: boolean;
}

export function createDefense(opts: DefenseOptions = {}) {
  const maxInvalid = opts.maxInvalid ?? 10;
  const windowSec = opts.windowSec ?? 60;
  const cooldownSec = opts.cooldownSec ?? 300;
  const recentOkSec = opts.recentOkSec ?? 3600;
  const maxTracked = opts.maxTracked ?? DEFAULT_MAX_TRACKED;
  const alertAfter = opts.alertAfter ?? 5;
  const alertRepeatSec = opts.alertRepeatSec ?? 3600;
  const freshCodeMinGapSec = opts.freshCodeMinGapSec ?? 600;

  const invalid = new Map<string, { count: number; windowStart: number }>();
  const cooling = new Map<string, number>();
  const lastOk = new Map<string, number>();
  const reasons = new Map<string, number>();
  const suspicious = new Map<string, { count: number; windowStart: number; lastAlertAt?: number }>();
  const freshCodeSent = new Map<string, number>();

  function prune(nowSec: number): void {
    for (const [k, exp] of cooling) if (exp <= nowSec) cooling.delete(k);
    for (const [k, v] of invalid) if (nowSec - v.windowStart > windowSec) invalid.delete(k);
    for (const [k, t] of lastOk) if (nowSec - t > recentOkSec) lastOk.delete(k);
  }

  // Strop se uplatňuje AŽ PO vložení — jinak mapa vždycky přeteče o ten jeden
  // záznam, který se přidal po úklidu, a deklarovaná mez by neplatila.
  function cap(): void {
    for (const m of [invalid, cooling, lastOk, suspicious] as Map<string, unknown>[]) {
      while (m.size > maxTracked) m.delete(m.keys().next().value as string);
    }
  }

  function isProtected(src: string, nowSec: number): boolean {
    const t = lastOk.get(src);
    return t !== undefined && nowSec - t <= recentOkSec;
  }

  return {
    /** Má se datagram zahodit dřív, než se na něj sáhne? */
    check(src: string, nowSec: number): { blocked: boolean; reason?: string; until?: number } {
      prune(nowSec);
      const exp = cooling.get(src);
      if (exp !== undefined && exp > nowSec) return { blocked: true, reason: 'cooldown', until: exp };
      return { blocked: false };
    },

    recordInvalid(src: string, nowSec: number, reason = 'invalid', kid: string | null = null): InvalidOutcome {
      prune(nowSec);
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);

      // ⭐ ZASTARALÝ KLÍČ NENÍ ÚTOK. Důvody za `bad-hmac` jsou dosažitelné až PO
      // ověření podpisu, takže takový knock prokazatelně drží klíč z rosteru.
      // Kdyby se počítal do banu, zabanovalo by se zařízení s rozejitými
      // hodinami SAMO — a to je přesně chvíle, kdy mu potřebujeme doručit nový kód.
      if (provesKeyPossession(reason)) {
        const out: InvalidOutcome = { cooldownStarted: false, keyHolder: true, reason };
        if (kid && deservesFreshCode(reason)) {
          const last = freshCodeSent.get(kid);
          // Bez odstupu by ten, kdo drží STARÝ ukradený klíč, generoval
          // notifikace donekonečna: přístup nezíská, ale otravovat by mohl.
          if (last === undefined || nowSec - last >= freshCodeMinGapSec) {
            freshCodeSent.set(kid, nowSec);
            cap();
            out.sendFreshCode = true;
          } else {
            out.freshCodeThrottled = true;
          }
        }
        return out;
      }

      if (isProtected(src, nowSec)) {
        // Adresa je autorizovaná a přesto se z ní špatně ťuká → někdo další na
        // téže síti. Cooldown nedostane (odstřihlo by to našeho uživatele), ale
        // uživatel se to má dozvědět.
        const rec = suspicious.get(src);
        if (!rec || nowSec - rec.windowStart > windowSec) {
          suspicious.set(src, { count: 1, windowStart: nowSec, lastAlertAt: rec?.lastAlertAt });
          cap();
          return { cooldownStarted: false, protected: true };
        }
        rec.count += 1;
        const tichoUplynulo = rec.lastAlertAt === undefined || nowSec - rec.lastAlertAt >= alertRepeatSec;
        if (rec.count >= alertAfter && tichoUplynulo) {
          rec.lastAlertAt = nowSec;
          return { cooldownStarted: false, protected: true, alert: true, count: rec.count, reason };
        }
        return { cooldownStarted: false, protected: true, count: rec.count };
      }

      const rec = invalid.get(src);
      if (!rec || nowSec - rec.windowStart > windowSec) {
        invalid.set(src, { count: 1, windowStart: nowSec });
        cap();
        return { cooldownStarted: false };
      }
      rec.count += 1;
      if (rec.count >= maxInvalid && !cooling.has(src)) {
        cooling.set(src, nowSec + cooldownSec);
        invalid.delete(src);
        cap();
        return { cooldownStarted: true, until: nowSec + cooldownSec, after: rec.count };
      }
      return { cooldownStarted: false, count: rec.count };
    },

    /** Úspěšný knock: ruší rozečtené okno i cooldown a zapíná ochranu zdroje. */
    recordSuccess(src: string, nowSec: number): void {
      prune(nowSec);
      lastOk.set(src, nowSec);
      invalid.delete(src);
      cooling.delete(src);
      cap();
      reasons.set('ok', (reasons.get('ok') ?? 0) + 1);
    },

    /** Souhrn pro audit — vzory mají být vidět bez pročítání každého řádku. */
    stats() {
      return {
        byReason: Object.fromEntries([...reasons.entries()].sort((a, b) => b[1] - a[1])),
        cooling: cooling.size,
        tracked: invalid.size,
        protectedSources: lastOk.size,
        suspiciousNetworks: suspicious.size,
      };
    },
  };
}

export type Defense = ReturnType<typeof createDefense>;
