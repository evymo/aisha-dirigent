/**
 * Čtení bezpečnostních knoflíků z prostředí — nečitelná hodnota = služba NENASTARTUJE.
 *
 * Doktrína „neznámý bezpečnostní přepínač = fail-closed“: strop procesů nebo uživatel
 * běhu, který nejde přečíst, se NEDOSAZUJE výchozí hodnotou (to by tiše zrušilo, co
 * operátor nastavil) ani nepropouští (NaN v `PidsLimit` Docker bere jako „bez stropu“).
 * Prázdná hodnota = nenastaveno (compose předává `${X:-}`), výchozí hodnota žije jen tady.
 */

function hodnota(jmeno: string): string | undefined {
  const v = process.env[jmeno];
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

/** Celé kladné číslo (volitelně s horní mezí); jinak výjimka při načtení konfigurace. */
export function celeKladneCislo(jmeno: string, vychozi: number, max = Number.MAX_SAFE_INTEGER): number {
  const v = hodnota(jmeno);
  if (v === undefined) return vychozi;
  if (!/^[1-9]\d*$/.test(v) || Number(v) > max) {
    throw new Error(`${jmeno} musí být celé kladné číslo${max < Number.MAX_SAFE_INTEGER ? ` ≤ ${max}` : ''} — služba bez čitelné meze nenastartuje`);
  }
  return Number(v);
}

/** Tvar uživatele běhu: číselné uid, volitelně :gid; ani jedno nesmí být 0 (root). */
export const TVAR_UZIVATELE_BEHU = /^[1-9]\d*(:[1-9]\d*)?$/;

/** Uživatel běhu `uid[:gid]` — číselný a ne root; jinak výjimka při načtení konfigurace. */
export function uzivatelBehu(jmeno: string, vychozi: string): string {
  const v = hodnota(jmeno) ?? vychozi;
  if (!TVAR_UZIVATELE_BEHU.test(v)) {
    throw new Error(
      `${jmeno} musí být číselné uid[:gid] různé od 0 (root) — jméno uživatele si obraz může namapovat na root; služba nenastartuje`,
    );
  }
  return v;
}
