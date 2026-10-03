/**
 * Brána: povrch se staví z INSTANČNÍHO overlaye, ne z referenční šablony.
 *
 * ⛔ TŘÍDA VADY (naměřeno 2026-08-22 v prohlížeči majitele). Extranet po
 * otevření přesměroval na
 *
 *     https://idp.example.invalid/realms/main/...&client_id=surface-shell
 *
 * což jsou hodnoty z `instances/_default/app.config.json` — REFERENČNÍ ŠABLONY.
 * Instanční overlay (`app.config.json` v instančním repu, kde je skutečný
 * issuer, client_id a API) se do buildu nikdy nedostal:
 *
 *   · `SURFACE_OVERLAY_PATH` nikdo nevydával,
 *   · `SURFACE_OVERLAY_GIT_URL` se nedoručovalo do aplikace,
 *   · `AISHA_INSTANCE` padalo fallbackem na `_default` — a to na DVOU místech
 *     nad sebou: v derivaci (`|| "_default"`) i v heredocu cold-startu.
 *     Fallback nekryl okrajový případ, byl to JEDINÝ zdroj hodnoty.
 *
 * ⭐ NIC PŘITOM NESPADLO. Kontejner byl `healthy`, edge vracel 302, brána
 * fungovala — vada se pozná až OČIMA na přihlašovací obrazovce. Přesně proto
 * ji musí držet brána, ne pozornost.
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis):
 *   1. profil s povrchy ⇒ derivace vydá `SURFACE_OVERLAY_PATH`,
 *   2. cold-start ten kontrakt doručí do `.env.coolify`,
 *   3. provisioner pošle overlay až DO APLIKACE (build běží jinde než skript),
 *   4. Dockerfile povrchu nemá vestavěnou výchozí cestu (ta je identita),
 *   5. identita se odvodí z ŘETĚZU IDENTITY — měřeno pod smyšleným jménem,
 *   6. fallback na `_default` se nesmí vrátit ani do jednoho z těch dvou míst.
 *
 * ⛔ NAMĚŘENO 2026-09-13 — VERDIKT ZÁVISEL NA BĚŽCI. Měření 1, 5 a 6 volala
 * derivaci s prostředím běžce a ošetřovala z jejích vstupů jen dva. Běžec
 * s `AISHA_INSTANCE_CONFIG_DIR` dostal profil z overlaye (s povrchy) a derivace
 * fail-closed spadla na `surfaces/zkouska/app.config.json`; běžec bez něj zase
 * v měření 1 dostal šablonu BEZ povrchů, takže pozitivní tvrzení se neměřilo
 * vůbec a test prošel jen svou „ne" větví. Všechna měření teď jedou přes
 * `sIzolovanymVstupem` (celý RESOLVER_ENV_INPUTS pryč, prostředí se vrací)
 * a overlay si brána staví sama. Že to drží, měří sonda „verdikt nezávisí na
 * prostředí běžce" — pod přesně tou kontaminací, která 2026-09-13 bránu shodila.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildTopology, formatShellExports } from "../../../scripts/lib/derive-domains.mjs";
import { gatewayRestPrefix } from "../../../scripts/lib/povrch-shoda-s-derivaci.mjs";
import {
  DEKLAROVANE_TLD,
  docasnyOverlay,
  hodnotaZVystupu,
  PROMENNA_OVERLAYE,
  sIzolovanymVstupem,
  souhlasnyAppConfig,
} from "./lib/izolovana-derivace";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

/** Smyšlená identita — nikdo jiný ji mít nemůže, takže se v měření nesplete s cizí. */
const IDENTITA = "zkouska";
const REALM = "zkouska-realm";
const POVRCH = { name: "povrch", shell: "workbench-shell", subdomain: "povrch" };

/** Derivace referenčního profilu — týž tvar volání jako dřív, jen v izolaci. */
const derivuj = () => formatShellExports(buildTopology({ profileId: "cloud-multi", meshEnabled: true })) as string;

