/**
 * Spojení VB → engine (vLLM) na interní síti jádra: sondy připravenosti a přeposlání.
 *
 * Identita vah (EM2) se nebere z deklarace ani z odpovědi enginu, ale ze souboru
 * `aisha-identita.json`, který při stažení ZMĚŘIL one-shot `accel-vahy` (sha256 vah,
 * formát, revize) do neměnného adresáře pojmenovaného podle revize. VB ho čte ze
 * svazku vah (jen pro čtení) v adresáři, který engine sám hlásí jako `root` modelu.
 * Engine, který servíruje jiný adresář, nebo adresář bez změřené identity = ROZPOR.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Agent, request } from 'undici';
import type { Upstream } from './vstup.js';
import type { Sondy } from './pripravenost.js';
import type { MotorAdapteru } from './adaptery.js';
import type { Engine } from './tabulka.js';

const LIMIT_SPOJENI_MS = 1000;

/**
 * Mez navázání spojení patří DISPEČEROVI, ne požadavku: undici 7 volbu `connectTimeout`
 * v nastavení požadavku tiše ignoruje (výchozí mez je 10 s). Sondu zdraví navíc kryje
 * celková mez signálem — spojení, odpověď i tělo dohromady nejvýš 1 s.
 */
const dispecer = () => new Agent({ connect: { timeout: LIMIT_SPOJENI_MS } });

/** Interní klíč operátora mezi VB a enginem (obrana do hloubky); nájemci ho nikdy nedostanou. */
function hlavicky(klicJadra: string | undefined): Record<string, string> {
  return { 'content-type': 'application/json', ...(klicJadra ? { authorization: `Bearer ${klicJadra}` } : {}) };
}

/**
 * Motor adaptérů enginu (adaptery.ts): servírované adaptéry z /v1/models (`root` = adresář, odkud je
 * engine načetl), načtení a uvolnění za běhu. Endpointy enginu jsou jen na síti jádra a chrání je klíč
 * jádra; volá je jen VB. Neúspěch = výjimka (dorovnání adaptér nepovažuje za načtený).
 */
export function vytvorMotorAdapteru(klicJadra?: string): MotorAdapteru {
  const dispatcher = dispecer();
  const post = async (e: Engine, cesta: string, telo: unknown) => {
    const r = await request(`${e.url}${cesta}`, { method: 'POST', headers: hlavicky(klicJadra), body: JSON.stringify(telo), dispatcher, headersTimeout: 120_000, bodyTimeout: 120_000 });
    const text = await r.body.text();
    if (r.statusCode !== 200) throw new Error(`${cesta} HTTP ${r.statusCode}: ${text.slice(0, 120)}`);
  };
  return {
    async servirovane(e) {
      const m = await request(`${e.url}/v1/models`, { method: 'GET', dispatcher, headers: hlavicky(klicJadra), headersTimeout: 10_000 });
      const modely = (await m.body.json()) as { data?: Array<{ id?: string; root?: string }> };
      return new Map((modely.data ?? []).filter((x) => typeof x.id === 'string' && x.id !== e.model).map((x) => [x.id as string, String(x.root ?? '')]));
    },
    nacti: (e, jmeno, adresar) => post(e, '/v1/load_lora_adapter', { lora_name: jmeno, lora_path: adresar }),
    uvolni: (e, jmeno) => post(e, '/v1/unload_lora_adapter', { lora_name: jmeno }),
  };
}

export function vytvorUpstream(klicJadra?: string): Upstream {
  const dispatcher = dispecer();
  return {
    async proud(e: Engine, cesta, telo, signal) {
      // Proud (SSE) chatu: tělo se nečte celé, vrací se jako proud bajtů. Mez mezi kusy drží
      // bodyTimeout (engine, který přestane posílat, se po 120 s přeruší); celkovou délku drží kvóta.
      const r = await request(`${e.url}${cesta}`, { method: 'POST', body: JSON.stringify(telo), headers: hlavicky(klicJadra), signal, dispatcher, headersTimeout: 120_000, bodyTimeout: 120_000 });
      return { status: r.statusCode, proud: r.body };
    },
    async post(e: Engine, cesta, telo, signal) {
      const r = await request(`${e.url}${cesta}`, {
        method: 'POST',
        body: JSON.stringify(telo),
        headers: hlavicky(klicJadra),
        signal,
        dispatcher,
        headersTimeout: 120_000,
        bodyTimeout: 120_000,
      });
      return { status: r.statusCode, telo: await r.body.json().catch(() => null) };
    },
  };
}

