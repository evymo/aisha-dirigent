/**
 * Brána: verze Keycloaku musí snést import realmu se servisními účty
 *
 * ⛔ NAMĚŘENO 2026-09-06 na produkci forku. Keycloak 26.0.7 padá při importu
 * realmu, který obsahuje klienta s `serviceAccountsEnabled: true`:
 *
 *     java.lang.IllegalArgumentException: Session not bound to a realm
 *       at InfinispanOrganizationProvider.getRealm
 *       at Organizations.isReadOnlyOrganizationMember
 *       at UserCacheSession.findServiceAccount
 *       at RealmManager.setupClientServiceAccountsAndAuthorizationOnImport
 *
 * Padá v provideru Organizations, přestože ta funkce ani není zapnutá
 * (`KC_FEATURES=token-exchange,admin-fine-grained-authz`). Není to tedy vada
 * realmu — servisní účty jsou běžná funkce a bez nich se `netbird-backend`
 * nepřihlásí.
 *
 * ── Cena ────────────────────────────────────────────────────────────────────
 * 3409 restartů v smyčce od 2026-09-05: auth NIKDY neběžel. Uvnitř kontejneru
 * neposlouchal nikdo, takže Traefik hlásil „no available server", `auth.<tld>`
 * vracelo 503, `netbird-peer-discover` nemělo kam, `CORE_MESH_IP` zůstalo
 * prázdné a `edge` — jediný veřejný vstup — se odmítal nasadit. Pět různě
 * vypadajících vad, jeden kořen.
 *
 * ── Doloženo bisekcí na živém stroji ───────────────────────────────────────
 * Stejné env, stejný vyrenderovaný realm, měněna jedna věc:
 *
 *     bez importu                              26.0.7 nastartuje
 *     náš realm                                26.0.7 PADÁ
 *     bez deklarovaných service-account-* users 26.0.7 PADÁ DÁL
 *     bez serviceAccountsEnabled u klientů      26.0.7 nastartuje (18.6 s)
 *     TÝŽ realm na 26.0.8                       NASTARTUJE (12.2 s)
 *
 * Třetí řádek je důležitý: první hypotéza (explicitně deklarovaní servisní
 * uživatelé) byla MYLNÁ. Kdybych ji „opravil" bez ověření, odstranil bych
 * deklaraci, vada by zůstala a stopa by se ztratila.
 *
 * ── Co brána hlídá ─────────────────────────────────────────────────────────
 * Nezakazuje konkrétní verzi napořád — zakazuje ZNÁMĚ ROZBITÉ. A hlídá, že
 * obě vrstvy Dockerfilu (builder i běhová) drží TUTÉŽ verzi: rozjet je znamená
 * stavět providery proti jinému jádru, než na kterém poběží.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DOCKERFILE = join(ROOT, "Dockerfile.keycloak");
const REALM = join(ROOT, "keycloak/aisha-realm.json");

/** Verze, o kterých VÍME, že import se servisními účty neustojí. */
const ROZBITE = new Set(["26.0.7"]);

const DF = existsSync(DOCKERFILE) ? readFileSync(DOCKERFILE, "utf8") : "";
const verze = [...DF.matchAll(/^FROM\s+quay\.io\/keycloak\/keycloak:([0-9.]+)/gm)].map((m) => m[1]);

describe("verze Keycloaku snese servisní účty", () => {
  test("Dockerfile a realm se našly (jinak brána nic neměří)", () => {
    expect(existsSync(DOCKERFILE), "Dockerfile.keycloak chybí").toBe(true);
    expect(existsSync(REALM), "keycloak/aisha-realm.json chybí").toBe(true);
    expect(
      verze.length,
      "v Dockerfile.keycloak není ANI JEDEN `FROM quay.io/keycloak/keycloak:<verze>` — brána by tiše prošla",
    ).toBeGreaterThan(0);
  });

  test("realm SKUTEČNĚ obsahuje klienta se servisním účtem", () => {
    // Bez toho by brána hlídala prázdno: verze by mohla být jakákoli, protože
    // by se ten kód v Keycloaku vůbec nespustil.
    const d = JSON.parse(readFileSync(REALM, "utf8")) as {
      clients?: Array<{ clientId?: string; serviceAccountsEnabled?: boolean }>;
    };
    const sa = (d.clients ?? []).filter((c) => c.serviceAccountsEnabled).map((c) => c.clientId);
    expect(
      sa.length,
      "žádný klient nemá serviceAccountsEnabled — pak tahle brána nehlídá nic " +
        "a je potřeba ji buď smazat, nebo najít jiný spouštěč",
    ).toBeGreaterThan(0);
  });

  test("žádná vrstva nepoužívá známě rozbitou verzi", () => {
    const spatne = verze.filter((v) => ROZBITE.has(v));
    expect(
      spatne,
      `Dockerfile.keycloak staví na verzi, která padá při importu realmu se\n` +
        `servisními účty: ${spatne.join(", ")}\n\n` +
        `  IllegalArgumentException: Session not bound to a realm\n` +
        `    at RealmManager.setupClientServiceAccountsAndAuthorizationOnImport\n\n` +
        `Naměřeno 2026-09-06 na produkci forku: 3409 restartů v smyčce, auth nikdy\n` +
        `neběžel, a celý mesh na tom stál. Doloženo bisekcí — týž realm na 26.0.8\n` +
        `startuje za 12 s.`,
    ).toEqual([]);
  });

  test("builder i běhová vrstva drží TUTÉŽ verzi", () => {
    // Rozjet je znamená stavět providery (apple-identity-provider, téma)
    // proti jinému jádru, než na kterém poběží — a takový nesoulad se projeví
    // až za běhu, ne při buildu.
    const unikatni = [...new Set(verze)];
    expect(
      unikatni.length,
      `Dockerfile.keycloak míchá verze: ${verze.join(" × ")}.\n` +
        `Providery se stavějí v builderu a spouštějí v běhové vrstvě; jiné jádro\n` +
        `pod nimi je nesoulad, který se ukáže až za běhu.`,
    ).toBe(1);
  });
});
