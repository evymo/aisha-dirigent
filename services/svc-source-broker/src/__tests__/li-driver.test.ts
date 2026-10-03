/**
 * li-driver — unit tests for the transport + trust-boundary logic.
 *
 * The DB-calling path (ingestBundle) needs a live Postgres and is exercised by
 * the db/coldstart gate; here we lock down the security-critical PURE logic that
 * decides WHICH bundles are trusted and processed — the fail-closed guards that
 * keep tampered/corrupted artifacts out of SoT.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  sha256Hex,
  discoverBundles,
  assertBundleTrusted,
  chunkBySize,
  ingestBundle,
  ZdrojNeniAktivni,
  type LiManifest,
} from '../clients/li-driver.js';

let root: string;

/** Write a bundle dir with the given files + a manifest that hashes them. */
function writeBundle(
  base: string,
  exportId: string,
  files: Record<string, string>,
  opts: {
    verifyOk?: boolean; corruptSha?: string; omitFile?: string;
    manifestExtra?: Partial<LiManifest>;
  } = {}
): string {
  const dir = path.join(base, exportId);
  mkdirSync(dir, { recursive: true });
  const manifestFiles = [];
  for (const [name, content] of Object.entries(files)) {
    if (opts.omitFile !== name) writeFileSync(path.join(dir, name), content);
    manifestFiles.push({
      name,
      sha256:
        opts.corruptSha === name
          ? 'deadbeef'.repeat(8)
          : sha256Hex(Buffer.from(content)),
      records: content.split('\n').filter(Boolean).length,
    });
  }
  const manifest: LiManifest = {
    export_id: exportId,
    engine_version: '1.0.0',
    source_slug: 'local-ingest',
    verify: { ok: opts.verifyOk ?? true },
    files: manifestFiles,
    ...opts.manifestExtra,
  };
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'li-drop-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sha256Hex', () => {
  it('matches the local box hex digest convention', () => {
    // sha256("") well-known vector
    expect(sha256Hex(Buffer.from(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});

describe('discoverBundles', () => {
  it('finds bundles by manifest.json and sorts by export_id ascending', () => {
    writeBundle(root, '20260101T000002', { 'kb_artifact.jsonl': '{}\n' });
    writeBundle(root, '20260101T000001', { 'kb_artifact.jsonl': '{}\n' });
    const found = discoverBundles(root);
    expect(found.map((b) => b.manifest.export_id)).toEqual([
      '20260101T000001',
      '20260101T000002',
    ]);
  });

  it('also scans a nested export/ root', () => {
    writeBundle(path.join(root, 'export'), '20260101T000005', {
      'kb_artifact.jsonl': '{}\n',
    });
    const found = discoverBundles(root);
    expect(found).toHaveLength(1);
    expect(found[0].manifest.export_id).toBe('20260101T000005');
  });

  it('skips directories without a manifest and returns [] for a missing drop dir', () => {
    mkdirSync(path.join(root, 'not-a-bundle'), { recursive: true });
    expect(discoverBundles(root)).toEqual([]);
    expect(discoverBundles(path.join(root, 'does-not-exist'))).toEqual([]);
  });
});

describe('assertBundleTrusted (fail-closed)', () => {
  it('accepts a bundle whose files hash to the manifest and verify.ok=true', () => {
    writeBundle(root, 'ok1', { 'registry_artifact.jsonl': '{"a":1}\n' });
    const [bundle] = discoverBundles(root);
    expect(() => assertBundleTrusted(bundle)).not.toThrow();
  });

  it('refuses a bundle whose local verify did not pass', () => {
    writeBundle(root, 'bad-verify', { 'kb_artifact.jsonl': '{}\n' }, { verifyOk: false });
    const [bundle] = discoverBundles(root);
    expect(() => assertBundleTrusted(bundle)).toThrow(/verify\.ok is not true/);
  });

  it('refuses a bundle with a sha256 mismatch (tamper/corruption)', () => {
    writeBundle(
      root,
      'tampered',
      { 'kb_artifact.jsonl': '{"x":1}\n' },
      { corruptSha: 'kb_artifact.jsonl' }
    );
    const [bundle] = discoverBundles(root);
    expect(() => assertBundleTrusted(bundle)).toThrow(/sha256 mismatch/);
  });

  it('refuses a bundle that lists a file missing from disk', () => {
    writeBundle(
      root,
      'missing-file',
      { 'kb_artifact.jsonl': '{"x":1}\n' },
      { omitFile: 'kb_artifact.jsonl' }
    );
    const [bundle] = discoverBundles(root);
    expect(() => assertBundleTrusted(bundle)).toThrow(/file is missing/);
  });
});

/**
 * ⭐ DOSAH SELHÁNÍ — jeden pruh nesmí stát celý korpus.
 *
 * Naměřeno na produkci 2026-08-03: `entity_suggestions_artifact` nesl JEDEN
 * řádek s druhem, který CHECK v cíli neznal. Výjimka shodila celý replay, takže
 * se NEPŘEHRÁLO 44 320 dokladů — KB, chunky, vektory ani twiny, ačkoli s návrhy
 * entit nemají nic společného. Cena za jeden neznámý řetězec byl celý korpus.
 *
 * Pruhy jsou nezávislé (jiné tabulky, jiná RPC), takže musí padat nezávisle.
 * Kurzor se ale posunout NESMÍ — jinak by vadný pruh mlčky chyběl navždy.
 * Testuje se přes falešného klienta: vlastnost je v řízení toku, ne v SQL.
 */
describe('li-driver — dosah selhání jednoho pruhu', () => {
  let base: string;
  const tichyLog = {
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
    fatal: () => {}, trace: () => {}, child: () => tichyLog,
  } as unknown as Parameters<typeof ingestBundle>[2];

  /** Klient, který selže JEN na jmenovaném RPC; ostatní volání zaznamená. */
  function klientPadajiciNa(rpc: string) {
    const volano: string[] = [];
    return {
      volano,
      query: async (text: string) => {
        volano.push(text);
        if (text.includes(rpc)) throw new Error(`porušen CHECK v ${rpc}`);
        // Jazyky jako v PRODUKCI (změřeno: cs, de, en, fr, global, ru, th).
        // První verze fixtury vracela jen `cs` a KB pruh padal na 'global' —
        // vypadalo to jako vada izolace pruhů, ale byl to nereálný vstup.
        // Fixtura nesmí vyrobit vlastní tvar světa.
        if (text.includes('supported_languages')) {
          return { rows: [{ code: 'cs' }, { code: 'global' }, { code: 'en' }] };
        }
        // Kontext zdroje: RPC vrací jsonb `{ok, story_id, created}`, ne holé id.
        // Generický tvar výš by dal `result: undefined`, driver by to (správně)
        // četl jako „zdroj nemá kontext" a padal by KAŽDÝ balíček — fixtura by
        // vyrobila poruchu, která ve světě není.
        if (text.includes('ensure_source_story')) {
          return {
            rows: [{
              result: { ok: true, story_id: '00000000-0000-4000-8000-000000000001', created: false },
            }],
          };
        }
        return { rows: [{ id: '00000000-0000-4000-8000-000000000001', out: 1 }] };
      },
    } as unknown as Parameters<typeof ingestBundle>[0] & { volano: string[] };
  }

  beforeEach(() => { base = mkdtempSync(path.join(tmpdir(), 'li-pruhy-')); });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('pruh s vadným řádkem nezastaví ostatní pruhy, ale kurzor drží', async () => {
    const dir = writeBundle(base, 'pruhy-1', {
      'registry_artifact.jsonl': '{"source_sha256":"a","filename":"f.json"}\n',
      'entity_suggestions_artifact.jsonl': '{"suggestion":"novy_druh_ktery_cil_nezna"}\n',
      'kb_artifact.jsonl':
        '{"knowledge_item":{"p_story_id":"00000000-0000-4000-8000-000000000009"},'
        + '"chunks":[{"p_chunk_index":0,"p_chunk_text":"x","p_locale":"cs"}]}\n',
    });
    const [bundle] = discoverBundles(base);
    expect(bundle?.dir).toBe(dir);

    const pg = klientPadajiciNa('li_upsert_entity_suggestions');
    // Bundle jako celek SELŽE — to je správně, kurzor se nesmí posunout.
    await expect(ingestBundle(pg, bundle!, tichyLog)).rejects.toThrow(
      /entity_suggestions/
    );

    // …ALE ostatní pruhy proběhly. Tohle je ta vlastnost, kvůli které to vzniklo:
    // dřív se KB nikdy nezavolalo, protože výjimka přišla dřív.
    const vse = pg.volano.join('\n');
    expect(vse).toContain('li_upsert_source_registry');
    expect(vse).toContain('upsert_story_knowledge_item_audited');
    expect(vse).toContain('insert_knowledge_chunk');
  });

  it('chyba nese JMÉNO pruhu — z logu musí být poznat, co přesně padlo', async () => {
    writeBundle(base, 'pruhy-2', {
      'registry_artifact.jsonl': '{"source_sha256":"a","filename":"f.json"}\n',
      'findings_artifact.jsonl': '{"finding":"x"}\n',
    });
    const [bundle] = discoverBundles(base);
    const pg = klientPadajiciNa('li_upsert_findings');
    await expect(ingestBundle(pg, bundle!, tichyLog)).rejects.toThrow(/findings/);
  });

  it('bez vadného pruhu projde a NEHÁZÍ (sonda umí zezelenat)', async () => {
    writeBundle(base, 'pruhy-3', {
      'registry_artifact.jsonl': '{"source_sha256":"a","filename":"f.json"}\n',
    });
    const [bundle] = discoverBundles(base);
    const pg = klientPadajiciNa('__nic_takoveho__');
    await expect(ingestBundle(pg, bundle!, tichyLog)).resolves.toBeTruthy();
  });
});


// ⛔ NAMĚŘENO 2026-09-06: celý soubor sólo 211 ms, ale v pre-pushi na sdíleném stroji
// (load 20–70, tři souběžné sady) test „výchozí rozpočet je hluboko pod tvrdým stropem"
// vyprchal na výchozích 5 000 ms — staví velké jsonb pole, což je pod kontencí CPU
// řádově pomalejší. Push byl zamítnut kvůli cizí zátěži, ne regresi (týž vzor jako
// services/gateway/src/routes/pats.test.ts). Strop = 20 s: dno 0,2 s + rezerva.
vi.setConfig({ testTimeout: 20_000 });
describe('chunkBySize — strop jsonb pole v Postgresu', () => {
  // ⛔ 2026-08-06: replay 44 320 dokladů padl na
  //   `total size of jsonb array elements exceeds the maximum of 268435455 bytes`
  // a driver balík odmítal tik za tikem. Dávková RPC brala vstup BEZ omezení;
  // fungovalo to, dokud byl korpus malý. Tyhle testy drží, že se to nevrátí.

  const radek = (bajtu: number) => ({ x: 'y'.repeat(Math.max(0, bajtu - 10)) });

  it('malá dávka zůstane jedna — nedělí se, co dělit netřeba', () => {
    const out = chunkBySize([radek(100), radek(100)], 1000);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2);
  });

  it('⭐ velká dávka se rozdělí a NEZTRATÍ ani jeden řádek', () => {
    const rows = Array.from({ length: 50 }, () => radek(100));
    const out = chunkBySize(rows, 500);
    expect(out.length).toBeGreaterThan(1);
    expect(out.reduce((s, d) => s + d.length, 0)).toBe(rows.length);
  });

  it('žádná dávka nepřeteče rozpočet', () => {
    const rows = Array.from({ length: 200 }, (_, i) => radek(50 + (i % 40)));
    const budget = 900;
    for (const d of chunkBySize(rows, budget)) {
      expect(Buffer.byteLength(JSON.stringify(d), 'utf8')).toBeLessThanOrEqual(budget + 2);
    }
  });

  it('měří VELIKOST, ne počet — tlusté řádky dají menší dávky', () => {
    const hubene = chunkBySize(Array.from({ length: 20 }, () => radek(50)), 1000);
    const tluste = chunkBySize(Array.from({ length: 20 }, () => radek(300)), 1000);
    expect(tluste.length).toBeGreaterThan(hubene.length);
  });

  it('⭐ řádek, který se sám nevejde, je CHYBA — ne tiché přeskočení', () => {
    // Tiše ho zahodit by znamenalo neúplný registr, který se tváří jako úplný.
    expect(() => chunkBySize([radek(50), radek(5000)], 1000)).toThrow(/nevejde se|rozdělit ho nelze/);
  });

  it('prázdný vstup nedá prázdnou dávku', () => {
    expect(chunkBySize([], 1000)).toEqual([]);
  });

  it('výchozí rozpočet je hluboko pod tvrdým stropem 268 435 455 B', () => {
    const rows = Array.from({ length: 3 }, () => radek(100));
    expect(chunkBySize(rows)).toHaveLength(1);      // výchozí rozpočet se použije
    // 48 MB: kolem řádků je obálka dotazu a jsonb v paměti zabírá víc než text.
    expect(() => chunkBySize([radek(60 * 1024 * 1024)])).toThrow();
  });
});

/**
 * Kontext (story) se RESOLVUJE z identity zdroje, nerazítkuje se do balíčku.
 *
 * ⛔ NAMĚŘENO 2026-08-30: engine vezl v každém řádku `p_story_id` z `impl.json`
 * — UUID vypsané do konfigurace. V cílové DB měla ta story NULA řádků, takže se
 * o ni zastavil balíček s 3 822 doklady. Twins tutéž přestavbu přežívají, protože
 * jsou klíčované identitou; tohle je táž oprava o vrstvu výš.
 */
describe('li-driver — kontext z identity, ne z balíčku', () => {
  let base: string;
  const log = {
    level: 'silent', silent: () => {}, info: () => {}, warn: () => {}, error: () => {},
    debug: () => {}, fatal: () => {}, trace: () => {}, child: () => log,
  } as unknown as Parameters<typeof ingestBundle>[2];

  /** Klient, který zaznamená VOLÁNÍ I PARAMETRY — bez nich se tvrzení neověří. */
  function klient(story: Record<string, unknown> = { ok: true, story_id: 'S-1', created: true }) {
    const volani: { text: string; params: unknown[] }[] = [];
    return {
      volani,
      query: async (text: string, params: unknown[] = []) => {
        volani.push({ text, params });
        if (text.includes('ensure_source_story')) return { rows: [{ result: story }] };
        if (text.includes('supported_languages')) return { rows: [{ code: 'cs' }] };
        return { rows: [{ id: '00000000-0000-4000-8000-000000000001', out: 1 }] };
      },
    } as unknown as Parameters<typeof ingestBundle>[0] & {
      volani: { text: string; params: unknown[] }[];
    };
  }

  const DOKLAD = '{"source_sha256":"a","filename":"f.json"}\n';
  const KB = '{"knowledge_item":{"p_title":"t"},"chunks":[]}\n';

  beforeEach(() => { base = mkdtempSync(path.join(tmpdir(), 'li-kontext-')); });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('story se hledá podle identity zdroje z manifestu', async () => {
    const dir = writeBundle(base, 'k-1', { 'registry_artifact.jsonl': DOKLAD });
    expect(dir).toBeTruthy();
    const pg = klient();
    await ingestBundle(pg, discoverBundles(base)[0]!, log);
    const v = pg.volani.find((q) => q.text.includes('ensure_source_story'));
    expect(v, 'driver musí kontext resolvovat, ne ho brát z balíčku').toBeTruthy();
    expect(v!.params[0]).toBe('local-ingest');
  });

  it('⛔ neregistrovaný zdroj je STOP — a NEDOSEDNE ANI ŘÁDEK', async () => {
    writeBundle(base, 'k-2', { 'registry_artifact.jsonl': DOKLAD, 'kb_artifact.jsonl': KB });
    const pg = klient({ ok: false, error: 'unknown or inactive source' });
    await expect(ingestBundle(pg, discoverBundles(base)[0]!, log)).rejects.toThrow(
      /unknown or inactive source|nemá kontext/
    );
    // ⛔ ZMĚNA KONTRAKTU 2026-08-31. Dřív tenhle test tvrdil OPAK — že evidence
    // dosedne i bez kontextu, protože pruhy jsou izolované. Na produkci se
    // ukázalo, co to znamená: z NEAUTORIZOVANÉHO zdroje dosedlo 854 vazeb
    // a 615 návrhů entit. Fail-closed chránil jen `story`, `registry` a `kb`.
    //
    // Kontext je teď PODMÍNKA: bez něj se nespustí ANI JEDEN pruh.
    expect(
      pg.volani.some((q) => q.text.includes('li_upsert_')),
      'z neautorizovaného zdroje nesmí dosednout nic — ani „jen evidence"',
    ).toBe(false);
  });

  it('registru se kontext DOSAZUJE — engine ho neví', async () => {
    writeBundle(base, 'k-3', { 'registry_artifact.jsonl': DOKLAD });
    const pg = klient();
    await ingestBundle(pg, discoverBundles(base)[0]!, log);
    const v = pg.volani.find((q) => q.text.includes('li_upsert_source_registry'))!;
    expect(JSON.parse(v.params[0] as string)[0].story_id).toBe('S-1');
  });

  it('vazby se posílají — oba artefakty do jedné tabulky', async () => {
    writeBundle(base, 'k-4', {
      'entity_relation_artifact.jsonl':
        '{"record_type":"entity_relation","parameter":"spz","value":"1AB","entities_reached":3}\n',
      'relation_proposal_artifact.jsonl':
        '{"record_type":"relation_proposal","kind":"relates_to","parameter_a":"a","parameter_b":"b"}\n',
    });
    const pg = klient();
    await ingestBundle(pg, discoverBundles(base)[0]!, log);
    const v = pg.volani.find((q) => q.text.includes('li_upsert_relation_suggestions'));
    expect(v, 'bez tohohle pruhu se odvozené vztahy zahazují u dveří').toBeTruthy();
    const rows = JSON.parse(v!.params[0] as string) as Record<string, unknown>[];
    expect(rows.map((r) => r.record_type).sort()).toEqual(['entity_relation', 'relation_proposal']);
  });

  it('artefakt, který nikdo nečte, se OHLÁSÍ — ale balíček neshodí', async () => {
    writeBundle(base, 'k-5', {
      'registry_artifact.jsonl': DOKLAD,
      'cases_artifact.jsonl': '{"record_type":"business_case","case_key":"x"}\n',
    });
    const varovani: unknown[] = [];
    const hlasityLog = { ...(log as object), warn: (o: unknown) => varovani.push(o) } as
      unknown as Parameters<typeof ingestBundle>[2];
    const pg = klient();
    await expect(ingestBundle(pg, discoverBundles(base)[0]!, hlasityLog)).resolves.toBeTruthy();
    expect(
      JSON.stringify(varovani),
      'ticho by se četlo jako „všechno prošlo" — přesně tak se ztratilo 345 vztahů',
    ).toContain('cases_artifact.jsonl');
  });

  it('selhání embedderu z manifestu se OHLÁSÍ — ale balíček neshodí', async () => {
    // ⛔ riq 2026-09-16…29: 157 balíčků s embed.backend=error a nikde nic.
    writeBundle(base, 'k-6', { 'registry_artifact.jsonl': DOKLAD }, {
      manifestExtra: {
        embed: {
          backend: 'error', vectors: 0, exported: 0, degraded: true,
          error: "models.embedder.backend=sentence-transformers, ale nejde použít (No module named 'sentence_transformers')",
        },
      },
    });
    const varovani: unknown[] = [];
    const hlasityLog = { ...(log as object), warn: (o: unknown, m?: string) => varovani.push([o, m]) } as
      unknown as Parameters<typeof ingestBundle>[2];
    await expect(ingestBundle(klient(), discoverBundles(base)[0]!, hlasityLog)).resolves.toBeTruthy();
    const text = JSON.stringify(varovani);
    expect(text, 'kbEmbeddings: 0 samo nerozliší rozbitý embedder od běhu bez nových vektorů')
      .toContain('selhání embedderu');
    expect(text).toContain('sentence_transformers');
  });

  /** Fake pg s uloženým rozložením; `padniNaInsertu` = pád mezi clear a zápisem. */
  function kbKlient(ulozeno: Array<{ chunk_index: number; source_hash: string; locale: string }>,
                    padniNaInsertu = false) {
    const volani: string[] = [];
    const pg = {
      volani,
      query: async (text: string) => {
        volani.push(text);
        if (text.includes('ensure_source_story')) return { rows: [{ result: { ok: true, story_id: 'S-1', created: false } }] };
        if (text.includes('supported_languages')) return { rows: [{ code: 'global' }] };
        if (text.includes('FROM public.knowledge_chunks') && text.includes('knowledge_item_id = $1')) return { rows: ulozeno };
        if (padniNaInsertu && text.includes('insert_knowledge_chunk')) throw new Error('spojení spadlo');
        return { rows: [{ id: '00000000-0000-4000-8000-000000000001', out: 1 }] };
      },
    };
    return pg as unknown as Parameters<typeof ingestBundle>[0] & { volani: string[] };
  }
  const KB_ROZDELENY = JSON.stringify({ knowledge_item: { p_title: 't' }, chunks: [
    { p_chunk_index: 0, p_chunk_text: 'a', source_hash: 'H1' },
    { p_chunk_index: 1, p_chunk_text: 'b', source_hash: 'H2' },
  ] }) + '\n';
  const ULOZENY_CELEK = [{ chunk_index: 0, source_hash: 'H', locale: 'global' }];

  it('úsek rozdělený na dva → dokument se přeskládá atomicky, původní klíč v indexu nezůstane', async () => {
    writeBundle(base, 'k-9', { 'kb_artifact.jsonl': KB_ROZDELENY });
    const pg = kbKlient(ULOZENY_CELEK);
    const c = await ingestBundle(pg, discoverBundles(base)[0]!, log);
    const v = pg.volani;
    const iBegin = v.indexOf('BEGIN');
    const iClear = v.findIndex((t) => t.includes('clear_knowledge_item_chunks'));
    const iInsert = v.findIndex((t) => t.includes('insert_knowledge_chunk'));
    const iCommit = v.indexOf('COMMIT');
    expect(iClear, 'starý celý úsek (H) i jeho vektor musí z indexu pryč').toBeGreaterThan(-1);
    expect([iBegin < iClear, iClear < iInsert, iInsert < iCommit]).toEqual([true, true, true]);
    expect(c.kbItemsRelaid).toBe(1);
  });

  it('pád mezi clear a zápisem → ROLLBACK; další běh dokument dotáhne celý', async () => {
    writeBundle(base, 'k-11', { 'kb_artifact.jsonl': KB_ROZDELENY });
    const spadly = kbKlient(ULOZENY_CELEK, true);
    await expect(ingestBundle(spadly, discoverBundles(base)[0]!, log)).rejects.toThrow();
    expect(spadly.volani, 'smazání se nesmí potvrdit bez zápisu').toContain('ROLLBACK');
    expect(spadly.volani).not.toContain('COMMIT');
    // ROLLBACK vrátil původní rozložení → opakovaný běh (kurzor držen) přeskládá znovu
    const znovu = kbKlient(ULOZENY_CELEK);
    const c = await ingestBundle(znovu, discoverBundles(base)[0]!, log);
    expect(znovu.volani.filter((t) => t.includes('insert_knowledge_chunk'))).toHaveLength(2);
    expect(znovu.volani).toContain('COMMIT');
    expect(c.kbItemsRelaid).toBe(1);
  });

  it('beze změny rozložení se nic nemaže ani neobaluje transakcí (ani nový dokument)', async () => {
    const KB1 = JSON.stringify({ knowledge_item: { p_title: 't' }, chunks: [
      { p_chunk_index: 0, p_chunk_text: 'a', source_hash: 'H' },
    ] }) + '\n';
    writeBundle(base, 'k-10', { 'kb_artifact.jsonl': KB1 });
    for (const ulozeno of [ULOZENY_CELEK, []]) {
      const pg = kbKlient(ulozeno);
      const c = await ingestBundle(pg, discoverBundles(base)[0]!, log);
      expect(pg.volani.some((t) => t.includes('clear_knowledge_item_chunks'))).toBe(false);
      expect(pg.volani).not.toContain('BEGIN');
      expect(c.kbItemsRelaid).toBe(0);
    }
  });

  it('pokrytí vektory měří PLATFORMA (živý model, po třídách); selhání měření balíček neshodí', async () => {
    writeBundle(base, 'k-12', { 'kb_artifact.jsonl': KB_ROZDELENY });
    const zakladni = kbKlient([]);
    const pg = {
      volani: zakladni.volani,
      query: async (text: string, params?: unknown[]) => {
        if (text.includes('fn_resolve_embedding_model_for_space')) {
          zakladni.volani.push(text);
          return { rows: [
            { model: 'bge-m3-embedding', pin: 'ab', trida: 'contract', useku: 10, zivy: 1,
              stary_runtime: 2, jiny_model: 3, nad_limitem: 1, bez_vektoru: 3 },
            { model: 'bge-m3-embedding', pin: 'ab', trida: 'invoice', useku: 5, zivy: 5,
              stary_runtime: 0, jiny_model: 0, nad_limitem: 0, bez_vektoru: 0 },
          ] };
        }
        return (zakladni as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown> }).query(text, params);
      },
    } as unknown as Parameters<typeof ingestBundle>[0];
    const c = await ingestBundle(pg, discoverBundles(base)[0]!, log);
    expect(c.pokryti).toEqual({
      model: 'bge-m3-embedding', identita: 'gguf:ab', export_id: 'k-12',
      useku: 15, zivy: 6, stary_runtime: 2, jiny_model: 3, nad_limitem: 1, bez_vektoru: 3,
      tridy: {
        contract: { useku: 10, zivy: 1, stary_runtime: 2, jiny_model: 3, nad_limitem: 1, bez_vektoru: 3 },
        invoice: { useku: 5, zivy: 5, stary_runtime: 0, jiny_model: 0, nad_limitem: 0, bez_vektoru: 0 },
      },
    });
    // měření spadne → null, balíček projde
    const spadle = {
      query: async (text: string, params?: unknown[]) => {
        if (text.includes('fn_resolve_embedding_model_for_space')) throw new Error('timeout');
        return (kbKlient([]) as unknown as { query: (t: string, p?: unknown[]) => Promise<unknown> }).query(text, params);
      },
    } as unknown as Parameters<typeof ingestBundle>[0];
    const c2 = await ingestBundle(spadle, discoverBundles(base)[0]!, log);
    expect(c2.pokryti).toBeNull();
  });

  it('zdravý embed ani starší engine bez stavu nevarují', async () => {
    writeBundle(base, 'k-7', { 'registry_artifact.jsonl': DOKLAD }, {
      manifestExtra: { embed: { backend: 'sentence-transformers', vectors: 3, degraded: false } },
    });
    writeBundle(base, 'k-8', { 'registry_artifact.jsonl': DOKLAD });
    const varovani: unknown[] = [];
    const hlasityLog = { ...(log as object), warn: (o: unknown, m?: string) => varovani.push([o, m]) } as
      unknown as Parameters<typeof ingestBundle>[2];
    for (const b of discoverBundles(base)) await ingestBundle(klient(), b, hlasityLog);
    expect(JSON.stringify(varovani)).not.toContain('selhání embedderu');
  });
});

/**
 * Trvalá vs. přechodná porucha — na tom stojí, jestli fronta jede dál.
 *
 * ⛔ NAMĚŘENO 2026-08-30 na produkci: jeden balíček, jehož zdroj nebyl aktivní,
 * zablokoval zbylých pět. Driver ho půl hodiny zkoušel dokola a držel kurzor —
 * správně pro spadlou databázi, ale tenhle stav se BEZ ROZHODNUTÍ ČLOVĚKA
 * nespraví. Fronta tak stála na něčem, co sama vyřešit nemůže.
 */
describe('li-driver — trvalá porucha se pozná od přechodné', () => {
  let base: string;
  const log = {
    level: 'silent', silent: () => {}, info: () => {}, warn: () => {}, error: () => {},
    debug: () => {}, fatal: () => {}, trace: () => {}, child: () => log,
  } as unknown as Parameters<typeof ingestBundle>[2];

  const klient = (story: Record<string, unknown>) => ({
    query: async (text: string) => {
      if (text.includes('ensure_source_story')) return { rows: [{ result: story }] };
      if (text.includes('supported_languages')) return { rows: [{ code: 'cs' }] };
      return { rows: [{ id: '00000000-0000-4000-8000-000000000001', out: 1 }] };
    },
  }) as unknown as Parameters<typeof ingestBundle>[0];

  beforeEach(() => { base = mkdtempSync(path.join(tmpdir(), 'li-karant-')); });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const bundle = (id: string) => {
    writeBundle(base, id, { 'registry_artifact.jsonl': '{"source_sha256":"a","filename":"f.json"}\n' });
    return discoverBundles(base)[0]!;
  };

  it('⭐ neaktivní zdroj = TRVALÁ příčina — pozná se TYPEM', async () => {
    // Kontext je podmínka, takže chyba letí ven BEZ obalu — smyčka ji pozná
    // podle typu. (Zabalenou variantu s `trvalaPricina` drží druhá větev
    // v `ingestOnce`, kdyby ji v budoucnu vyhodil některý pruh.)
    const pg = klient({ ok: false, error: 'unknown or inactive source' });
    await expect(ingestBundle(pg, bundle('k-1'), log)).rejects.toBeInstanceOf(ZdrojNeniAktivni);
  });

  it('chyba nese i JMÉNO zdroje — bez něj operátor neví, co aktivovat', async () => {
    const pg = klient({ ok: false, error: 'unknown or inactive source' });
    await ingestBundle(pg, bundle('k-2'), log).catch((e: { sourceSlug?: string }) => {
      expect(e.sourceSlug).toBe('local-ingest');
    });
  });

  it('⛔ JINÁ porucha se za trvalou NEVYDÁVÁ — kurzor na ní musí držet', async () => {
    // Spadlá databáze pomine sama. Kdyby se označila za trvalou, balíček by
    // šel do karantény a vznikla by mezera tam, kde stačilo počkat.
    const pg = klient({ ok: false, error: 'admin, staff or service role required' });
    await ingestBundle(pg, bundle('k-3'), log).catch((e: { trvalaPricina?: boolean }) => {
      expect(e.trvalaPricina).toBeUndefined();
    });
  });

  it('⭐ rozlišuje se TYPEM, ne textem hlášky', () => {
    const e = new ZdrojNeniAktivni('nejaky-zdroj', 'libovolná hláška');
    expect(e).toBeInstanceOf(Error);
    expect(e.sourceSlug).toBe('nejaky-zdroj');
    expect(e.name).toBe('ZdrojNeniAktivni');
  });
});
