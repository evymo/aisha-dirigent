/**
 * Klient úložiště — nahrání, smazání, podepsaná adresa.
 *
 * ⛔ Test měří TVAR VOLÁNÍ, ne jen „nespadlo to". Původní `upload()` posílal jeden
 * POST s tělem souboru na `/object/{bucket}/{path}`, což je kontrakt hostovaného
 * storage SDK — naše `storage-auth` ho nemá (naměřeno přes veřejnou bránu: 404).
 * Proto se tady ověřuje, že jdou DVĚ volání (preflight + PUT na podepsanou
 * adresu) a že se vrací klíč, který VYRAZIL SERVER, ne ten, o který si klient
 * řekl. Kdo si klíč vymyslí sám, postaví adresu obrázku, na které nic není.
 *
 * Cestu vs. skutečné routy hlídá brána `uloziste-klient-mluvi-existujici-routou`
 * (mock odpoví na cokoli — proto k tomu patří brána nad zdrojem).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/integrations/auth/oidc-client", () => ({
  getAccessToken: () => Promise.resolve("token-abc"),
}));

import { storage } from "@/integrations/api/storage";

interface Zaznam {
  url: string;
  metoda: string;
  telo: unknown;
  hlavicky: Record<string, string>;
}

let zaznamy: Zaznam[] = [];
const puvodniFetch = globalThis.fetch;
const puvodniXhr = globalThis.XMLHttpRequest;

/**
 * Odpovědi se čerpají v pořadí VOLÁNÍ bez ohledu na kanál: preflight a ohlášení
 * jdou přes `fetch`, PUT bajtů přes XMLHttpRequest (od 2026-09-24 — `fetch` průběh
 * odesílání neumí). Falešný XHR zapisuje do téže posloupnosti záznamů, takže test
 * dál měří TVAR volání: preflight → PUT bez tokenu → ohlášení.
 */
