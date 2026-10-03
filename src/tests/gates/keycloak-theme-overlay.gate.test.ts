/**
 * Gate: instanční overlay tématu Keycloaku drží tři invarianty, jejichž
 * porušení je TICHÉ — projeví se až očima na přihlašovací stránce, nebo hůř
 * crash-loopem KC na produkci.
 *
 * 1. POŘADÍ COPY: overlay (`--from=theme-overlay`) musí být AŽ ZA platformním
 *    `COPY keycloak/themes/aisha`. Obrácené pořadí overlay tiše zahodí —
 *    build zelený, obraz s cizí značkou.
 *
 * 2. --chown NA OBOU COPY do témat: entrypoint (render-realm-and-start.sh)
 *    dosazuje __SUPPORT_EMAIL__ DO SOUBORŮ tématu za běhu; root-vlastněný
 *    adresář témat už jednou crash-loopnul Keycloak při startu (23 restartů
 *    kvůli kosmetickému footeru — a2d28c83).
 *
 * 3. FAIL-CLOSED: když je KC_THEME_OVERLAY_GIT_URL zadané a klon nebo
 *    podadresář chybí, build musí SPADNOUT (exit 1). Tiché sesunutí na
 *    platformní vzhled je horší než spadlý build — stejná úvaha jako
 *    u SURFACE_OVERLAY_GIT_URL v deploy/surface-host/Dockerfile.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dockerfile = readFileSync(
  join(process.cwd(), "Dockerfile.keycloak"),
  "utf-8"
);

describe("keycloak theme overlay", () => {
  it("overlay COPY je až za platformním tématem (jinak se tiše zahodí)", () => {
    const platform = dockerfile.indexOf("keycloak/themes/aisha /opt/keycloak/themes/aisha");
    const overlay = dockerfile.indexOf("--from=theme-overlay");
    expect(platform).toBeGreaterThan(-1);
    expect(overlay).toBeGreaterThan(-1);
    expect(overlay).toBeGreaterThan(platform);
  });

  it("oba COPY do témat nesou --chown (entrypoint do témat zapisuje)", () => {
    const themeCopies = dockerfile
      .split("\n")
      .filter((l) => /^COPY .*\/opt\/keycloak\/themes\//.test(l.trim()));
    expect(themeCopies.length).toBeGreaterThanOrEqual(2);
    for (const line of themeCopies) {
      expect(line, `COPY bez --chown: ${line}`).toContain("--chown=1000:0");
    }
  });

  it("overlay stage je fail-closed: klon i chybějící podadresář končí exit 1", () => {
    const stage = dockerfile.slice(
      dockerfile.indexOf("AS theme-overlay"),
      dockerfile.indexOf("FROM quay.io/keycloak/keycloak", dockerfile.indexOf("AS theme-overlay"))
    );
    expect(stage).toContain("KC_THEME_OVERLAY_GIT_URL");
    // pád na neúspěšném klonu
    expect(stage).toMatch(/git clone[\s\S]*?exit 1/);
    // pád na chybějícím KC_THEME_OVERLAY_PATH v repu
    expect(stage).toMatch(/KC_THEME_OVERLAY_PATH[\s\S]*?exit 1/);
  });

  it("FORGEJO_TOKEN nesmí do běhového stage (docker history by ho vydal)", () => {
    const lastFrom = dockerfile.lastIndexOf("FROM ");
    expect(dockerfile.slice(lastFrom)).not.toContain("FORGEJO_TOKEN");
  });

  it("klon overlaye má cachebust — jinak se nasadí jednou a už nikdy", () => {
    // BuildKit kešuje vrstvu podle textu příkazu; ten se mezi nasazeními
    // nemění, takže bez proměnné hodnoty `git clone` znovu neproběhne a
    // v obrazu zůstane instanční téma z prvního buildu. Build přitom projde
    // zeleně — táž třída jako „deploy přijat, ale neproveden".
    const stage = dockerfile.slice(
      dockerfile.indexOf("AS theme-overlay"),
      dockerfile.indexOf("FROM quay.io/keycloak/keycloak", dockerfile.indexOf("AS theme-overlay"))
    );
    expect(stage, "chybí ARG KC_THEME_OVERLAY_CACHEBUST").toContain(
      "ARG KC_THEME_OVERLAY_CACHEBUST"
    );
    // Deklarovat ARG nestačí — musí se v RUN i POUŽÍT, jinak do klíče keše nevstoupí.
    const run = stage.slice(stage.indexOf("RUN "));
    expect(run, "ARG deklarovaný, ale v RUN nepoužitý — keš ho ignoruje").toContain(
      "KC_THEME_OVERLAY_CACHEBUST"
    );
  });

  it("prázdný cachebust build ZASTAVÍ, místo aby tiše nasadil staré téma", () => {
    // Bez tohohle by zapomenutá proměnná znamenala zelený build s obsahem
    // instančního repa z prvního nasazení. Loud > silent.
    const stage = dockerfile.slice(
      dockerfile.indexOf("AS theme-overlay"),
      dockerfile.indexOf("FROM quay.io/keycloak/keycloak", dockerfile.indexOf("AS theme-overlay"))
    );
    expect(stage).toMatch(/-n "\$KC_THEME_OVERLAY_CACHEBUST"[\s\S]{0,600}?exit 1/);
  });

  it("compose cachebust předává (a bez vnořené interpolace — Coolify ji neumí)", () => {
    const compose = readFileSync(
      join(process.cwd(), "docker-compose.coolify-keycloak.yml"),
      "utf-8"
    );
    expect(compose).toMatch(/KC_THEME_OVERLAY_CACHEBUST:\s*\$\{KC_THEME_OVERLAY_CACHEBUST:-\}/);
  });
});
