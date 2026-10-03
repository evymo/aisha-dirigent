/**
 * KC_HOSTNAME má strážce — veřejná tvář auth se nesmí tiše ztratit
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * `KC_HOSTNAME` v keycloak compose MUSÍ nést `:?` stráž. Bez přišpendleného
 * hostname staví Keycloak přihlašovací redirecty z toho, JAK ho kdo osloví —
 * tedy z vnitřního aliasu kontejneru a KC_HTTP_PORT.
 *
 * ── PROČ (naměřeno 2026-08-13 na `<fork>`) ────────────────────────────────────────
 * Login na `<fork>` posílal prohlížeč na `<fork>-keycloak:80` — vnitřní alias, na
 * který prohlížeč nikdy nedosáhne. Kořen: `KC_HOSTNAME: ${KEYCLOAK_DOMAIN_PUBLIC}`
 * bez stráže. Když proměnná při renderu nedorazila, Compose dosadil prázdno a
 * Keycloak nastartoval BEZ veřejné tváře — zdravý, nasazený, a s rozbitým
 * přihlášením pro každého uživatele.
 *
 * Prázdná hodnota přitom NENÍ volba operátora: KEYCLOAK_DOMAIN_PUBLIC vydávají
 * všechny tři profily (cloud-multi, cloud-single, local-dev — změřeno) a
 * env-doctor ji deklaruje jako required-static. Prázdno = selhaný push env.
 * `:?` ten stav posouvá tam, kam patří: preflight-compose padne PŘED destrukcí
 * (validate-before-destroy), místo tichého rozbití auth po nasazení.
 *
 * Tohle je regresní pin jedné hodnoty; třídu „holá ${VAR} na veřejné tváři"
 * sleduje úkol #135.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const COMPOSE = path.join(process.cwd(), "docker-compose.coolify-keycloak.yml");

describe("KC_HOSTNAME má strážce", () => {
  it("KC_HOSTNAME nese :? stráž na KEYCLOAK_DOMAIN_PUBLIC", () => {
    const text = readFileSync(COMPOSE, "utf8");
    const radky = text.split("\n").filter((l) => /^\s*KC_HOSTNAME:/.test(l));

    expect(radky.length, "KC_HOSTNAME v keycloak compose zmizel — brána nic neměří").toBe(1);
    expect(
      radky[0],
      "KC_HOSTNAME bez `:?` stráže: prázdná KEYCLOAK_DOMAIN_PUBLIC projde renderem,\n" +
        "Keycloak nastartuje bez veřejné tváře a login posílá prohlížeč na vnitřní\n" +
        "alias (naměřeno: <fork>-keycloak:80). Prázdno = selhaný push env a má padnout\n" +
        "v preflight, ne po nasazení.\n" +
        "\nCO S TÍM: nech v hodnotě `${KEYCLOAK_DOMAIN_PUBLIC:?…}` — schéma před ní\n" +
        "je v pořádku (`https://${KEYCLOAK_DOMAIN_PUBLIC:?…}`), stráž musí zůstat.\n" +
        "NEDĚLEJ: neměň to na `:-` ani na literál — prázdno pak projde renderem.",
    // ⛔ NAMĚŘENO 2026-08-20: tenhle vzor byl PŘIŠPENDLENÝ NA ZAČÁTEK hodnoty,
    // takže spadl, jakmile před proměnnou přibylo schéma — přestože stráž `:?`
    // zůstala. Měřená vlastnost je „hodnota nese `:?` stráž", ne „začíná jí".
    // Schéma tam přibýt MUSELO: bez něj si Keycloak dobíral schéma z požadavku
    // a vnitřní volání dostávala token s `http://` issuerem, který validátory
    // odmítaly. Viz commit „issuer se odvozoval Z CESTY, kudy klient přišel".
    ).toMatch(/KC_HOSTNAME:[^\n]*\$\{KEYCLOAK_DOMAIN_PUBLIC:\?/);

    // A druhá polovina té vlastnosti: schéma nesmí chybět, jinak se issuer
    // zase začne odvozovat z cesty. Dvě tvrzení, protože jedno by propustilo
    // tvar, který má stráž, ale schéma ne.
    expect(
      radky[0],
      "KC_HOSTNAME bez schématu: Keycloak si ho dobere z požadavku, takže vnitřní\n" +
        "volání dostane token s `http://` issuerem a validátor ho odmítne.\n" +
        "CO S TÍM: `KC_HOSTNAME: https://${KEYCLOAK_DOMAIN_PUBLIC:?…}`",
    ).toMatch(/KC_HOSTNAME:\s*https:\/\//);
  });
});
