/**
 * dvere-deklarace.mjs — CO instance o dveřích deklaruje a KDE svc-knock odpovídá.
 *
 * Čistý modul bez I/O a bez čtení prostředí: načítá ho derivace (derive-domains),
 * která smí číst jen deklarované vstupy resolveru. Soulad a měření (soubor,
 * aplikace, Coolify API) bydlí v lib/dvere-soulad.mjs a tyhle hodnoty odtud
 * znovu vydává — jeden domov pravidla, dvě vrstvy: deklarace a měření.
 */

/** Jméno compose profilu, za kterým stojí dveře (`profiles: ["knock"]`). */
export const PROFIL_DVERI = "knock";
/** Kde deklarace dorazí do env: derivace ji vydává, deploy-init z ní skládá COMPOSE_PROFILES. */
export const KLIC_DEKLARACE = "EDGE_COMPOSE_PROFILES";

/** CSV profilů → pole jmen (prázdné položky pryč). */
export function profily(csv) {
  return String(csv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Deklaruje instance dveře? Rozhoduje JEN deklarace. */
export function dvereDeklarovane(cti) {
  return profily(cti(KLIC_DEKLARACE)).includes(PROFIL_DVERI);
}

/**
 * Kde svc-knock odpovídá edge — alias DRŽITELE netns na sdílené síti a HTTP port
 * svc-knock v jeho netns. Obojí deklaruje compose (`svc-knock-netns` → aliases,
 * `svc-knock` → SPA_HEALTH_PORT); shodu s ním drží brána edge-compose-profiles.
 *
 * ⛔ NAMĚŘENO 2026-09-01/09-15: `KNOCK_UPSTREAM` měl výchozí `http://svc-knock:3017`
 * — HOLÝ klíč služby. Na sdíleném hostiteli je to nárok bez vlastníka (odpoví,
 * kdo je na síti první) a po přesunu svc-knock do netns držitele se holé jméno
 * ani nepřeloží (`wget: bad address 'svc-knock:3017'`, změřeno lokálně).
 */
export const KNOCK_ALIAS_PRIPONA = "svc-knock";
export const KNOCK_HTTP_PORT = "3017";

/** Adresa verdiktu dveří pro edge — s identitou instance, jinak výjimka. */
export function knockUpstream(prefix) {
  const p = String(prefix ?? "").trim();
  if (!p) {
    throw new Error(
      "KNOCK_UPSTREAM nejde složit bez identity instance (APP_NAME_PREFIX) — holé jméno " +
        "je na sdíleném hostiteli nárok bez vlastníka",
    );
  }
  return `http://${p}-${KNOCK_ALIAS_PRIPONA}:${KNOCK_HTTP_PORT}`;
}