/** Slovo zahřátí — žádná data nájemců. Kolik tokenů dá, měří tokenizér enginu, ne odhad. */
const SLOVO_ZAHRATI = 'lane';

export type Tokenizuj = (text: string) => Promise<{ count: number; maxModelLen: number }>;

/**
 * Text zahřátí na nejvýš `cil` tokenů VČETNĚ speciálních (tak počítá `max_model_len` enginu),
 * odměřený tokenizérem enginu (`/tokenize`). Odhad „4 znaky na token“ u tokenizéru bge-m3
 * přestřelil (změřeno 10-05: `lane` = 2 tokeny + 2 speciální; 8194 tokenů = HTTP 400) a engine by
 * zahřátí odmítl → nikdy připraven. Deklarace delší, než engine unese, = výjimka, ne zkrácení.
 */
export async function textNaTokeny(tokenizuj: Tokenizuj, cil: number): Promise<{ text: string; tokenu: number }> {
  const jedno = await tokenizuj(SLOVO_ZAHRATI);
  const dve = await tokenizuj(`${SLOVO_ZAHRATI} ${SLOVO_ZAHRATI}`);
  if (cil > jedno.maxModelLen) throw new Error(`deklarace zahrati_tokenu ${cil} > max_model_len ${jedno.maxModelLen} enginu`);
  const naSlovo = dve.count - jedno.count;
  const rezie = jedno.count - naSlovo;
  if (naSlovo < 1 || rezie < 0) throw new Error(`tokenizér enginu dal nečitelné počty (${jedno.count}, ${dve.count})`);
  for (let n = Math.max(1, Math.floor((cil - rezie) / naSlovo)), pokus = 0; n >= 1 && pokus < 8; n--, pokus++) {
    const text = Array(n).fill(SLOVO_ZAHRATI).join(' ');
    const { count } = await tokenizuj(text);
    if (count <= cil && count > cil - naSlovo) return { text, tokenu: count };
    if (count <= cil) break;
  }
  throw new Error(`text zahřátí nejde odměřit na ${cil} tokenů (tokenizér enginu není lineární)`);
}

