import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nahraniSPrubehem, ChybaNahrani } from "@/lib/nahravani/nahraniSPrubehem";

/**
 * Falešný XMLHttpRequest: zaznamená, co klient nastavil, a nechá test řídit
 * průběh, odpověď i chyby. Skutečnou síť tu měřit nejde; měří se KONTRAKT —
 * metoda, hlavičky, tělo, průběh z `upload.onprogress`, zrušení přes signal.
 */
class FalesnyXhr {
  static posledni: FalesnyXhr | null = null;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = null;
  timeout = 0;
  status = 0;
  responseText = "";
  upload: { onprogress: ((ev: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  zruseno = false;
  constructor() {
    FalesnyXhr.posledni = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.zruseno = true;
    this.onabort?.();
  }
}

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", FalesnyXhr);
  FalesnyXhr.posledni = null;
});
afterEach(() => vi.unstubAllGlobals());

const soubor = new Blob(["0123456789"], { type: "image/png" });

describe("nahrání s průběhem", () => {
  it("PUTne tělo s hlavičkami a hlásí průběh z upload.onprogress", async () => {
    const prubeh: number[] = [];
    const p = nahraniSPrubehem("https://api.test/storage/v1/nahrani/tok", {
      method: "PUT",
      body: soubor,
      headers: { "Content-Type": "image/png" },
      onProgress: (podil) => prubeh.push(podil),
      timeoutMs: 5000,
    });
    const xhr = FalesnyXhr.posledni!;
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe("https://api.test/storage/v1/nahrani/tok");
    expect(xhr.headers["Content-Type"]).toBe("image/png");
    expect(xhr.body).toBe(soubor);
    expect(xhr.timeout).toBe(5000);

    xhr.upload.onprogress!({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 10, total: 10 } as ProgressEvent);
    xhr.status = 200;
    xhr.responseText = '{"ok":true,"objectKey":"u/x.png"}';
    xhr.onload!();

    const odpoved = await p;
    expect(prubeh).toEqual([0.5, 1]);
    expect(odpoved.ok).toBe(true);
    expect(odpoved.status).toBe(200);
    expect(odpoved.json<{ objectKey: string }>()?.objectKey).toBe("u/x.png");
  });

  it("chybový stav není výjimka — volající čte status a tělo", async () => {
    const p = nahraniSPrubehem("https://api.test/x", { method: "PUT", body: soubor });
    const xhr = FalesnyXhr.posledni!;
    xhr.status = 422;
    xhr.responseText = '{"error":"infected"}';
    xhr.onload!();
    const odpoved = await p;
    expect(odpoved.ok).toBe(false);
    expect(odpoved.json<{ error: string }>()?.error).toBe("infected");
  });

  it("síťová chyba a vypršení jsou ChybaNahrani s důvodem", async () => {
    const p1 = nahraniSPrubehem("https://api.test/x", { method: "PUT", body: soubor });
    FalesnyXhr.posledni!.onerror!();
    await expect(p1).rejects.toMatchObject({ name: "ChybaNahrani", duvod: "sit" });

    const p2 = nahraniSPrubehem("https://api.test/x", { method: "PUT", body: soubor });
    FalesnyXhr.posledni!.ontimeout!();
    await expect(p2).rejects.toMatchObject({ duvod: "timeout" });
  });

  it("zrušení přes AbortSignal zavolá abort a odmítne důvodem zruseno", async () => {
    const ctl = new AbortController();
    const p = nahraniSPrubehem("https://api.test/x", { method: "PUT", body: soubor, signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toBeInstanceOf(ChybaNahrani);
    expect(FalesnyXhr.posledni!.zruseno).toBe(true);
  });

  it("už zrušený signal se ani neposílá", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(nahraniSPrubehem("https://api.test/x", { method: "PUT", body: soubor, signal: ctl.signal })).rejects.toMatchObject({ duvod: "zruseno" });
    expect(FalesnyXhr.posledni).toBeNull();
  });
});
