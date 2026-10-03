/**
 * Relace TABLETU (F2) — vstup do aplikace BEZ přihlášeného člověka.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-29): „po validaci otisku resp. zařazení, jeho podpis resp.
 * klepání odemyká … a následně je možnost se dostat do aplikace bez přihlášení pouze
 * k našim dodákům“. Klíč zůstává ten z ohlášení (Keystore je navazující úkol).
 *
 * Schválený tablet si podepsaným požadavkem (AISHA-REQ1, týž klíč jako ohlášení a klepání)
 * vezme u brány krátkou relaci svého účtu: `POST /auth/v1/device/session`. Token nese jen
 * „kdo mluví“ — co uvidí, rozhoduje server při KAŽDÉM volání (rozsah instance, platný
 * průkaz). Odvolání v administraci tedy platí hned, i uprostřed platnosti tokenu.
 *
 * ⭐ ČISTÉ JÁDRO jako `ohlaseniTabletu.ts`: síť, podpis i čas přicházejí parametrem.
 */
import { signDeviceRequest, utf8Encode } from "@aisha/knock-protocol";
import type { PovereniZarizeni } from "./poverovani-zarizeni";
import { DEVICE_AUDIENCE, type TabletDeps } from "./ohlaseniTabletu";

export const CESTA_RELACE = "/auth/v1/device/session";
/** Obnovit tolik sekund PŘED koncem — jako `REFRESH_BUFFER_SEC` u přihlášení člověka. */
export const REZERVA_OBNOVY_S = 60;

export interface RelaceTabletu {
  token: string;
  /** Unixové sekundy. */
  vyprsi: number;
  kid: string;
  /** Účet zařízení (uid) — identita offline fronty a paměti přebírajícího. */
  uzivatel: string;
}

export type VysledekRelace =
  | { stav: "ok"; relace: RelaceTabletu }
  /** Tablet ještě nemá klíč (nezavedený) — relace není o co opřít. */
  | { stav: "bez-klice" }
  /** 403 dveře: relaci si tablet bere jen ze sítě, kterou otevřelo zaťukání. */
  | { stav: "dvere-zavrene" }
  /** 403 průkaz čeká / je odvolaný / vypršel — důvod od brány. */
  | { stav: "neschvaleno"; duvod: string }
  /** 404 brána průkaz nezná (smazaný / neohlášený) — ohlásit znovu. */
  | { stav: "nezname" }
  /** 429 strop relací — appka se točí ve smyčce. */
  | { stav: "prilis-casto" }
  | { stav: "selhalo"; duvod: string };