export function vytvorSondy(opts: { klicJadra?: string; ctiSoubor?: (cesta: string) => Promise<string> } = {}): Sondy {
  const cti = opts.ctiSoubor ?? ((c: string) => readFile(c, 'utf8'));
  const dispatcher = dispecer();
  return {
    ted: () => Date.now(),
    async zdravi(e) {
      try {
        const r = await request(`${e.url}/health`, { method: 'GET', dispatcher, signal: AbortSignal.timeout(LIMIT_SPOJENI_MS) });
        await r.body.dump();
        return r.statusCode === 200;
      } catch {
        return false;
      }
    },
    async zahrej(e) {
      // 1) Který adresář vah engine servíruje (root modelu).
      const m = await request(`${e.url}/v1/models`, { method: 'GET', dispatcher, headers: hlavicky(opts.klicJadra), headersTimeout: 10_000 });
      const modely = (await m.body.json()) as { data?: Array<{ id?: string; root?: string }> };
      // Identita z adresáře, který engine pro dané jméno SÁM hlásí (root), změřená při stažení.
      const identitaZ = async (jmeno: string) => {
        const zaznam = modely.data?.find((x) => x.id === jmeno);
        if (!zaznam?.root) throw new Error(`engine nehlásí model '${jmeno}' s adresářem vah`);
        // Jen neměnný adresář `/vahy/<repo>@<revize>` (tvar accel-vahy); jinou cestu od enginu VB nečte.
        const adresar = /^\/vahy\/[A-Za-z0-9._-]+@([0-9a-f]{40})$/.exec(zaznam.root);
        if (!adresar) throw new Error(`engine hlásí adresář vah mimo /vahy/<repo>@<revize>: ${zaznam.root}`);
        // 2) Identita změřená při stažení, z TÉHOŽ adresáře; revize v ní musí sedět se jménem adresáře.
        const id = JSON.parse(await cti(join(zaznam.root, 'aisha-identita.json'))) as { format: string; sha256: string; revize: string };
        if (id.revize !== adresar[1]) throw new Error(`identita vah (revize ${id.revize}) nepatří k adresáři ${zaznam.root}`);
        return id;
      };
      const identita = await identitaZ(e.model);
      if (e.druh === 'generate') {
        // Adaptéry tu NE: načítá, ověřuje a uvolňuje je dorovnání (adaptery.ts) až nad připraveným
        // enginem; nájemce smí alias s adaptérem volat, až když ho dorovnání ověřilo a načetlo.
        // 3) Krátká odpověď (jeden token): engine generuje. Plná délka by u generate zahřívala minuty.
        const r = await request(`${e.url}/v1/chat/completions`, {
          method: 'POST',
          headers: hlavicky(opts.klicJadra),
          body: JSON.stringify({ model: e.model, messages: [{ role: 'user', content: SLOVO_ZAHRATI }], max_tokens: 1 }),
          dispatcher,
          headersTimeout: 600_000,
          bodyTimeout: 600_000,
        });
        const telo = (await r.body.json().catch(() => null)) as { choices?: unknown[] } | null;
        if (r.statusCode !== 200 || !Array.isArray(telo?.choices) || telo!.choices!.length === 0) throw new Error(`zahřívací odpověď neprošla (HTTP ${r.statusCode})`);
        return { format: identita.format, sha256: identita.sha256, revize: identita.revize };
      }
      // 3) Zahřívací dotaz na plnou deklarovanou délku (V6), odměřenou tokenizérem enginu; musí vrátit vektor.
      const tokenizuj: Tokenizuj = async (text) => {
        const t = await request(`${e.url}/tokenize`, { method: 'POST', headers: hlavicky(opts.klicJadra), body: JSON.stringify({ model: e.model, prompt: text }), dispatcher, headersTimeout: 60_000, bodyTimeout: 60_000 });
        const o = (await t.body.json().catch(() => null)) as { count?: number; max_model_len?: number } | null;
        if (t.statusCode !== 200 || typeof o?.count !== 'number' || typeof o?.max_model_len !== 'number') throw new Error(`engine neodměří text zahřátí (/tokenize HTTP ${t.statusCode})`);
        return { count: o.count, maxModelLen: o.max_model_len };
      };
      const zahrati = await textNaTokeny(tokenizuj, e.zahrati_tokenu);
      const r = await request(`${e.url}/v1/embeddings`, {
        method: 'POST',
        headers: hlavicky(opts.klicJadra),
        body: JSON.stringify({ model: e.model, input: [zahrati.text], encoding_format: 'float' }),
        dispatcher,
        headersTimeout: 600_000,
        bodyTimeout: 600_000,
      });
      const telo = (await r.body.json().catch(() => null)) as { data?: Array<{ embedding?: number[] }>; usage?: { prompt_tokens?: number } } | null;
      if (r.statusCode !== 200 || !Array.isArray(telo?.data?.[0]?.embedding) || telo!.data![0].embedding!.length === 0) {
        throw new Error(`zahřívací dotaz neprošel (HTTP ${r.statusCode})`);
      }
      const spotrebovano = telo?.usage?.prompt_tokens;
      if (typeof spotrebovano === 'number' && spotrebovano !== zahrati.tokenu) {
        throw new Error(`zahřátí: engine zpracoval ${spotrebovano} tokenů, tokenizér hlásil ${zahrati.tokenu} — jiný tokenizér, nebo ořez`);
      }
      return { format: identita.format, sha256: identita.sha256, revize: identita.revize };
    },
  };
}
