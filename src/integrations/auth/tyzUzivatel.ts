/**
 * Je to pořád tentýž uživatel se stejnými údaji?
 *
 * ⛔ NAMĚŘENO 2026-10-01 (na instanci, editor stránek): tichá obnova tokenu
 * (`automaticSilentRenew`, 120 s před koncem 300s tokenu = každé 3 min) vyvolá
 * `userLoaded` a `mapOidcUser` vyrobí NOVÝ objekt, i když se nic nezměnilo.
 * Každý konzument s `[user]` v závislostech se pak rozjede znovu — `useUserRole`
 * přepnul do načítání, ochrana adminu ukázala točící kolečko a odmontovala celý
 * editor. Autorka přišla o rozepsaný text a historii kroků zpět (gateway log
 * 30. 9.: get_my_user_roles + get_web_page_versions přesně à 3:03 min).
 *
 * Srovnávají se údaje, které konzumenti čtou, a nároky tokenu BEZ těch, které
 * se mění při každé obnově (časy, jednorázové identifikátory). Změna čehokoli
 * jiného — e-mail, jméno, `must_change_password` — dál vyrobí nový objekt.
 */
import type { KcUser } from "./types";

/** Nároky ID tokenu, které se mění při KAŽDÉ obnově téhož přihlášení. */
const PROMENLIVE_NAROKY = new Set(["iat", "exp", "nbf", "auth_time", "jti", "at_hash", "c_hash", "s_hash", "nonce"]);

function stabilniNaroky(naroky: Record<string, unknown> | undefined): string {
  if (!naroky) return "";
  return JSON.stringify(
    Object.keys(naroky)
      .filter((k) => !PROMENLIVE_NAROKY.has(k))
      .sort()
      .map((k) => [k, naroky[k]]),
  );
}

/**
 * @param predchozi - uživatel, kterého aplikace drží teď (může být `null`)
 * @param dalsi - uživatel právě namapovaný z OIDC
 * @returns `true`, když `dalsi` nenese žádnou změnu proti `predchozi`
 */
export function jeTyzUzivatel(predchozi: KcUser | null, dalsi: KcUser): boolean {
  if (!predchozi) return false;
  return (
    predchozi.id === dalsi.id &&
    predchozi.email === dalsi.email &&
    predchozi.email_verified === dalsi.email_verified &&
    predchozi.display_name === dalsi.display_name &&
    predchozi.given_name === dalsi.given_name &&
    predchozi.family_name === dalsi.family_name &&
    predchozi.avatar_url === dalsi.avatar_url &&
    stabilniNaroky(predchozi.raw_claims) === stabilniNaroky(dalsi.raw_claims)
  );
}
