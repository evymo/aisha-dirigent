/**
 * Tok prvního přihlášení přes vnější IdP — sdílené pro dvě brány:
 *  - `prvni-prihlaseni-bez-automatickeho-propojeni` (šablona, lehká dráha),
 *  - `smir-prvniho-prihlaseni-dorovna-realm` (smír proti modelu Keycloaku, těžká dráha).
 * Vlastnosti a jejich důvod: hlavička první z nich a docs/deploy/OAUTH_PROVIDERS.md.
 */
export type Krok = {
  authenticator?: string;
  authenticatorFlow?: boolean;
  flowAlias?: string;
  requirement: string;
  priority?: number;
  [k: string]: unknown;
};
export type Tok = { alias: string; authenticationExecutions: Krok[]; [k: string]: unknown };

export const BEZ_OVERENI = new Set(["idp-auto-link", "idp-detect-existing-broker-user"]);
export const DUKAZ = new Set(["idp-email-verification", "idp-username-password-form"]);
export const TOK_EXISTUJICI = "aisha handle existing user";
export const TOK_OVERENI = "aisha existing account verification";

/** Vlastnosti toků jednoho realmu → seznam nálezů (prázdný = v pořádku). */
export function nalezy(toky: Tok[]): string[] {
  const podle = new Map(toky.map((t) => [t.alias, t]));
  const aktivni = (k: Krok) => k.requirement !== "DISABLED";
  const serazene = (t: Tok) => [...t.authenticationExecutions].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  // Dokazuje krok vlastnictví účtu? Tok s povinnými kroky: aspoň jeden povinný dokazuje.
  // Tok jen s alternativami: dokazuje KAŽDÁ (vybrat jde kteroukoli).
  const dokazuje = (k: Krok, hloubka = 0): boolean => {
    if (hloubka > 20) return false;
    if (!k.authenticatorFlow) return DUKAZ.has(k.authenticator ?? "");
    const t = podle.get(k.flowAlias ?? "");
    if (!t) return false;
    const deti = t.authenticationExecutions.filter(aktivni);
    const povinne = deti.filter((d) => d.requirement === "REQUIRED");
    if (povinne.length) return povinne.some((d) => dokazuje(d, hloubka + 1));
    const alt = deti.filter((d) => d.requirement === "ALTERNATIVE");
    return alt.length > 0 && alt.every((d) => dokazuje(d, hloubka + 1));
  };
  const out: string[] = [];
  for (const t of toky) {
    const s = serazene(t);
    for (const k of s) {
      if (aktivni(k) && BEZ_OVERENI.has(k.authenticator ?? "")) {
        out.push(`${t.alias}: ${k.authenticator} (${k.requirement}) propojí existující účet BEZ ověření`);
      }
    }
    const i = s.findIndex((k) => aktivni(k) && k.authenticator === "idp-confirm-link");
    if (i >= 0 && !s.slice(i + 1).some((k) => k.requirement === "REQUIRED" && dokazuje(k))) {
      out.push(`${t.alias}: po idp-confirm-link chybí POVINNÝ důkaz vlastnictví (e-mail nebo heslo) — potvrdí to i útočník`);
    }
    const alt = s.filter((k) => k.requirement === "ALTERNATIVE");
    const c = alt.findIndex((k) => k.authenticator === "idp-create-user-if-unique");
    if (c > 0) out.push(`${t.alias}: idp-create-user-if-unique není mezi alternativami první`);
    if (c >= 0 && alt.filter((k) => (k.priority ?? 0) === (alt[c].priority ?? 0)).length > 1) {
      out.push(`${t.alias}: idp-create-user-if-unique sdílí prioritu s jinou alternativou — pořadí určí náhoda`);
    }
  }
  return out;
}

export const kopie = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const tokyZ = (realm: { authenticationFlows?: Tok[] }) => realm.authenticationFlows ?? [];

/**
 * Stav PŘED opravou z dnešní šablony: podtok ověření nahradí `idp-auto-link`
 * (ALTERNATIVE, 20) a podtoky ověření zmizí. Shoduje se s origin/main před
 * 2026-09-27 (naměřeno i na dočasném KC: „Create User If Unique" 10, auto-link 20).
 */
export function sablonaPredOpravou(toky: Tok[]): Tok[] {
  const t = kopie(toky);
  const zbytecne = new Set<string>();
  const sber = (alias: string) => {
    zbytecne.add(alias);
    for (const k of t.find((x) => x.alias === alias)?.authenticationExecutions ?? []) {
      if (k.authenticatorFlow && k.flowAlias) sber(k.flowAlias);
    }
  };
  sber(TOK_OVERENI);
  const ex = t.find((x) => x.alias === TOK_EXISTUJICI)!;
  ex.authenticationExecutions = ex.authenticationExecutions.map((k) =>
    k.flowAlias === TOK_OVERENI
      ? { authenticator: "idp-auto-link", authenticatorFlow: false, requirement: "ALTERNATIVE", priority: 20, userSetupAllowed: false }
      : k,
  );
  return t.filter((x) => !zbytecne.has(x.alias));
}
