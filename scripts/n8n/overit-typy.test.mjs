import { describe, expect, test } from "vitest";
import { createServer } from "node:http";
import { chybejiciTypy, nactiSeznamTypu, odkazovaneTypy } from "./overit-typy.mjs";

const WORKFLOWS = [
  {
    nazev: "WF_A",
    data: {
      nodes: [
        { type: "n8n-nodes-base.cron" },
        { type: "n8n-nodes-aisha.aishaRpc", credentials: { aishaPostgrestApi: { name: "AISHA PostgREST" } } },
      ],
    },
  },
  {
    nazev: "WF_B",
    data: {
      nodes: [
        { type: "n8n-nodes-base.httpRequest", credentials: { httpHeaderAuth: { name: "AISHA Webhook Auth" } } },
        { type: "n8n-nodes-aisha.aishaRpc", credentials: { aishaPostgrestApi: { name: "AISHA PostgREST" } } },
      ],
    },
  },
];

describe("overit-typy: co z odkazovaného běžící n8n nezná", () => {
  test("n8n bez balíčku aisha → chybí uzel i pověření, se jmény workflowů", () => {
    const chybi = chybejiciTypy({
      odkazovane: odkazovaneTypy(WORKFLOWS),
      znameUzly: [{ name: "n8n-nodes-base.cron" }, { name: "n8n-nodes-base.httpRequest" }],
      znamaPovereni: [{ name: "httpHeaderAuth" }],
    });
    expect(chybi.uzly).toEqual([{ typ: "n8n-nodes-aisha.aishaRpc", workflowy: ["WF_A", "WF_B"] }]);
    expect(chybi.povereni).toEqual([{ typ: "aishaPostgrestApi", workflowy: ["WF_A", "WF_B"] }]);
  });

  test("uzel načtený pod předponou CUSTOM. se NEpočítá jako známý", () => {
    const chybi = chybejiciTypy({
      odkazovane: odkazovaneTypy(WORKFLOWS),
      znameUzly: [{ name: "n8n-nodes-base.cron" }, { name: "n8n-nodes-base.httpRequest" }, { name: "CUSTOM.aishaRpc" }],
      znamaPovereni: [{ name: "httpHeaderAuth" }, { name: "aishaPostgrestApi" }],
    });
    expect(chybi.uzly.map((u) => u.typ)).toEqual(["n8n-nodes-aisha.aishaRpc"]);
    expect(chybi.povereni).toEqual([]);
  });

  test("n8n zná vše → nic nechybí", () => {
    const chybi = chybejiciTypy({
      odkazovane: odkazovaneTypy(WORKFLOWS),
      znameUzly: [{ name: "n8n-nodes-base.cron" }, { name: "n8n-nodes-base.httpRequest" }, { name: "n8n-nodes-aisha.aishaRpc" }],
      znamaPovereni: [{ name: "httpHeaderAuth" }, { name: "aishaPostgrestApi" }],
    });
    expect(chybi).toEqual({ uzly: [], povereni: [] });
  });
});

describe("overit-typy: seznam typů z n8n, který se po startu teprve generuje", () => {
  async function server(odpovedi) {
    let i = 0;
    const s = createServer((req, res) => {
      const o = odpovedi[Math.min(i++, odpovedi.length - 1)];
      res.writeHead(o.status, { "content-type": o.json ? "application/json" : "text/html" });
      res.end(o.telo);
    });
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    return { url: `http://127.0.0.1:${s.address().port}/types/nodes.json`, zavri: () => s.close(), pocet: () => i };
  }

  test("404 hned po startu (naměřeno v guru) → počká a vrátí seznam, až je hotový", async () => {
    const s = await server([
      { status: 404, telo: "<html>Cannot GET /types/nodes.json</html>" },
      { status: 404, telo: "<html>Cannot GET /types/nodes.json</html>" },
      { status: 200, telo: JSON.stringify([{ name: "n8n-nodes-base.cron" }]), json: true },
    ]);
    try {
      const data = await nactiSeznamTypu(s.url, { pokusu: 5, pauzaMs: 5 });
      expect(data).toEqual([{ name: "n8n-nodes-base.cron" }]);
      expect(s.pocet()).toBe(3);
    } finally {
      s.zavri();
    }
  });

  test("seznam nedorazí do limitu → selhání měření s počtem pokusů, ne prázdný seznam", async () => {
    const s = await server([{ status: 404, telo: "<html>nic</html>" }]);
    try {
      await expect(nactiSeznamTypu(s.url, { pokusu: 3, pauzaMs: 5 })).rejects.toThrow(/po 3 pokusech stále bez seznamu typů.*HTTP 404/);
    } finally {
      s.zavri();
    }
  });
});

