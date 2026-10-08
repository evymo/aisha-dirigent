/**
 * Příjem SPA skořápky od webu — `PUT /shell` (varianta d-ii).
 *
 * ⛔ PROČ TLAČÍ WEB, A NE SDÍLENÝ DISK ANI STAŽENÍ (rozhodnutí 2026-10-02):
 * web a web-render jsou dvě Coolify aplikace a disk sdílet neumějí (rozbor 2026-09-28).
 * Stažení přes veřejnou adresu by po zamčení dveří na Edge neprošlo (revize RIQi).
 * Kontejner `web` proto při startu POŠLE svou index.html sem meshem (vlastní routa
 * webu do rozsahu peerů), bez dveří, bez gateway a bez jména na sdílené síti. Skořápka je tak vždy z právě běžícího
 * buildu webu — jména hashovaných chunků sedí.
 *
 * ⛔ VLASTNÍ TAJEMSTVÍ jen pro tuhle dvojici (WEB_RENDER_SHELL_TOKEN), ne sdílený
 * service token: jeho držitel smí jen vyměnit skořápku. Porovnání konstantním časem
 * dělá sdílený primitiv (`verifyServiceRole`), důvod odmítnutí se neprozrazuje.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { FastifyInstance } from "fastify";

import { requireService } from "./auth.js";
import { rozeberSkorapku } from "./render.js";

/** Strop těla: skořápka je jedna index.html (dnes ~2 kB); víc je chyba nebo útok. */
export const STROP_SKORAPKY = 512 * 1024;

export interface SkorapkaVolby {
  shellPath: string;
  shellToken: string;
  /** Zavolá se po úspěšném zápisu (spustí kontrolu čerstvosti). */
  poZapisu: () => void;
}

export function zaregistrujSkorapku(app: FastifyInstance, volby: SkorapkaVolby): void {
  app.addContentTypeParser(
    "text/html",
    { parseAs: "string", bodyLimit: STROP_SKORAPKY },
    (_req, telo, hotovo) => hotovo(null, telo),
  );
  if (!volby.shellToken) {
    // Fail-closed: bez doručeného tajemství se skořápka NEPŘIJÍMÁ od nikoho.
    // 503 (ne 401), aby obsluha z logu webu poznala „nedoručeno“ od „špatný token“.
    app.put("/shell", async (_request, reply) =>
      reply.code(503).send({ ok: false, duvod: "WEB_RENDER_SHELL_TOKEN nedoručen — dorovnej instanci (cold-start --skip-create)" }),
    );
    return;
  }
  app.put("/shell", { preHandler: requireService(volby.shellToken) }, async (request, reply) => {
    const html = typeof request.body === "string" ? request.body : "";
    // Radši žádná skořápka než rozbitá: bez <script> by z ní vznikly mrtvé stránky.
    if (rozeberSkorapku(html).skripty.length === 0) {
      return reply.code(422).send({ ok: false, duvod: "skořápka nemá žádné <script>" });
    }
    // Atomicky: poloviční soubor by přečetla dobíhající kontrola čerstvosti.
    // Cesta je fakt o nasazení (WEB_RENDER_SHELL), ne vstup.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await mkdir(dirname(volby.shellPath), { recursive: true });
    // Jedinečné jméno: dva souběžné PUT by se jinak zapisovaly do TÉHOŽ
    // dočasného souboru a rename by mohl vydat jejich slepeninu (revize RIQi).
    const docasny = `${volby.shellPath}.${randomUUID()}.tmp`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(docasny, html, "utf8");
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await rename(docasny, volby.shellPath);
    volby.poZapisu();
    return reply.code(204).send();
  });
}
