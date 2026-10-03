/**
 * APLIKACE NESMÍ DRŽET PROMĚNNÉ, NA KTERÉ JEJÍ COMPOSE NEODKAZUJE.
 *
 * ⛔ NAMĚŘENO 2026-08-23 na běžícím `core`: 177 proměnných, z nichž compose
 * odkazuje 99. Zbylých 76 tam leželo bez důvodu — a 18 z nich vypadalo jako
 * tajemství, mimo jiné `KEYCLOAK_ADMIN_PASSWORD` na aplikaci, která Keycloak
 * neprovozuje, a `SERVICE_ROLE_KEY`, tedy klíč obcházející RLS.
 *
 * PŘÍČINA: payload se odvozuje správně (compose `${VAR}` + `ARG` z Dockerfilů
 * + šablony realmu), ale sync nikdy nic NEODEBRAL. Co poslaly starší, volnější
 * verze, zůstalo napořád.
 *
 * ⭐ A PROČ TO NIKDO NENAŠEL: celá mašinérie — brány, `env-doctor`, cold-start —
 * se ptá „NECHYBÍ něco?". Otázku „není tam něco NAVÍC?" nepoložil nikdo. Chybějící
 * hodnota shodí deploy hlasitě; přebývající tajemství neshodí nic.
 *
 * ⚠️ Coolify si spravuje své: `is_coolify` a `is_shared` (sdílené proměnné
 * týmu/projektu) se úklid NIKDY nesmí dotknout.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SYNC = join(ROOT, "scripts/coolify-sync-envs.sh");
const text = readFileSync(SYNC, "utf-8");

describe("sync neposílá ani nenechává navíc (brána)", () => {
  test("univerzum není prázdné — jinak je tvrzení níž vakuové", () => {
    expect(text.length, "coolify-sync-envs.sh se nepodařilo přečíst").toBeGreaterThan(1000);
  });

  test("payload se ODVOZUJE z compose, neposílá se všechno", () => {
    // Reference se čtou JEDNOU do `compose_refs` (aby šlo poznat, že YAML
    // extraktor selhal — uvnitř `{ …; } | sort -u` by se jeho kód ztratil)
    // a payload se z nich skládá. Tvrzení je pořád totéž: payload = compose.
    expect(
      /compose_refs=\$\(extract_compose_vars "\$compose_path"\)/.test(text) &&
        /payload_vars=\$\(\{\s*printf '%s\\n' "\$compose_refs"/.test(text),
      "payload se neskládá z `extract_compose_vars` — kdyby se posílalo všechno,\n" +
        "dostane každá aplikace i tajemství, která nepoužívá. Build arg se navíc\n" +
        "zapisuje do metadat obrazu, odkud ho `docker history` vydá komukoli.",
    ).toBe(true);
  });

  test("existuje cesta, jak odebrat, co v payloadu není", () => {
    expect(
      text.includes("PRUNE_EXTRA"),
      "skript umí jen PŘIDÁVAT a AKTUALIZOVAT. Co poslaly starší verze, zůstane\n" +
        "napořád — přesně tak vzniklo 76 přebytků na `core`, z toho 18 tajemství.",
    ).toBe(true);
  });

  test("úklid se NIKDY nedotkne toho, co spravuje Coolify", () => {
    const i = text.indexOf("PRUNE_EXTRA");
    const blok = text.slice(i, i + 1400);
    for (const chraneny of ["is_coolify", "is_shared"]) {
      expect(
        blok.includes(chraneny),
        `úklid nevylučuje \`${chraneny}\` — smazal by proměnné, které si Coolify\n` +
          "spravuje sám (sdílené proměnné týmu/projektu). Ty nejsou náš nános.",
      ).toBe(true);
    }
  });
});