function nastavOdpovedi(odpovedi: Array<{ ok: boolean; status?: number; json?: unknown }>) {
  let i = 0;
  const dalsi = () => {
    const o = odpovedi[i] ?? odpovedi[odpovedi.length - 1];
    i += 1;
    return o;
  };
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    zaznamy.push({
      url: String(url),
      metoda: init?.method ?? "GET",
      telo: init?.body,
      hlavicky: (init?.headers ?? {}) as Record<string, string>,
    });
    const o = dalsi();
    return {
      ok: o.ok,
      status: o.status ?? (o.ok ? 200 : 500),
      statusText: o.ok ? "OK" : "Error",
      json: async () => o.json ?? {},
    } as Response;
  }) as typeof globalThis.fetch;

  class FalesnyXhr {
    private metoda = "GET";
    private url = "";
    private hlavicky: Record<string, string> = {};
    status = 0;
    responseText = "";
    timeout = 0;
    upload: { onprogress: ((ev: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    open(metoda: string, url: string) {
      this.metoda = metoda;
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.hlavicky[k] = v;
    }
    abort() {
      this.onabort?.();
    }
    send(telo: unknown) {
      zaznamy.push({ url: this.url, metoda: this.metoda, telo, hlavicky: this.hlavicky });
      const o = dalsi();
      this.status = o.status ?? (o.ok ? 200 : 500);
      this.responseText = o.json ? JSON.stringify(o.json) : "";
      queueMicrotask(() => this.onload?.());
    }
  }
  globalThis.XMLHttpRequest = FalesnyXhr as unknown as typeof XMLHttpRequest;
}

beforeEach(() => {
  zaznamy = [];
});
afterEach(() => {
  globalThis.fetch = puvodniFetch;
  globalThis.XMLHttpRequest = puvodniXhr;
  vi.restoreAllMocks();
});

const soubor = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

describe("storage.from(bucket).upload", () => {
  /**
   * ⛔ TŘI VOLÁNÍ, NE DVĚ (změna tvrzení 2026-09-21). PUT doručí bajty do
   * KARANTÉNNÍHO bucketu; teprve ohlášení `/upload-complete` objekt oskenuje
   * (clamd, fail-closed) a při čistém verdiktu promuje do cílového bucketu.
   * Bez třetího volání soubor existuje, ale nikdy se neservíruje — proto se
   * adresa smí složit až z odpovědi toho ohlášení.
   */
  it("preflight → PUT do karantény → ohlášení, které spustí sken", async () => {
    nastavOdpovedi([
      {
        ok: true,
        json: {
          uploadUrl: "https://minio.example/podpis",
          quarantineKey: "page-assets/user-1/uuid_x.png",
          objectKey: "user-1/uuid_x.png",
        },
      },
      { ok: true },
      { ok: true, json: { bucket: "page-assets", objectKey: "user-1/uuid_x.png", status: "clean" } },
    ]);

    const vysledek = await storage.from("page-assets").upload("x.png", soubor(), {
      contentType: "image/png",
    });

    expect(zaznamy).toHaveLength(3);
    expect(zaznamy[0].metoda).toBe("POST");
    expect(zaznamy[0].url).toContain("/storage/v1/upload-preflight");
    expect(JSON.parse(String(zaznamy[0].telo))).toMatchObject({
      bucket: "page-assets",
      filename: "x.png",
      contentType: "image/png",
      fileSizeBytes: 3,
    });
    expect(zaznamy[0].hlavicky.Authorization).toBe("Bearer token-abc");

    expect(zaznamy[1].metoda).toBe("PUT");
    expect(zaznamy[1].url).toBe("https://minio.example/podpis");
    // Podpis JE oprávnění — token na podepsanou adresu nepatří.
    expect(zaznamy[1].hlavicky.Authorization).toBeUndefined();

    expect(zaznamy[2].metoda).toBe("POST");
    expect(zaznamy[2].url).toContain("/storage/v1/upload-complete");
    expect(JSON.parse(String(zaznamy[2].telo))).toEqual({
      objectKey: "page-assets/user-1/uuid_x.png",
    });
    expect(zaznamy[2].hlavicky.Authorization).toBe("Bearer token-abc");

    expect(vysledek.error).toBeNull();
    expect(vysledek.data?.path, "vrací se klíč od SERVERU po promoci").toBe("user-1/uuid_x.png");
  });

  it("infikovaný soubor = chyba, ne tichý úspěch", async () => {
    nastavOdpovedi([
      {
        ok: true,
        json: {
          uploadUrl: "https://minio.example/podpis",
          quarantineKey: "page-assets/user-1/uuid_x.png",
          objectKey: "user-1/uuid_x.png",
        },
      },
      { ok: true },
      { ok: false, status: 422, json: { error: "infected", message: "The uploaded file was rejected by the virus scanner" } },
    ]);

    const vysledek = await storage.from("page-assets").upload("x.png", soubor());

    expect(zaznamy).toHaveLength(3);
    expect(vysledek.data, "adresa obrázku nesmí vzniknout").toBeNull();
    expect(vysledek.error?.code).toBe("422");
  });

  it("nedostupný skener = chyba (fail-closed), objekt zůstane v karanténě", async () => {
    nastavOdpovedi([
      {
        ok: true,
        json: {
          uploadUrl: "https://minio.example/podpis",
          quarantineKey: "page-assets/user-1/uuid_x.png",
          objectKey: "user-1/uuid_x.png",
        },
      },
      { ok: true },
      { ok: false, status: 502, json: { error: "scan_unavailable" } },
    ]);

    const vysledek = await storage.from("page-assets").upload("x.png", soubor());

    expect(vysledek.data).toBeNull();
    expect(vysledek.error?.code).toBe("502");
  });

  it("odmítnutý preflight = chyba a ŽÁDNÝ PUT", async () => {
    nastavOdpovedi([{ ok: false, status: 403, json: { message: "Uploading to a public bucket requires the admin or staff role" } }]);

    const vysledek = await storage.from("page-assets").upload("x.png", soubor());

    expect(zaznamy).toHaveLength(1);
    expect(vysledek.data).toBeNull();
    expect(vysledek.error?.code).toBe("403");
    expect(vysledek.error?.message).toMatch(/admin or staff/);
  });

  it("selhání PUT se ohlásí, nehlásí se úspěch", async () => {
    nastavOdpovedi([
      { ok: true, json: { uploadUrl: "https://minio.example/podpis", quarantineKey: "page-assets/k", objectKey: "k" } },
      { ok: false, status: 502 },
    ]);

    const vysledek = await storage.from("page-assets").upload("x.png", soubor());

    expect(zaznamy, "po selhání PUT se dokončení NEohlašuje").toHaveLength(2);
    expect(vysledek.data).toBeNull();
    expect(vysledek.error?.code).toBe("502");
  });
});

describe("storage.from(bucket).remove", () => {
  it("maže po jednom objektu a první odmítnutí zastaví zbytek", async () => {
    nastavOdpovedi([{ ok: false, status: 403, json: { message: "nope" } }]);

    const vysledek = await storage.from("page-assets").remove(["a.png", "b.png"]);

    expect(zaznamy, "druhý objekt se po 403 už zkoušet nemá").toHaveLength(1);
    expect(zaznamy[0].metoda).toBe("DELETE");
    expect(zaznamy[0].url).toContain("/storage/v1/object/page-assets/a.png");
    expect(vysledek.error?.code).toBe("403");
  });

  it("smaže všechny předané klíče", async () => {
    nastavOdpovedi([{ ok: true, status: 204 }]);

    const vysledek = await storage.from("page-assets").remove(["a.png", "b.png"]);

    expect(zaznamy.map((z) => z.url.split("/page-assets/")[1])).toEqual(["a.png", "b.png"]);
    expect(vysledek.error).toBeNull();
  });
});

describe("storage.from(bucket).createSignedUrl", () => {
  it("žádá GETem — routa POST nemá", async () => {
    nastavOdpovedi([{ ok: true, json: { signedUrl: "https://minio.example/podpis-ke-cteni" } }]);

    const vysledek = await storage.from("health-documents").createSignedUrl("a/b.pdf", 300);

    expect(zaznamy[0].metoda).toBe("GET");
    expect(zaznamy[0].url).toContain("/storage/v1/object/sign/health-documents/a/b.pdf");
    expect(zaznamy[0].url).toContain("expiresIn=300");
    expect(vysledek.data?.signedUrl).toBe("https://minio.example/podpis-ke-cteni");
  });
});