async function teloOdpovedi(odpoved: Response): Promise<Record<string, unknown>> {
  try {
    const t = (await odpoved.json()) as unknown;
    return t && typeof t === "object" ? (t as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Jeden podepsaný požadavek o relaci. */
export async function vezmiRelaci(p: PovereniZarizeni, deps: TabletDeps): Promise<VysledekRelace> {
  try {
    const url = `${(await deps.zakladUrl()).replace(/\/+$/, "")}${CESTA_RELACE}`;
    const hlavicky = signDeviceRequest(
      deps.crypto,
      { audience: DEVICE_AUDIENCE, method: "POST", target: CESTA_RELACE, body: utf8Encode(""), kid: p.kid, ts: deps.nowSec() },
      (zprava) => deps.podepis(p.privateKeyPem, zprava),
    );
    const odpoved = await deps.fetch(url, { headers: hlavicky, method: "POST" });
    const t = await teloOdpovedi(odpoved);
    // ⛔ O PRŮKAZU ROZHODUJE VÝSLOVNÁ ODPOVĚĎ BRÁNY, NE STAVOVÝ KÓD (naměřeno 29. 9. na
    // tabletu). 404 vrací i server, který cestu /device/session ještě nemá („Route …
    // not found"), 403 umí i proxy před ním. Appka z holé 404 udělala „tablet není
    // ohlášený — zaveďte ho znovu", zahodila známou identitu (offline fronta by pak
    // předání odmítla jako cizí) a nabízela zapomenout klíč, který čekal na schválení.
    // Brána odpovídá vždy s `error`; cokoli jiného je porucha cesty = selhalo.
    if (odpoved.status === 403 && t.error === "dvere_zavrene") return { stav: "dvere-zavrene" };
    if (odpoved.status === 403 && t.error === "neschvaleno") {
      return { stav: "neschvaleno", duvod: typeof t.duvod === "string" ? t.duvod : "neplatne" };
    }
    if (odpoved.status === 404 && t.error === "nezname") return { stav: "nezname" };
    if (odpoved.status === 429) return { stav: "prilis-casto" };
    const u = (t.user ?? {}) as { id?: unknown };
    if (odpoved.ok && typeof t.access_token === "string" && typeof t.expires_at === "number" && typeof u.id === "string") {
      return { stav: "ok", relace: { token: t.access_token, vyprsi: t.expires_at, kid: p.kid, uzivatel: u.id } };
    }
    const duvod = [t.error, t.duvod].filter((x) => typeof x === "string").join(": ");
    return { stav: "selhalo", duvod: `HTTP ${odpoved.status}${duvod ? ` ${duvod}` : ""}` };
  } catch (e) {
    return { stav: "selhalo", duvod: e instanceof Error ? e.message : String(e) };
  }
}

export interface ZdrojRelace {
  /** Platný token, nebo null (tablet relaci nedostal — důvod v `posledni()`). */
  token(): Promise<string | null>;
  /**
   * Uid účtu zařízení z poslední platné relace. ⛔ Přežije výpadek sítě: offline fronta
   * podle něj pozná SVOU práci — kdyby zmizel s tokenem, předání zaznamenané bez signálu
   * by se po návratu sítě odmítlo jako cizí. Zahodí se jen při odvolání / ztrátě klíče.
   */
  uzivatel(): string | null;
  /** Poslední výsledek pokusu — obrazovka podle něj ukáže Klepátko nebo důvod. */
  posledni(): VysledekRelace | null;
  /** Zahodit (odvolání zjištěné jinde, zapomenutí klíče). */
  zahod(): void;
}

/**
 * Zdroj tokenu s mezipamětí: relace se drží do `vyprsi − REZERVA`, souběžná volání čekají
 * na JEDEN požadavek (brána má strop relací na průkaz — dvacet komponent, které se ptají
 * naráz, nesmí vyrobit dvacet relací).
 */
export function vytvorZdrojRelace(
  deps: TabletDeps & { nactiPovereni: () => Promise<PovereniZarizeni | null> },
): ZdrojRelace {
  let aktualni: RelaceTabletu | null = null;
  let znamyUzivatel: string | null = null;
  let posledni: VysledekRelace | null = null;
  let probiha: Promise<RelaceTabletu | null> | null = null;

  async function obnov(): Promise<RelaceTabletu | null> {
    const p = await deps.nactiPovereni().catch(() => null);
    if (!p) {
      posledni = { stav: "bez-klice" };
      aktualni = null;
      znamyUzivatel = null;
      return null;
    }
    const v = await vezmiRelaci(p, deps);
    posledni = v;
    aktualni = v.stav === "ok" ? v.relace : null;
    if (v.stav === "ok") znamyUzivatel = v.relace.uzivatel;
    // Server řekl NE (odvolání, neznámý průkaz) — identita tabletu končí. Síť ne.
    if (v.stav === "neschvaleno" || v.stav === "nezname") znamyUzivatel = null;
    return aktualni;
  }

  return {
    async token() {
      if (aktualni && aktualni.vyprsi - deps.nowSec() > REZERVA_OBNOVY_S) return aktualni.token;
      probiha ??= obnov().finally(() => {
        probiha = null;
      });
      return (await probiha)?.token ?? null;
    },
    uzivatel: () => znamyUzivatel,
    posledni: () => posledni,
    zahod() {
      aktualni = null;
      znamyUzivatel = null;
    },
  };
}
