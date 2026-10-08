/**
 * Servírování výstupu po HTTP (d-ii) a příjem skořápky (PUT /shell).
 *
 * Drží VLASTNOSTI, ne vzorek: stránka i obrázek se vydají na tvaru URL, který
 * dřív obsluhoval nginx z `_static`; NIC mimo kořen výstupu (traversal, skryté
 * soubory, zakódované `..`) se nevydá; skořápku smí vyměnit jen držitel
 * vlastního tokenu a jen platnou (s <script>).
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { HLAVICKA_OTISKU, souborProCestu, zaregistrujServirovani } from "./servirovani.js";
import { zaregistrujSkorapku } from "./skorapka.js";

function vystup() {
  const koren = mkdtempSync(join(tmpdir(), "wr-out-"));
  writeFileSync(join(koren, "index.html"), "<p>uvod</p>");
  mkdirSync(join(koren, "o-nas"), { recursive: true });
  writeFileSync(join(koren, "o-nas", "index.html"), "<p>o nas</p>");
  mkdirSync(join(koren, "blog", "prvni"), { recursive: true });
  writeFileSync(join(koren, "blog", "prvni", "index.html"), "<p>prvni</p>");
  mkdirSync(join(koren, "_img"), { recursive: true });
  writeFileSync(join(koren, "_img", "0123456789abcdef.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // Rozepsaný soubor z atomického zápisu — nesmí ven.
  writeFileSync(join(koren, "_img", "0123456789abcdef.png.tmp-1-x"), "rozepsane");
  writeFileSync(join(koren, ".tajne"), "nesmi ven");
  // Soubor VEDLE kořene — cíl traversalu.
  writeFileSync(join(koren, "..", `${koren.split("/").pop()}-soused.html`), "mimo koren");
  return koren;
}

async function appServirovani(koren: string, otiskVystupu: () => string = () => "") {
  const app = Fastify();
  app.get("/healthz", async () => ({ status: "ok" }));
  zaregistrujServirovani(app, { koren, otiskVystupu });
  await app.ready();
  return app;
}

describe("servírování výstupu", () => {
  it("vydá úvod, stránku se lomítkem i bez něj, vnořenou stránku a obrázek s typy", async () => {
    const app = await appServirovani(vystup());
    const uvod = await app.inject({ method: "GET", url: "/" });
    expect(uvod.statusCode).toBe(200);
    expect(uvod.body).toBe("<p>uvod</p>");
    expect(uvod.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(uvod.headers["cache-control"]).toBe("no-cache");
    for (const url of ["/o-nas/", "/o-nas", "/o-nas/?utm=x"]) {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode, url).toBe(200);
      expect(r.body).toBe("<p>o nas</p>");
    }
    expect((await app.inject({ method: "GET", url: "/blog/prvni/" })).body).toBe("<p>prvni</p>");
    const img = await app.inject({ method: "GET", url: "/_img/0123456789abcdef.png" });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("HEAD odpoví bez těla", async () => {
    const app = await appServirovani(vystup());
    const r = await app.inject({ method: "HEAD", url: "/o-nas/" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe("");
  });

  it("neznámá stránka je 404 (Edge pak servíruje SPA), specifická trasa má přednost", async () => {
    const app = await appServirovani(vystup());
    expect((await app.inject({ method: "GET", url: "/neexistuje/" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/healthz" })).json()).toEqual({ status: "ok" });
  });

  it("VLASTNOST: nic mimo kořen výstupu ani skryté soubory se nevydají", async () => {
    const koren = vystup();
    const app = await appServirovani(koren);
    const soused = `${koren.split("/").pop()}-soused.html`;
    const pokusy = [
      `/../${soused}`,
      `/%2e%2e/${soused}`,
      `/%2E%2E%2F${soused}`,
      "/_img/../index.html",
      "/_img/%2e%2e%2findex.html",
      "/.tajne",
      "/_img/",
      "/_img/a/b.png",
      "/o-nas%00/",
      "/%ZZ",
      "/o nas/",
      "/_img/0123456789abcdef.png.tmp-1-x",
      "/_img/0123456789ABCDEF.png",
    ];
    for (const url of pokusy) {
      const r = await app.inject({ method: "GET", url });
      // 404 z obsluhy, nebo 400, když URL odmítne už Fastify (neplatné kódování).
      expect([400, 404], url).toContain(r.statusCode);
      expect(r.body, url).not.toContain("mimo koren");
      expect(r.body, url).not.toContain("nesmi ven");
      expect(r.body, url).not.toContain("rozepsane");
    }
  });

  it("podmíněný GET: ETag i Last-Modified → 304 bez těla (Edge revaliduje levně)", async () => {
    const app = await appServirovani(vystup());
    const prvni = await app.inject({ method: "GET", url: "/o-nas/" });
    const etag = prvni.headers.etag as string;
    expect(etag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    const podleEtagu = await app.inject({ method: "GET", url: "/o-nas/", headers: { "if-none-match": etag } });
    expect(podleEtagu.statusCode).toBe(304);
    expect(podleEtagu.body).toBe("");
    const podleCasu = await app.inject({
      method: "GET",
      url: "/o-nas/",
      headers: { "if-modified-since": prvni.headers["last-modified"] as string },
    });
    expect(podleCasu.statusCode).toBe(304);
    const jinyEtag = await app.inject({ method: "GET", url: "/o-nas/", headers: { "if-none-match": 'W/"0-0"' } });
    expect(jinyEtag.statusCode).toBe(200);
    expect(jinyEtag.body).toBe("<p>o nas</p>");
  });

  it("otisk skořápky: shoda → 200, neshoda → 412 bez cache, bez hlavičky nebo s vadnou se nekontroluje", async () => {
    const app = await appServirovani(vystup(), () => "aaaaaaaaaaaaaaaa");
    const shoda = await app.inject({ method: "GET", url: "/o-nas/", headers: { [HLAVICKA_OTISKU]: "aaaaaaaaaaaaaaaa" } });
    expect(shoda.statusCode).toBe(200);
    const neshoda = await app.inject({ method: "GET", url: "/o-nas/", headers: { [HLAVICKA_OTISKU]: "bbbbbbbbbbbbbbbb" } });
    expect(neshoda.statusCode).toBe(412);
    expect(neshoda.headers["cache-control"]).toBe("no-store");
    expect(neshoda.body).not.toContain("o nas");
    expect((await app.inject({ method: "GET", url: "/o-nas/" })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/o-nas/", headers: { [HLAVICKA_OTISKU]: "neni-otisk" } })).statusCode,
    ).toBe(200);
    // Obrázky jsou neměnné a na skořápce nezávisí.
    expect(
      (await app.inject({ method: "GET", url: "/_img/0123456789abcdef.png", headers: { [HLAVICKA_OTISKU]: "bbbbbbbbbbbbbbbb" } }))
        .statusCode,
    ).toBe(200);
  });

  it("výdejní trasy nepodléhají globálnímu limitu (veřejní návštěvníci nesmí dostat 429)", async () => {
    const app = Fastify();
    await app.register(rateLimit, { max: 2, timeWindow: 60_000 });
    app.get("/limitovana", async () => "ok");
    zaregistrujServirovani(app, { koren: vystup(), otiskVystupu: () => "" });
    await app.ready();
    for (let i = 0; i < 6; i++) {
      expect((await app.inject({ method: "GET", url: "/o-nas/" })).statusCode, `pokus ${i}`).toBe(200);
    }
    // Kontrolní vzorek: limit sám funguje — jinak by test výš nic nedokazoval.
    const kody = [];
    for (let i = 0; i < 3; i++) kody.push((await app.inject({ method: "GET", url: "/limitovana" })).statusCode);
    expect(kody).toContain(429);
  });

  it("souborProCestu nikdy nevrátí cestu mimo kořen", () => {
    const koren = "/srv/out";
    for (const url of ["/", "/a", "/a/b/", "/_img/x.png", "/../x", "/%2e%2e/x", "/a/../../x", "/_img/../../x"]) {
      const p = souborProCestu(koren, url);
      if (p !== null) expect(p.startsWith("/srv/out/"), url).toBe(true);
    }
  });
});

const SKORAPKA = '<!doctype html><html><head><link rel="stylesheet" href="/assets/a.css"></head><body><div id="root"></div><script type="module" src="/assets/index-AbC123.js"></script></body></html>';

async function appSkorapka(shellPath: string, poZapisu = vi.fn()) {
  const app = Fastify();
  zaregistrujSkorapku(app, { shellPath, shellToken: "spravny-token-skorapky", poZapisu });
  await app.ready();
  return { app, poZapisu };
}

describe("PUT /shell", () => {
  it("se správným tokenem uloží skořápku atomicky a spustí kontrolu čerstvosti", async () => {
    const shellPath = join(mkdtempSync(join(tmpdir(), "wr-shell-")), "shell", "index.html");
    const { app, poZapisu } = await appSkorapka(shellPath);
    const r = await app.inject({
      method: "PUT",
      url: "/shell",
      headers: { authorization: "Bearer spravny-token-skorapky", "content-type": "text/html" },
      payload: SKORAPKA,
    });
    expect(r.statusCode).toBe(204);
    expect(readFileSync(shellPath, "utf8")).toBe(SKORAPKA);
    expect(poZapisu).toHaveBeenCalledTimes(1);
  });

  it("souběžné PUT se nepoperou o dočasný soubor — výsledek je celá jedna ze skořápek", async () => {
    const shellPath = join(mkdtempSync(join(tmpdir(), "wr-shell-")), "index.html");
    const { app } = await appSkorapka(shellPath);
    const varianty = [0, 1, 2, 3, 4, 5].map((i) => SKORAPKA.replace("</body>", `<i>${String(i).repeat(20_000)}</i></body>`));
    const odpovedi = await Promise.all(
      varianty.map((payload) =>
        app.inject({
          method: "PUT",
          url: "/shell",
          headers: { authorization: "Bearer spravny-token-skorapky", "content-type": "text/html" },
          payload,
        }),
      ),
    );
    expect(odpovedi.map((r) => r.statusCode)).toEqual([204, 204, 204, 204, 204, 204]);
    expect(varianty).toContain(readFileSync(shellPath, "utf8"));
  });

  it("bez tokenu nebo se špatným tokenem → 401 a nic se nezapíše", async () => {
    const shellPath = join(mkdtempSync(join(tmpdir(), "wr-shell-")), "index.html");
    const { app, poZapisu } = await appSkorapka(shellPath);
    for (const authorization of [undefined, "Bearer spatny", "Bearer ", "spravny-token-skorapkyX"]) {
      const r = await app.inject({
        method: "PUT",
        url: "/shell",
        headers: { ...(authorization ? { authorization } : {}), "content-type": "text/html" },
        payload: SKORAPKA,
      });
      expect(r.statusCode, String(authorization)).toBe(401);
    }
    expect(existsSync(shellPath)).toBe(false);
    expect(poZapisu).not.toHaveBeenCalled();
  });

  it("skořápka bez <script> se odmítne (422) — rozbitý build nesmí zplodit mrtvé stránky", async () => {
    const shellPath = join(mkdtempSync(join(tmpdir(), "wr-shell-")), "index.html");
    const { app, poZapisu } = await appSkorapka(shellPath);
    const r = await app.inject({
      method: "PUT",
      url: "/shell",
      headers: { authorization: "Bearer spravny-token-skorapky", "content-type": "text/html" },
      payload: "<html><body>nic</body></html>",
    });
    expect(r.statusCode).toBe(422);
    expect(existsSync(shellPath)).toBe(false);
    expect(poZapisu).not.toHaveBeenCalled();
  });

  it("bez doručeného tokenu se skořápka nepřijme od nikoho (503, fail-closed)", async () => {
    const shellPath = join(mkdtempSync(join(tmpdir(), "wr-shell-")), "index.html");
    const app = Fastify();
    const poZapisu = vi.fn();
    zaregistrujSkorapku(app, { shellPath, shellToken: "", poZapisu });
    await app.ready();
    for (const authorization of [undefined, "Bearer ", "Bearer cokoli"]) {
      const r = await app.inject({
        method: "PUT",
        url: "/shell",
        headers: { ...(authorization ? { authorization } : {}), "content-type": "text/html" },
        payload: SKORAPKA,
      });
      expect(r.statusCode, String(authorization)).toBe(503);
    }
    expect(existsSync(shellPath)).toBe(false);
    expect(poZapisu).not.toHaveBeenCalled();
  });

  it("tělo nad strop se odmítne (413)", async () => {
    const shellPath = join(mkdtempSync(join(tmpdir(), "wr-shell-")), "index.html");
    const { app } = await appSkorapka(shellPath);
    const r = await app.inject({
      method: "PUT",
      url: "/shell",
      headers: { authorization: "Bearer spravny-token-skorapky", "content-type": "text/html" },
      payload: SKORAPKA + "x".repeat(600 * 1024),
    });
    expect(r.statusCode).toBe(413);
    expect(existsSync(shellPath)).toBe(false);
  });
});
