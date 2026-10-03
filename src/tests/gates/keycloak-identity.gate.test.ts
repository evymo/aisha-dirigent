/**
 * Keycloak Identity Gate Tests
 *
 * Static analysis of Keycloak realm JSON and theme files.
 * Validates:
 * 1. AISHA ID branding consistency
 * 2. WebAuthn/Passkey configuration completeness
 * 3. Theme structure and asset integrity
 * 4. Authentication flow with passkey support
 * 5. Required actions configuration
 * 6. Security hardening settings
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

function readJSON(relPath: string): Record<string, unknown> {
  const abs = join(ROOT, relPath);
  return JSON.parse(readFileSync(abs, "utf-8"));
}

function readSafe(relPath: string): string {
  const abs = join(ROOT, relPath);
  try {
    return readFileSync(abs, "utf-8");
  } catch {
    return "";
  }
}

// ─── Realm JSON ──────────────────────────────────────────────────────────────

const realm = readJSON("keycloak/aisha-realm.json");

describe("AISHA ID branding", () => {
  test("realm displayName is AISHA ID", () => {
    expect(realm.displayName).toBe("AISHA ID");
  });

  test("login theme is set to aisha", () => {
    expect(realm.loginTheme).toBe("aisha");
  });

  test("account theme is set to aisha", () => {
    expect(realm.accountTheme).toBe("aisha");
  });

  test("i18n is enabled with cs + en", () => {
    expect(realm.internationalizationEnabled).toBe(true);
    expect(realm.supportedLocales).toContain("cs");
    expect(realm.supportedLocales).toContain("en");
    expect(realm.defaultLocale).toBe("cs");
  });
});

describe("WebAuthn / Passkey configuration", () => {
  test("WebAuthn policy entity name is AISHA ID", () => {
    expect(realm.webAuthnPolicyRpEntityName).toBe("AISHA ID");
  });

  test("WebAuthn passwordless policy entity name is AISHA ID", () => {
    expect(realm.webAuthnPolicyPasswordlessRpEntityName).toBe("AISHA ID");
  });

  test("passwordless requires platform authenticator (biometric)", () => {
    expect(realm.webAuthnPolicyPasswordlessAuthenticatorAttachment).toBe("platform");
  });

  test("passwordless requires resident key (discoverable credential)", () => {
    expect(realm.webAuthnPolicyPasswordlessRequireResidentKey).toBe("Yes");
  });

  test("passwordless requires user verification", () => {
    expect(realm.webAuthnPolicyPasswordlessUserVerificationRequirement).toBe("required");
  });

  test("signature algorithms include ES256", () => {
    const algs = realm.webAuthnPolicySignatureAlgorithms as string[];
    expect(algs).toContain("ES256");
  });

  test("passwordless signature algorithms include ES256", () => {
    const algs = realm.webAuthnPolicyPasswordlessSignatureAlgorithms as string[];
    expect(algs).toContain("ES256");
  });
});

describe("Required actions include WebAuthn", () => {
  const actions = realm.requiredActions as Array<{ alias: string; enabled: boolean }>;

  test("webauthn-register is present and enabled", () => {
    const action = actions.find((a) => a.alias === "webauthn-register");
    expect(action).toBeDefined();
    expect(action!.enabled).toBe(true);
  });

  test("webauthn-register-passwordless is present and enabled", () => {
    const action = actions.find((a) => a.alias === "webauthn-register-passwordless");
    expect(action).toBeDefined();
    expect(action!.enabled).toBe(true);
  });
});

describe("Authentication flow with passkey support", () => {
  const flows = realm.authenticationFlows as Array<{
    alias: string;
    authenticationExecutions: Array<{
      authenticator?: string;
      flowAlias?: string;
      requirement: string;
    }>;
  }>;

  test("browserFlow is set to custom AISHA flow", () => {
    expect(realm.browserFlow).toMatch(/aisha/i);
  });

  test("AISHA Browser flow exists", () => {
    const browserFlow = flows.find((f) => f.alias === realm.browserFlow);
    expect(browserFlow).toBeDefined();
  });

  test("browser flow includes auth-cookie as ALTERNATIVE", () => {
    const browserFlow = flows.find((f) => f.alias === realm.browserFlow)!;
    const cookie = browserFlow.authenticationExecutions.find(
      (e) => e.authenticator === "auth-cookie"
    );
    expect(cookie).toBeDefined();
    expect(cookie!.requirement).toBe("ALTERNATIVE");
  });

  test("browser flow includes WebAuthn passwordless authenticator", () => {
    const browserFlow = flows.find((f) => f.alias === realm.browserFlow)!;
    const webauthn = browserFlow.authenticationExecutions.find(
      (e) => e.authenticator === "webauthn-authenticator-passwordless"
    );
    expect(webauthn).toBeDefined();
    expect(webauthn!.requirement).toBe("ALTERNATIVE");
  });

  test("browser flow includes username-password form sub-flow", () => {
    const browserFlow = flows.find((f) => f.alias === realm.browserFlow)!;
    const formsSub = browserFlow.authenticationExecutions.find((e) => e.flowAlias);
    expect(formsSub).toBeDefined();

    const formsFlow = flows.find((f) => f.alias === formsSub!.flowAlias);
    expect(formsFlow).toBeDefined();

    const pwForm = formsFlow!.authenticationExecutions.find(
      (e) => e.authenticator === "auth-username-password-form"
    );
    expect(pwForm).toBeDefined();
  });
});

// ─── Theme files ─────────────────────────────────────────────────────────────

describe("Keycloak theme structure", () => {
  const THEME_BASE = "keycloak/themes/aisha/login";

  // Tyhle testy dřív zamykaly PatternFly svět (parent=keycloak.v2, aisha.css,
  // PF5 selektory). To rozhodnutí bylo 2026-08-02 vědomě obráceno: PF kreslí
  // rámy pseudoprvky a dává login kontejneru 98px boční padding, takže se
  // přebíjelo něco, co jde místo toho NEDĚDIT. Brána proto hlídá NOVÉ
  // invarianty — hlídat pravopis staré volby by bránilo opravě.
  test("téma dědí base, NE PatternFly (jinak se vrátí přebíjení rámů a paddingu)", () => {
    const props = readSafe(join(THEME_BASE, "theme.properties"));
    expect(props).toMatch(/^parent=base$/m);
    // Měříme DEKLARACE, ne komentáře: soubor o PatternFly píše (proč se nedědí)
    // a hledat holý řetězec by chytlo právě to vysvětlení.
    expect(props).not.toMatch(/^\s*(parent|import)=.*keycloak\.v2/m);
  });

  test("theme.properties declares locales", () => {
    const props = readSafe(join(THEME_BASE, "theme.properties"));
    expect(props).toMatch(/locales=.*en/);
    expect(props).toMatch(/locales=.*cs/);
  });

  test("vrstvy jazyka jsou nasazené ve správném pořadí", () => {
    // Pořadí je nosné: páteř → primitivy → adaptér jmen → rozvržení → hodnoty
    // instance. Prohozením by instanční hodnoty přebil jazyk a značka by zmizela.
    //
    // ⛔ ZMĚNA 2026-08-18 — dvě opravy, obě naměřené skutečným buildem:
    //   · `css/esdk.css` → `css/esdk/styles.css`: soubory SDK jdou do vlastního
    //     podadresáře, protože `styles.css` má `@import "tokens.css"` a to jméno
    //     si jako svoje nárokuje instance (brand.css). Bez podadresáře by se
    //     jedna z těch dvou značek tiše ztratila podle pořadí kopírování.
    //   · `css/esdk/adapter.css` PŘIBYL: vezl se do obrazu, ale nebyl tady ani
    //     nikde jinde, takže se NIKDY nenačetl a mapování krátkých jmen SDK
    //     (`--s4` → `--space-4`) se nedělo. Hlídá to nově brána
    //     tema-nacita-prave-to-co-se-veze, odvozeně z `COPY` a `styles=`.
    const props = readSafe(join(THEME_BASE, "theme.properties"));
    const styles = /^styles=(.*)$/m.exec(props)?.[1]?.split(/\s+/) ?? [];
    expect(styles).toEqual([
      "css/design-language.css",
      "css/esdk/styles.css",
      "css/esdk/adapter.css",
      "css/login.css",
      "css/brand.css",
    ]);
  });

  test("přihlašovací stránka nejmenuje subsystémy — jen agregovaný příznak", () => {
    // ⛔ Stránku vidí KAŽDÝ nepřihlášený. Dřív na ní byly tři `es-lamp` s
    // `data-status-key` (keycloak / postgrest / storageAuth) a popiskem podle
    // komponenty; instanční overlay ty popisky přepsal na produktová jména
    // ("Keycloak SSO", "PostgreSQL", "Document storage"), takže se z ní dalo
    // přečíst složení stacku bez jediného přihlášení.
    //
    // Mechanismus fungoval — chyba byla ve zvolené HODNOTĚ. Proto se ruší
    // možnost, ne text: jeden agregovaný příznak nemá kam jméno subsystému
    // umístit, takže ho instance nevyplní ani omylem.
    // Měří se VYKRESLENÁ značka, ne prosa: FreeMarker komentáře (<#-- -->) se
    // odstraní, jinak by brána spadla na vlastním vysvětlení, proč tam ten
    // atribut být nemá — měřidlo musí měřit vlastnost, ne text o vlastnosti.
    const tpl = readSafe(join(THEME_BASE, "template.ftl")).replace(/<#--[\s\S]*?-->/g, "");
    expect(
      tpl.includes("data-status-key"),
      "kontrolka na subsystém je zpět — nepřihlášený by z popisků přečetl složení stacku"
    ).toBe(false);
    expect(
      (tpl.match(/data-status-aggregate/g) ?? []).length,
      "má být právě JEDEN agregovaný příznak"
    ).toBe(1);

    // A klíče se jmény subsystémů nesmí být ani v bundlech — jinak by je
    // overlay mohl oživit v jiné šabloně.
    for (const lang of ["cs", "en"]) {
      const msgs = readSafe(join(THEME_BASE, `messages/messages_${lang}.properties`));
      const zive = msgs
        .split("\n")
        .filter((l) => /^loginStack(Sso|Data|Storage)\s*=/.test(l));
      expect(zive, `messages_${lang}: klíče pojmenovávající subsystém musí být pryč`).toEqual([]);
    }
  });

  test("jazyk sám zakládá box-sizing — base nepošle žádný reset", () => {
    // ⛔ Naměřeno 2026-08-02 na NASAZENÉ přihlašovací stránce: pole i sociální
    // tlačítka přetékala z karty (#username pravý okraj 534 px vs. karta 525;
    // Apple tlačítko 544 px při viewportu 541; na 390 px přetečení +9 a +19 px).
    //
    // Příčina: `width: 100%` nad VÝCHOZÍM `content-box` — padding a rámeček se
    // přičtou navrch. Povrchy, které jazyk konzumují, si reset vozí samy (bundle
    // extranetu ho má), takže se na něj jazyk mlčky spoléhal. `parent=base` je
    // ale HOLÉ HTML bez jakéhokoli resetu — na rozdíl od PatternFly, ze kterého
    // se odcházelo. První povrch bez vlastního resetu tu díru usvědčil.
    //
    // Baseline proto patří do PÁTEŘE, ne do rozvržení přihlášení: opravuje třídu
    // (každý budoucí holý povrch), ne jeden výskyt.
    const dl = readSafe("packages/design-language/src/styles.css");
    expect(dl.length, "páteř jazyka musí být čitelná").toBeGreaterThan(100);
    const univerzalni = /:where\(\s*\*[^)]*\)\s*\{[^}]*box-sizing:\s*border-box/m.test(dl)
      || /(^|\})\s*\*\s*,?[^{]*\{[^}]*box-sizing:\s*border-box/m.test(dl);
    expect(
      univerzalni,
      "packages/design-language/src/styles.css musí nad univerzálním selektorem " +
        "nastavit box-sizing: border-box — jinak jazyk na povrchu bez vlastního " +
        "resetu (parent=base) rozbije každé pole s width:100%"
    ).toBe(true);
  });

  test("příznak provozu čte jen pole, která /api/health vydává NEPŘIHLÁŠENÉMU", () => {
    // Přihlašovací stránku vidí i nepřihlášený, takže `status.js` volá
    // `/api/health` s `credentials: "omit"`. Gateway mu vydá POUZE agregát:
    //
    //   nepřihlášený  { status, checked_at }
    //   přihlášený    + gateway, upstreams        (telo.X = … za ověřením claims)
    //
    // NAMĚŘENO 2026-08-03: `status.js` četl `body.upstreams` a skládal z něj
    // nejhorší stav — tak vypadala odpověď PŘED zjednodušením v #107, které
    // schválně přestalo vydávat jména podsystémů. Obě změny šly stejnou noc a
    // rozešly se: fetch prošel (200, 165 ms), `upstreams` chybělo, funkce tiše
    // skončila a příznak zůstal navždy na „Stav provozu se zjišťuje".
    //
    // Tichý rozchod dvou stran jednoho kontraktu se nepozná ani z jedné strany
    // zvlášť — proto je měřen jejich PRŮNIK.
    const js = readSafe(join(THEME_BASE, "resources/js/status.js"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const route = readSafe("services/gateway/src/routes/health.ts");
    expect(js.length, "status.js musí být čitelný").toBeGreaterThan(100);
    expect(route.length, "health.ts musí být čitelný").toBeGreaterThan(100);

    // Pole, která route vydává BEZ ověření: klíče objektového literálu `telo`.
    const telo = route.match(/const\s+telo[^=]*=\s*\{([^}]*)\}/)?.[1] ?? "";
    const anonymni = new Set(
      [...telo.matchAll(/^\s*([a-z_][\w]*)\s*:/gim)].map((m) => m[1]!),
    );
    expect(
      anonymni.size,
      "v health.ts nejde najít literál `telo` — změnil se tvar odpovědi?",
    ).toBeGreaterThan(0);

    // Pole, která si skript z odpovědi bere. `body` musí být SAMOSTATNÝ
    // identifikátor (parametr `.then((body) => …)`) — bez toho by se chytal
    // i `document.body.getAttribute(…)`, kterým se čte adresa endpointu.
    const ctena = [...js.matchAll(/(?<![.\w])body(?:\s*&&\s*body)?\.([a-z_][\w]*)/gi)]
      .map((m) => m[1]!);

    const navic = [...new Set(ctena)].filter((f) => !anonymni.has(f));
    expect(
      navic,
      "status.js čte z /api/health pole, která nepřihlášenému NEDORAZÍ:\n" +
      navic.map((f) => `  body.${f}`).join("\n") +
      `\n\nNepřihlášený dostane jen: ${[...anonymni].join(", ")}. ` +
      "Pole za ověřením (gateway, upstreams) se na přihlašovací stránce nikdy " +
      "neobjeví, takže se na ně nedá spolehnout — příznak by mlčel.",
    ).toEqual([]);
  });

  test("každý seznam, který téma stylizuje, si vynuluje výchozí odsazení prohlížeče", () => {
    // `parent=base` je holé HTML — žádný reset. `ul`/`ol` si proto nesou
    // výchozí `padding-inline-start: 40px` a `margin-block: 1em` prohlížeče.
    // Kdo je nepřebije ZKRATKOU (`padding:` / `margin:`), nechá je naživu:
    // longhand `padding-top` se s `padding-inline-start` nepotká.
    //
    // NAMĚŘENO 2026-08-03 na nasazené stránce (viewport 1280): pole šlo od
    // x=931, ale #social-google a #social-apple až od x=971 — o 40 px mimo osu
    // formuláře. `.login-locale__list` to měl správně, `.login-social` ne.
    //
    // Univerzum se ČTE z theme.properties (háčky `*ListClass`), takže nový
    // seznamový háček se přihlásí sám a nedá se opomenout v ručním seznamu.
    const props = readSafe(join(THEME_BASE, "theme.properties"));
    const css = readSafe(join(THEME_BASE, "resources/css/login.css"));

    const seznamoveTridy = [...props.matchAll(/^kc\w*ListClass\s*=\s*(\S+)\s*$/gm)]
      .flatMap((m) => m[1]!.split(/\s+/))
      .filter(Boolean);

    expect(
      seznamoveTridy.length,
      "v theme.properties nejsou žádné *ListClass háčky — přesunulo se mapování?"
    ).toBeGreaterThan(0);

    const hrisnici: string[] = [];
    for (const trida of seznamoveTridy) {
      // Tělo pravidla `.trida { … }` (bez vnořených bloků — CSS je plochý).
      const re = new RegExp(`(^|\\})[^{}]*\\.${trida.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^{}]*\\{([^}]*)\\}`, "m");
      const telo = css.match(re)?.[2];
      if (telo === undefined) continue;   // třída se v rozvržení nestylizuje
      const maZkratku = (vlastnost: string) =>
        new RegExp(`(^|;)\\s*${vlastnost}\\s*:`, "m").test(telo) ||
        new RegExp(`(^|;)\\s*${vlastnost}-(inline|left)[\\w-]*\\s*:`, "m").test(telo);
      if (!maZkratku("padding")) hrisnici.push(`.${trida}: chybí zkratka \`padding\``);
      if (!maZkratku("margin")) hrisnici.push(`.${trida}: chybí zkratka \`margin\``);
    }

    expect(
      hrisnici,
      "Seznam bez zkratky si nechá výchozí odsazení prohlížeče a rozejde se s osou " +
      "formuláře (parent=base nemá reset):\n" + hrisnici.map((h) => `  ${h}`).join("\n") +
      "\n\nPoužij `margin: X 0 0` a `padding: Y 0 0` místo `margin-top`/`padding-top`."
    ).toEqual([]);
  });

  test("rozvržení neobsahuje hodnotu značky — barvy patří do tokenů", () => {
    const css = readSafe(join(THEME_BASE, "resources/css/login.css"));
    expect(css.length).toBeGreaterThan(100);
    // `#000`/`#fff` v mask-image není barva, ale krytí masky — proto výjimka.
    const hexy = (css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).filter(
      (h) => !/^#(0{3,8}|f{3,8})$/i.test(h)
    );
    expect(hexy, `hex v rozvržení: ${hexy.join(", ")}`).toEqual([]);
    // Komentář na začátku souboru ten zákaz POPISUJE — měřit se musí kód.
    const kod = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(kod, "!important v rozvržení znamená boj s jazykem").not.toContain("!important");
  });

  test("brand.css je bod přepisu pro instanci a v platformě nenese značku", () => {
    const brand = readSafe(join(THEME_BASE, "resources/css/brand.css"));
    expect(brand.length).toBeGreaterThan(0);
    expect((brand.match(/#[0-9a-f]{3,8}\b/gi) ?? []).length).toBe(0);
  });

  test("výchozí logo má stálé jméno, aby ho overlay mohl přepsat", () => {
    expect(existsSync(join(ROOT, THEME_BASE, "resources/img/logo.svg"))).toBe(true);
  });

  test("šablona neimportuje soubory, které base nemá", () => {
    // Naměřeno 2026-08-02: `<#import "field.ftl">` (existuje jen v keycloak.v2)
    // shodil přihlašovací stránku na HTTP 500 — build i start přitom prošly.
    const tpl = readSafe(join(THEME_BASE, "template.ftl"));
    const imports = [...tpl.matchAll(/<#import\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["footer.ftl"]);
  });

  test("message bundly nesou každý klíč, který šablona používá", () => {
    // Chybějící klíč se v KC nevykreslí jako prázdno, ale jako HOLÉ JMÉNO
    // KLÍČE na stránce — tichá vada, kterou build nezachytí.
    const tpl = readSafe(join(THEME_BASE, "template.ftl"));
    // Jen NÁŠ jmenný prostor: klíče jako `languages` nebo `requiredFields`
    // dodává rodičovské téma `base` a KC je řeší po klíčích přes celý řetěz.
    const keys = [...tpl.matchAll(/msg\(["'](login[A-Z][\w.-]*)["']/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(5);
    for (const locale of ["cs", "en"]) {
      const msgs = readSafe(join(THEME_BASE, `messages/messages_${locale}.properties`));
      const missing = [...new Set(keys)].filter((k) => !new RegExp(`^${k}=`, "m").test(msgs));
      expect(missing, `messages_${locale} nemá: ${missing.join(", ")}`).toEqual([]);
    }
  });
});

// ─── Security hardening ─────────────────────────────────────────────────────

describe("Keycloak security hardening", () => {
  test("brute force protection is enabled", () => {
    expect(realm.bruteForceProtected).toBe(true);
  });

  test("permanent lockout is disabled (temporary lockout preferred)", () => {
    expect(realm.permanentLockout).toBe(false);
  });

  test("failure factor is 5 or less", () => {
    expect(realm.failureFactor).toBeLessThanOrEqual(5);
  });

  test("SSO session idle timeout is 30 min or less", () => {
    // 1800 seconds = 30 minutes
    expect(realm.ssoSessionIdleTimeout).toBeLessThanOrEqual(1800);
  });

  test("access token lifespan is 5 min or less", () => {
    // 300 seconds = 5 minutes
    expect(realm.accessTokenLifespan).toBeLessThanOrEqual(300);
  });

  test("SSL is required for external requests", () => {
    expect(realm.sslRequired).toBe("external");
  });

  test("no client uses direct access grants — except documented system clients", () => {
    // ROPC (Resource Owner Password Credentials) is broadly disallowed for
    // user-facing clients. The only exception is `aisha-bootstrap`: a
    // confidential, server-to-server client used during cold-start by
    // scripts/netbird-bootstrap.sh to obtain a user-context token for the
    // `aisha-bootstrap` system user, so the FIRST NetBird API call happens
    // as a real Keycloak user (not the netbird-backend service account).
    // Without this, NetBird's IDP user-sync cannot resolve the account
    // owner's UUID and the mesh stays broken.
    //
    // Justification documented in:
    //   - keycloak/aisha-realm.json (client description field)
    //   - scripts/aisha-bootstrap-user-init.sh (header comment)
    //   - scripts/netbird-bootstrap.sh (claim_account_ownership_as_bootstrap_user)
    //   - src/tests/gates/netbird-account-owner.gate.test.ts (gate test)
    // ROPC allowed for documented system bootstrap clients only:
    //   aisha-bootstrap     — NetBird account ownership (mesh control plane)
    //   aisha-pki-bootstrap — automated PKI cert issuance (Phase 2 of
    //                         scripts/pki-issue-internal-cert.sh)
    // Each is paired with a dedicated Keycloak user that has the minimum
    // role needed for its target operation. Tokens have audience claims
    // that scope them to a single OAuth2 Proxy / API surface.
    const ROPC_ALLOWLIST = new Set(["aisha-bootstrap", "aisha-pki-bootstrap"]);

    const clients = realm.clients as Array<{
      clientId: string;
      directAccessGrantsEnabled: boolean;
    }>;
    for (const client of clients) {
      if (ROPC_ALLOWLIST.has(client.clientId)) {
        // Allowed exception — must remain confidential server-side client.
        continue;
      }
      expect(
        client.directAccessGrantsEnabled,
        `${client.clientId} should not enable direct access grants (only documented system clients are exempt; see ROPC_ALLOWLIST)`
      ).toBe(false);
    }
  });

  test("Dockerfile.keycloak bakes theme into image", () => {
    const dockerfile = readSafe("Dockerfile.keycloak");
    // --chown=1000:0: the entrypoint's __SUPPORT_EMAIL__ sed runs as user 1000;
    // root-owned theme files crash-looped KC under set -eu (fork a2d28c83).
    expect(dockerfile).toContain("COPY --chown=1000:0 keycloak/themes/aisha");
  });

  test("Dockerfile.keycloak bakes realm import into image", () => {
    const dockerfile = readSafe("Dockerfile.keycloak");
    expect(dockerfile).toContain("COPY keycloak/aisha-realm.json");
  });

  test("Dockerfile.keycloak includes configure-realms script", () => {
    const dockerfile = readSafe("Dockerfile.keycloak");
    expect(dockerfile).toContain("configure-realms.sh");
  });
});

// ─── Favicon ────────────────────────────────────────────────────────────────

describe("Keycloak favicon", () => {
  const THEME_BASE = "keycloak/themes/aisha/login";

  test("favicon.ico exists", () => {
    expect(existsSync(join(ROOT, THEME_BASE, "resources/img/favicon.ico"))).toBe(true);
  });

  test("favicon.svg exists", () => {
    expect(existsSync(join(ROOT, THEME_BASE, "resources/img/favicon.svg"))).toBe(true);
  });
});

// ─── Local / warmup environment ──────────────────────────────────────────────

describe("Local warmup KC configuration", () => {
  test("configure-realms.sh exists and is executable concept", () => {
    const script = readSafe("keycloak/configure-realms.sh");
    expect(script).toContain("AISHA ID");
    expect(script).toContain("master");
    expect(script).toContain("aisha");
  });
});

// ─── CSS PF5 compatibility ───────────────────────────────────────────────────

describe("Přihlašovací stránka nedědí PatternFly", () => {
  // Nahrazuje dřívější blok „CSS PatternFly v5 compatibility", který hlídal
  // správné PŘEBÍJENÍ PatternFly (grid, výška tlačítek, 1200px zlom). Ta
  // vrstva 2026-08-02 zmizela: téma dědí `base` a jazyk se definuje, ne
  // přebíjí. Hlídáme tedy, že se PF nevrátí zadními vrátky — jinak by se
  // vrátily i jeho pasti (rámy v ::before, 98px padding kontejneru).
  const props = readSafe("keycloak/themes/aisha/login/theme.properties");
  const css = readSafe("keycloak/themes/aisha/login/resources/css/login.css");

  test("žádný PatternFly selektor v rozvržení", () => {
    expect(css).not.toMatch(/\.pf-v5-c-/);
  });

  test("téma nedědí PatternFly ani přes import", () => {
    expect(props).not.toMatch(/^parent=keycloak/m);
    expect(props).not.toMatch(/^import=/m);
  });

  test("rozvržení stojí na primitivech ESDK, ne na vlastních kopiích", () => {
    // Karta a pole nesmí mít vlastní definici — ty vezou .es-card/.es-inp.
    expect(props).toMatch(/^kcFormCardClass=.*es-card/m);
    expect(props).toMatch(/^kcInputClass=es-inp$/m);
    expect(props).toMatch(/^kcButtonPrimaryClass=es-btn$/m);
  });
});