/**
 * Identita, kterou derivace vydá. JEDNA funkce pro měření 5, 6 i pro sondu
 * nezávislosti: sonda tak měří doslova totéž, ne podobnou věc.
 */
const vydanaIdentita = () => hodnotaZVystupu(derivuj(), "AISHA_INSTANCE");

describe("povrch se staví z instančního overlaye", () => {
  test("profil s povrchy ⇒ derivace vydá SURFACE_OVERLAY_PATH (a profil bez povrchů ji nevydá)", () => {
    // Overlay, který SOUHLASÍ s derivací: domény se berou z derivace téhož
    // profilu bez overlaye (povrchy veřejné domény nemění), prefix PostgREST ze
    // zdroje gateway. TLD DEKLAROVANÉ, ne z `.example` — ať projde celá cesta
    // včetně kontroly shody, ne jen její referenční větev.
    const ref = sIzolovanymVstupem({ APP_NAME_PREFIX: IDENTITA, ...DEKLAROVANE_TLD }, derivuj);
    const overlay = docasnyOverlay({
      profil: "cloud-multi",
      povrchy: [POVRCH],
      identita: IDENTITA,
      appConfig: souhlasnyAppConfig({
        apiDomena: hodnotaZVystupu(ref, "API_DOMAIN_PUBLIC") ?? "",
        keycloakDomena: hodnotaZVystupu(ref, "KEYCLOAK_DOMAIN_PUBLIC") ?? "",
        restPrefix: gatewayRestPrefix(ROOT),
        realm: REALM,
        klient: `${IDENTITA}-${POVRCH.name}`,
      }),
    });
    try {
      const s = sIzolovanymVstupem(
        { APP_NAME_PREFIX: IDENTITA, KEYCLOAK_REALM: REALM, ...DEKLAROVANE_TLD, [PROMENNA_OVERLAYE]: overlay },
        derivuj,
      );
      expect(hodnotaZVystupu(s, "AISHA_SURFACES"), "overlay profil deklaruje povrch — měřidlo je slepé").toBe(
        `${POVRCH.name}:${POVRCH.shell}:${POVRCH.subdomain}`,
      );
      const hodnota = hodnotaZVystupu(s, "SURFACE_OVERLAY_PATH");
      expect(
        hodnota,
        "Profil deklaruje povrchy, ale derivace nevydala SURFACE_OVERLAY_PATH — " +
          "build povrchu pak sáhne po `instances/_default`, tedy po REFERENČNÍ šabloně " +
          "(idp.example.invalid). Nic nespadne; pozná se to až na přihlašovací obrazovce.",
      ).toBeDefined();
      expect(hodnota, "cesta musí nést identitu instance").toBe(`surfaces/${IDENTITA}`);
      expect(hodnota, "cesta nesmí mířit na referenční šablonu").not.toContain("_default");
    } finally {
      rmSync(overlay, { recursive: true, force: true });
    }

    // Sonda umí říct „ne": profil bez povrchů cestu vydávat NEMÁ. Premisa se
    // ověřuje, ne předpokládá — dostane-li šablona povrchy, tahle větev by
    // jinak tiše přestala měřit to, co tvrdí.
    const bez = sIzolovanymVstupem({ APP_NAME_PREFIX: IDENTITA }, derivuj);
    expect(hodnotaZVystupu(bez, "AISHA_SURFACES"), "premisa: platformní šablona cloud-multi povrchy nedeklaruje").toBeUndefined();
    expect(hodnotaZVystupu(bez, "SURFACE_OVERLAY_PATH"), "profil nemá povrchy, a přesto se vydává overlay cesta").toBeUndefined();
  });

  test("cold-start doručí overlay kontrakt do .env.coolify", () => {
    const cs = read("scripts/aisha-cold-start.sh");
    for (const key of ["SURFACE_OVERLAY_GIT_URL", "SURFACE_OVERLAY_PATH", "SURFACE_OVERLAY_REF"]) {
      expect(cs, `${key} se nikde nezapisuje do .env.coolify — do Coolify se nedostane`).toMatch(
        new RegExp(`${key}=%s`),
      );
    }
    // Vydává se PODMÍNĚNĚ. Instance nemusí mít povrch; prázdný řádek by byl
    // tiše dosazená hodnota, tedy přesně to, co tuhle vadu vyrobilo.
    expect(cs, "overlay se musí vydávat jen když ho instance skutečně má").toMatch(
      /if \[ -n "\$\{SURFACE_OVERLAY_PATH:\+[a-z]+\}" \]; then/,
    );
    // URL má jeden domov a fragment #ref rozdělí hotový parser — ne čtvrtá kopie.
    expect(cs, "URL overlaye se musí brát z instančního repa přes hotový parser").toMatch(
      /parse_instance_data_url "\$\{AISHA_INSTANCE_DATA_GIT_URL:\?/,
    );
  });

  test("provisioner pošle overlay až DO APLIKACE", () => {
    // Build běží na build serveru z env APLIKACE — hodnota v prostředí skriptu
    // se do něj nedostane. Tohle bylo to chybějící kolečko.
    const ps = read("scripts/provision-surfaces.sh");
    for (const key of ["SURFACE_OVERLAY_GIT_URL", "SURFACE_OVERLAY_PATH"]) {
      expect(
        ps,
        `${key} se neposílá do aplikace — build ho neuvidí a povrch se postaví ze šablony`,
      ).toMatch(new RegExp(`\\$\\{${key}:\\+"${key}=\\$\\{${key}\\}"\\}`));
    }
  });

  test("Dockerfile povrchu nemá vestavěnou výchozí cestu k overlayi", () => {
    // Cesta je identita instance; default by tiše nasadil povrch cizí instance.
    const df = read("deploy/surface-host/Dockerfile");
    expect(df, "ARG SURFACE_OVERLAY_PATH musí být bez výchozí hodnoty").toMatch(
      /^ARG SURFACE_OVERLAY_PATH=\s*$/m,
    );
    expect(df, "chybějící cesta při zapnutém overlayi musí build ZASTAVIT").toMatch(
      /SURFACE_OVERLAY_PATH[\s\S]{0,400}exit 1/,
    );
  });

  test("AISHA_INSTANCE nese identitu instance — měřeno pod smyšleným jménem", () => {
    // Vlastnost, ne pravopis: derivace se pustí s identitou, kterou nikdo jiný
    // nemůže mít, a v jejím výstupu se to jméno musí objevit. Regex nad zdrojem
    // by prošel i tehdy, kdyby hodnotu o kus dál něco přebilo.
    const identita = sIzolovanymVstupem({ APP_NAME_PREFIX: IDENTITA }, vydanaIdentita);
    expect(identita, "derivace nevydala AISHA_INSTANCE, přestože identita JE deklarovaná").toBeDefined();
    expect(identita, "AISHA_INSTANCE nenese deklarovanou identitu — povrch se postaví z cizí šablony").toBe(IDENTITA);
  });

  test("starý `_default` v prostředí nesmí oprava přežít", () => {
    // ⭐ Nejsilnější tvrzení téhle brány. `AISHA_INSTANCE` je VÝSTUP derivace,
    // který se přes `.env.coolify` vrací zpátky na vstup. Kdyby se `_default`
    // četlo jako platná deklarace, minulé dosazení by se udrželo navěky
    // a oprava by se nikdy neprojevila — vypadala by přitom hotově.
    expect(
      sIzolovanymVstupem({ AISHA_INSTANCE: "_default", APP_NAME_PREFIX: IDENTITA }, vydanaIdentita),
      "derivace přijala vlastní minulé dosazení jako deklaraci — oprava by se neprojevila",
    ).toBe(IDENTITA);
  });

  test("⛔ verdikt nezávisí na prostředí běžce — kontaminace z 2026-09-13 měření nezmění", () => {
    // Prostředí, jaké měl běžec, na kterém brána 2026-09-13 spadla: overlay
    // s profilem, který deklaruje povrchy, ale bez `surfaces/zkouska`, přísný
    // režim overlaye — a k tomu cizí hodnoty KAŽDÉHO druhu vstupu (identita,
    // profil, TLD, mesh, realm, provisioning příznak), aby sonda nepokrývala
    // jen ten jeden vstup, který tehdy náhodou spadl.
    const cizi = docasnyOverlay({ profil: "cloud-multi", povrchy: [POVRCH] });
    const kontaminace: Record<string, string> = {
      [PROMENNA_OVERLAYE]: cizi,
      AISHA_OVERLAY_REQUIRED: "1",
      AISHA_PROFILE: "cloud-single",
      AISHA_INSTANCE: "cizi",
      APP_NAME_PREFIX: "cizi",
      PUBLIC_TLD: "kontaminace-verejna.invalid",
      INTERNAL_TLD: "kontaminace-vnitrni.invalid",
      MESH_TLD: "kontaminace-mesh.invalid",
      MESH_ENABLED: "false",
      KEYCLOAK_REALM: "cizi",
      EXTRANET_ENABLED: "1",
    };
    const puvodni = new Map(Object.keys(kontaminace).map((k) => [k, process.env[k]] as const));
    try {
      Object.assign(process.env, kontaminace);

      // Kontrolní vzorek: kontaminace JE účinná. Tvar staré brány (ošetřit jen
      // AISHA_INSTANCE a APP_NAME_PREFIX) pod ní spadne přesně jako 2026-09-13.
      // Bez tohohle by sonda prošla i nad kontaminací, která nic nekontaminuje.
      expect(() => {
        delete process.env.AISHA_INSTANCE;
        process.env.APP_NAME_PREFIX = IDENTITA;
        vydanaIdentita();
      }, "kontaminace se neprojevila — sonda by nic neměřila").toThrow(/surfaces\/zkouska\/app\.config\.json/);
      Object.assign(process.env, kontaminace);

      // Totéž měření jako výš, pod kontaminací: musí dát totéž co na čistém stroji.
      expect(sIzolovanymVstupem({ APP_NAME_PREFIX: IDENTITA }, vydanaIdentita)).toBe(IDENTITA);
      expect(sIzolovanymVstupem({ AISHA_INSTANCE: "_default", APP_NAME_PREFIX: IDENTITA }, vydanaIdentita)).toBe(
        IDENTITA,
      );

      // Izolace prostředí VRACÍ — i když měření uvnitř vyhodí.
      expect(() =>
        sIzolovanymVstupem({ APP_NAME_PREFIX: IDENTITA }, () => {
          throw new Error("měření selhalo");
        }),
      ).toThrow("měření selhalo");
      for (const [k, v] of Object.entries(kontaminace)) {
        expect(process.env[k], `izolace nevrátila ${k} — další test by běžel v jiném prostředí`).toBe(v);
      }
    } finally {
      for (const [k, v] of puvodni) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(cizi, { recursive: true, force: true });
    }
  });

  test("fallback na referenční šablonu se nesmí vrátit", () => {
    // Račna. Obě místa, kde `_default` stálo, jsou pojmenovaná — kdyby se
    // hodnota vrátila kamkoli z nich, vada je zpět a nikdo si jí nevšimne,
    // protože se NEPROJEVÍ pádem.
    const derive = read("scripts/lib/derive-domains.mjs");
    expect(
      derive.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"),
      "derivace zase dosazuje `_default` za identitu instance",
    ).not.toMatch(/AISHA_INSTANCE=\$\{[^}]*\|\|\s*"_default"/);

    const cs = read("scripts/aisha-cold-start.sh");
    expect(
      cs.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n"),
      "cold-start zase dosazuje výchozí jméno instance — a přebije tím derivaci",
    ).not.toMatch(/AISHA_INSTANCE=\$\{AISHA_INSTANCE:-/);
  });
});
