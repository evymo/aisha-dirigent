/**
 * Přihlášení na Androidu ve WebView: kam smí stránka navigovat a jak se čte návrat.
 */
import { prectiNavrat, rozeber, rozhodniNavigaci } from "@/lib/prihlaseniWebView";

const CIL = {
  authority: "https://auth.example.cz/realms/aisha",
  redirectUri: "cz.example.ridic://oauth-callback",
};

describe("rozhodniNavigaci", () => {
  it("povolí přihlašovací stránku, odeslání formuláře i zdroje stránky", () => {
    expect(rozhodniNavigaci("https://auth.example.cz/realms/aisha/protocol/openid-connect/auth?client_id=x", CIL)).toBe("povolit");
    expect(rozhodniNavigaci("https://auth.example.cz/realms/aisha/login-actions/authenticate?session_code=1", CIL)).toBe("povolit");
    expect(rozhodniNavigaci("https://auth.example.cz/resources/abc/login/aisha/css/brand.css", CIL)).toBe("povolit");
    expect(rozhodniNavigaci("about:blank", CIL)).toBe("povolit");
  });

  it("návrat na redirect_uri zpracuje appka, nenačítá se", () => {
    expect(rozhodniNavigaci("cz.example.ridic://oauth-callback?state=s&code=c", CIL)).toBe("navrat");
  });

  it("⛔ broker Google/Apple zablokuje — majitel chce jen jméno a heslo", () => {
    expect(rozhodniNavigaci("https://auth.example.cz/realms/aisha/broker/google/login?client_id=x", CIL)).toBe("blokovat");
    expect(rozhodniNavigaci("https://auth.example.cz/realms/aisha/broker/apple/login", CIL)).toBe("blokovat");
  });

  it("⛔ cizí adresa, jiný realm, http místo https i nečitelná adresa se zablokují", () => {
    expect(rozhodniNavigaci("https://accounts.google.com/o/oauth2/auth", CIL)).toBe("blokovat");
    expect(rozhodniNavigaci("https://auth.example.cz.utocnik.cz/realms/aisha/", CIL)).toBe("blokovat");
    expect(rozhodniNavigaci("https://auth.example.cz/realms/master/account", CIL)).toBe("blokovat");
    expect(rozhodniNavigaci("http://auth.example.cz/realms/aisha/protocol/openid-connect/auth", CIL)).toBe("blokovat");
    expect(rozhodniNavigaci("https://auth.example.cz/admin/master/console/", CIL)).toBe("blokovat");
    expect(rozhodniNavigaci("javascript:alert(1)", CIL)).toBe("blokovat");
  });
});

describe("prectiNavrat", () => {
  it("vydá kód jen pro stejný state", () => {
    expect(prectiNavrat("cz.example.ridic://oauth-callback?state=abc&code=K1&session_state=x", "abc")).toEqual({ code: "K1" });
  });

  it("⛔ cizí nebo chybějící state = chyba, ne kód (CSRF)", () => {
    expect(prectiNavrat("cz.example.ridic://oauth-callback?state=jiny&code=K1", "abc")).toHaveProperty("error");
    expect(prectiNavrat("cz.example.ridic://oauth-callback?code=K1", "abc")).toHaveProperty("error");
    expect(prectiNavrat("cz.example.ridic://oauth-callback?state=&code=K1", "")).toHaveProperty("error");
  });

  it("chybu Keycloaku nese doslova", () => {
    expect(prectiNavrat("cz.example.ridic://oauth-callback?state=abc&error=access_denied&error_description=User+denied", "abc")).toEqual({
      error: "access_denied — User denied",
    });
  });

  it("parametry čte i z fragmentu a dekóduje je", () => {
    expect(prectiNavrat("cz.example.ridic://oauth-callback#state=a%20b&code=K%2F2", "a b")).toEqual({ code: "K/2" });
  });
});

describe("rozeber", () => {
  it("origin je schéma + host malými písmeny, cesta bez dotazu", () => {
    expect(rozeber("HTTPS://Auth.Example.cz:8443/realms/aisha?x=1")).toMatchObject({
      origin: "https://auth.example.cz:8443",
      cesta: "/realms/aisha",
    });
  });
});
