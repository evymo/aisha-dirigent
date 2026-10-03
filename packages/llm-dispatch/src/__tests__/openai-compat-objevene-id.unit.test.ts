/**
 * Id, které backend SÁM vypsal ve svém listingu, se posílá beze změny.
 *
 * ⛔ NAMĚŘENO 2026-09-13: prepareRequest odřízl prefix backendu (`local-`, `vllm-`)
 * i u id, pod kterým svc-model model OPRAVDU obsluhuje (alias deklarovaný instancí,
 * který discovery zapisuje do registru). Server dostal jméno, které nezná; hledání
 * aliasu nenašlo nic (objevená id prefix nesou) a „single model fallback" se
 * neuplatnil, protože svc-model má chat i embedding lane.
 *
 * Odříznutí zůstává pro ručně psané zkratky — tahle sada drží obě strany.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { OpenAICompatBackend } from "../providers/openai-compat.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const lokalni = () =>
  new OpenAICompatBackend({
    id: "vllm",
    label: "test",
    baseUrl: "http://127.0.0.1:8000/v1",
    kind: "local",
    supportsTools: false,
    modelPrefixes: ["vllm-", "local-"],
  });

/** fetch, který odpoví listingem na /models a zapamatuje si tělo /chat/completions. */
function server(listing: string[]) {
  const odeslane: Array<Record<string, unknown>> = [];
  const listingy = { pocet: 0 };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/models")) {
      listingy.pocet++;
      return json({ data: listing.map((id) => ({ id })) });
    }
    odeslane.push(JSON.parse(String(init?.body ?? "{}")));
    return json({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { odeslane, listingy };
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenAICompatBackend — objevené id se neořezává", () => {
  test("⛔ id z listingu s prefixem backendu odejde PŘESNĚ tak, jak ho server vypsal", async () => {
    const { odeslane } = server(["local-lens-instruct", "local-lens-embedding", "local-lens2-embedding"]);
    const b = lokalni();
    await b.healthCheck();
    await b.chat({ model: "local-lens-instruct", messages: [{ role: "user", content: "x" }] });
    expect(odeslane[0].model).toBe("local-lens-instruct");
  });

  test("negativní sonda: ručně psaná zkratka mimo listing se dál ořízne a dohledá", async () => {
    const { odeslane } = server(["mlx-community/Qwen2.5-Coder-7B-Instruct-4bit", "druhy-model"]);
    const b = lokalni();
    await b.healthCheck();
    await b.chat({ model: "local-mlx", messages: [{ role: "user", content: "x" }] });
    expect(odeslane[0].model).toBe("mlx-community/Qwen2.5-Coder-7B-Instruct-4bit");
  });

  // ⛔ Revize 2026-09-15: bez předchozí discovery (studený proces) se deklarované id
  // ořezávalo — rozhodnutí stálo na listingu, který ještě nikdo nepřečetl.
  test("⛔ studený proces: listing se přečte PŘED rozhodnutím a deklarované id odejde beze změny", async () => {
    const { odeslane, listingy } = server(["local-lens-instruct", "local-lens-embedding"]);
    const b = lokalni();
    await b.chat({ model: "local-lens-instruct", messages: [{ role: "user", content: "x" }] });
    expect(listingy.pocet).toBe(1);
    expect(odeslane[0].model).toBe("local-lens-instruct");
    await b.chat({ model: "local-lens-instruct", messages: [{ role: "user", content: "y" }] });
    expect(listingy.pocet, "známý listing se nečte znovu").toBe(1);
  });

  test("studený proces, stream: táž cesta jako chat", async () => {
    const odeslane: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/models")) return json({ data: [{ id: "local-lens-instruct" }] });
        odeslane.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
      }),
    );
    const b = lokalni();
    for await (const _ of b.chatStream({ model: "local-lens-instruct", messages: [{ role: "user", content: "x" }] })) {
      // spotřebovat stream
    }
    expect(odeslane[0].model).toBe("local-lens-instruct");
  });

  test("server s prázdným listingem jméno nepotvrdí: prefix se ořízne jako dřív", async () => {
    const { odeslane } = server([]);
    const b = lokalni();
    await b.chat({ model: "local-lens-instruct", messages: [{ role: "user", content: "x" }] });
    expect(odeslane[0].model).toBe("lens-instruct");
  });

  test("id bez prefixu backendu listing nečte — rozhodovat není o čem", async () => {
    const { odeslane, listingy } = server(["lens"]);
    const b = lokalni();
    await b.chat({ model: "lens", messages: [{ role: "user", content: "x" }] });
    expect(listingy.pocet).toBe(0);
    expect(odeslane[0].model).toBe("lens");
  });
});
