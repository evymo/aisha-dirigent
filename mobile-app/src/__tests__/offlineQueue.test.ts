/**
 * Fronta drží práci, kterou člověk odvedl v terénu — a nesmí ji ztratit.
 *
 * Do 2026-08-08 se každé selhání počítalo stejně: `catch { retryCount++ }` bez
 * ohledu na příčinu, a po třetím se mutace NEVLOŽILA zpět do fronty. Řidič, který
 * v lomu odečetl měřidlo a pak chytil signál v místě, kde ho edge odmítal, přišel
 * o odečet i o potvrzené předání — zbyl po nich řádek v logu.
 *
 * Testy níž pojmenovávají VLASTNOST, ne zápis: „práce se nikdy neztratí" a
 * „pokus spotřebuje jen to, co je vada té mutace".
 */
import nodeCryptoLib from "node:crypto";
import { _zapomenKlic as _zapomenTrezorKlic } from "@/services/trezorStore";
import {
  classifyFailure,
  clearQueue,
  persistQueryCache,
  restoreQueryCache,
  setIdentityProvider,
  vratDrzenePredani,
  setTrezorDeps,
  enqueueMutation,
  getNeedsAttentionCount,
  getQueueSize,
  processOfflineQueue,
  RpcFailure,
} from "@/services/offline";

/**
 * Paměťový trezor — fronta se od 2026-08-19 ukládá ZAMČENÁ, takže testy měří
 * chování SKRZ šifrování, ne vedle něj. Krypto je skutečné (Node AES-256-GCM);
 * atrapa by neověřila, že se to, co se zapsalo, dá zase přečíst.
 *
 * ⭐ Že to musí být dosazené ručně, je vlastnost, ne otrava: `services/offline`
 * bez zapojeného trezoru VYHAZUJE, aby nemohl vzniknout build, ve kterém
 * šifrování mlčky neplatí a podpisy leží v plaintextu.
 */
const disk = new Map<string, string>();
const secure = new Map<string, string>();
setTrezorDeps({
  crypto: {
    randomBytes: (n) => new Uint8Array(nodeCryptoLib.randomBytes(n)),
    encrypt: (key, iv, plaintext, aad) => {
      const c = nodeCryptoLib.createCipheriv("aes-256-gcm", key, iv);
      c.setAAD(Buffer.from(aad));
      const ct = Buffer.concat([c.update(Buffer.from(plaintext)), c.final()]);
      return { ciphertext: new Uint8Array(ct), tag: new Uint8Array(c.getAuthTag()) };
    },
    decrypt: (key, iv, ciphertext, tag, aad) => {
      const d = nodeCryptoLib.createDecipheriv("aes-256-gcm", key, iv);
      d.setAAD(Buffer.from(aad));
      d.setAuthTag(Buffer.from(tag));
      return new Uint8Array(Buffer.concat([d.update(Buffer.from(ciphertext)), d.final()]));
    },
  },
  getItem: async (k) => disk.get(k) ?? null,
  removeItem: async (k) => { disk.delete(k); },
  secureGet: async (k) => secure.get(k) ?? null,
  secureSet: async (k, v) => { secure.set(k, v); },
  setItem: async (k, v) => { disk.set(k, v); },
});

/** Skutečné jméno schránky — hádat ho znamená testovat něco jiného. */
const FRONTA_KEY = "@aisha/offline_queue";

/**
 * Kdo je přihlášený. Fronta od 2026-08-19 odesílá JEN práci přihlášeného —
 * bez zapojené identity se neodešle nic (fail-closed), takže ji testy musí
 * dosadit stejně jako appka.
 */
let jaUid: string | null = "ridic-A";
setIdentityProvider(async () => jaUid);

const mockRpc = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

jest.mock("@/lib/security/safeLogger", () => ({
  safeError: jest.fn(),
  safeInfo: jest.fn(),
  safeWarn: jest.fn(),
}));

/** Odpověď serveru s daným statusem — tvar, který vrací `api.rpc`. */
const odmitnuti = (status: number, message = "ne") => ({
  data: null,
  error: { message, status },
});

/** Odpověď, která nikdy nedorazila — fetch selhal, status tedy NEEXISTUJE. */
const bezOdpovedi = () => ({ data: null, error: { message: "Network request failed" } });

async function zaradOdecet(id = "odecet-1") {
  await enqueueMutation(id, { storyId: "s-1", toStatus: "done" }, "transition_status");
}

describe("classifyFailure — proč se to nepovedlo", () => {
  it("chybějící status znamená ŽE ODPOVĚĎ NEDORAZILA, ne „neznámo“", () => {
    expect(classifyFailure(new RpcFailure("Network request failed"))).toBe("unreachable");
  });

  it("401 i 403 = server odmítl IDENTITU (stav, ve kterém má smysl zaklepat)", () => {
    expect(classifyFailure(new RpcFailure("no", 401))).toBe("denied");
    expect(classifyFailure(new RpcFailure("no", 403))).toBe("denied");
  });

  it("408 / 429 / 5xx = server má potíže, ne vada mutace", () => {
    expect(classifyFailure(new RpcFailure("t", 408))).toBe("transient");
    expect(classifyFailure(new RpcFailure("t", 429))).toBe("transient");
    expect(classifyFailure(new RpcFailure("t", 503))).toBe("transient");
  });

  it("ostatní 4xx = server rozuměl a odmítl OBSAH — jediná vada té mutace", () => {
    expect(classifyFailure(new RpcFailure("bad", 400))).toBe("rejected");
    expect(classifyFailure(new RpcFailure("bad", 422))).toBe("rejected");
  });
});

describe("fronta nikdy neztratí práci z terénu", () => {
  beforeEach(async () => {
    mockRpc.mockReset();
    await clearQueue();
  });

  it("odečet přežije PĚT odmítnutí u dveří a nespotřebuje ani jeden pokus", async () => {
    await zaradOdecet();
    mockRpc.mockResolvedValue(odmitnuti(403));

    for (let i = 0; i < 5; i++) {
      const r = await processOfflineQueue();
      expect(r.stoppedBy).toBe("denied");
      expect(r.processed).toBe(0);
      expect(r.needsAttention).toBe(0);
    }

    // Pořád ve frontě a pořád „čerstvý“ — zamčení není vada odečtu.
    expect(await getQueueSize()).toBe(1);
    expect(await getNeedsAttentionCount()).toBe(0);

    // A jakmile se odemkne, prostě odejde.
    mockRpc.mockResolvedValue({ data: null, error: null });
    const ok = await processOfflineQueue();
    expect(ok.processed).toBe(1);
    expect(await getQueueSize()).toBe(0);
  });

  it("ztráta signálu nespotřebuje pokus (server o mutaci neví)", async () => {
    await zaradOdecet();
    mockRpc.mockResolvedValue(bezOdpovedi());

    for (let i = 0; i < 4; i++) {
      expect((await processOfflineQueue()).stoppedBy).toBe("unreachable");
    }
    expect(await getQueueSize()).toBe(1);
    expect(await getNeedsAttentionCount()).toBe(0);
  });

  it("vyčerpané pokusy ZŮSTÁVAJÍ ve frontě a označí se pro člověka", async () => {
    await zaradOdecet();
    mockRpc.mockResolvedValue(odmitnuti(400, "špatná data"));

    for (let i = 0; i < 5; i++) await processOfflineQueue();

    // Tohle je jádro opravy: dřív tady bylo 0.
    expect(await getQueueSize()).toBe(1);
    expect(await getNeedsAttentionCount()).toBe(1);
  });

  it("neznámý typ mutace se nezahodí, jen si řekne o člověka", async () => {
    // `send_chat_message` nemá výchozí handler — dřív se mazal bez jediného pokusu.
    await enqueueMutation("chat-1", { text: "ahoj" }, "send_chat_message");

    await processOfflineQueue();

    expect(await getQueueSize()).toBe(1);
    expect(await getNeedsAttentionCount()).toBe(1);
  });
});

describe("běh se zastaví na okolnosti, ale ne na vadě jedné mutace", () => {
  beforeEach(async () => {
    mockRpc.mockReset();
    await clearQueue();
  });

  it("zamčení zastaví běh — druhá mutace se ani nezkusí, takže nic nespotřebuje", async () => {
    await zaradOdecet("prvni");
    await zaradOdecet("druhy");
    mockRpc.mockResolvedValue(odmitnuti(403));

    await processOfflineQueue();
    expect(mockRpc).toHaveBeenCalledTimes(1); // druhá se NEZKOUŠELA

    mockRpc.mockResolvedValue({ data: null, error: null });
    const ok = await processOfflineQueue();
    expect(ok.processed).toBe(2);
  });

  it("obchodní odmítnutí běh NEzastaví — je to vlastnost té mutace, ne okolností", async () => {
    await zaradOdecet("vadna");
    await zaradOdecet("dobra");
    mockRpc
      .mockResolvedValueOnce(odmitnuti(400))
      .mockResolvedValueOnce({ data: null, error: null });

    const r = await processOfflineQueue();

    expect(r.stoppedBy).toBeNull();
    expect(r.processed).toBe(1);
    expect(await getQueueSize()).toBe(1); // zůstala jen ta vadná
  });
});

/**
 * N5 (2026-08-19) — 403 ŘÍKAJÍ DVA RŮZNÍ MLUVČÍ.
 *
 * Vyšlo najevo při ověřování otázky majitele („operátor je schopen dodávku
 * přehodit jinému řidiči?"). `denied` je OKOLNOST: zastaví CELÝ běh fronty a
 * v `kroky.tsx` rozsvítí nabídku zaklepat na dveře. Do 2026-08-19 ho dostal
 * každý 403 — jenže 403 posílá:
 *   · DVEŘNÍK  — „jsi zamčený" (edge, holé odmítnutí bez těla), a
 *   · APLIKACE — „na TENHLE úkon nemáš nárok" (RLS / errcode 42501; osm míst
 *     v SoT, mapování 42501 → 403 doloženo v `gateway/src/routes/pats.test.ts`).
 *
 * Následek toho slití: dispečer legitimně přehodí jednu dodávku jinému řidiči →
 * řidiči A se při prvním signálu zasekla CELÁ fronta na té jedné položce a
 * appka mu nabídla break-glass zaťukání, přestože jeho identita byla v pořádku.
 *
 * ⭐ Rozlišuje se podle MLUVČÍHO, ne podle textu: dveřník si na odmítnutí dává
 * `x-aisha-door: locked`, které `api-core` překládá na `code`. Vědomě NE
 * odvozením z toho, že tělo nemá `code` — takové měřidlo by stálo na tvaru cizí
 * odpovědi, který nemáme čím doložit.
 */
describe("N5 — 403: dveřník × nárok na TENHLE úkon", () => {
  const DVERNIK = "AISHA_DOOR_LOCKED";

  /** Odmítnutí s uvedeným mluvčím — `code` je to, čím se pozná. */
  const odmitnutiOd = (status: number, code?: string, message = "ne") => ({
    data: null,
    error: { message, status, ...(code ? { code } : {}) },
  });

  beforeEach(async () => {
    mockRpc.mockReset();
    await clearQueue();
  });

  it("dveřník se označí → okolnost: běh stojí a má smysl zaťukat", () => {
    expect(classifyFailure(new RpcFailure("ne", 403, DVERNIK))).toBe("denied");
  });

  it("aplikace odpoví DŮVODEM → vada té mutace, ne okolnost", () => {
    expect(classifyFailure(new RpcFailure("not allowed to complete this step", 403, "42501"))).toBe("rejected");
  });

  it("401 je identita VŽDY — i kdyby nesla jakýkoli kód", () => {
    expect(classifyFailure(new RpcFailure("JWT expired", 401, "PGRST301"))).toBe("denied");
    expect(classifyFailure(new RpcFailure("ne", 401))).toBe("denied");
  });

  /**
   * ⚠️ Degradace pro POŘADÍ NASAZENÍ: appka může jít ven dřív než brána, která
   * značku posílá. Holé 403 se proto čte jako dosud — dveřník. Je to vědomě
   * v bezpečném směru: horší než dnešek to nebude, jen to zůstane stejné,
   * dokud jedna ze dvou stran nezačne mluvit.
   */
  it("holé 403 bez značky i bez kódu = jako dosud, dveřník", () => {
    expect(classifyFailure(new RpcFailure("ne", 403))).toBe("denied");
  });

  /**
   * ⭐ TOHLE JE TA OPRAVA. Dřív tenhle test tvrdil opak (charakterizační zápis
   * vady) — teď tvrdí, co se má dít: přehozená dodávka zůstane řidiči viset
   * k vyřešení, ale ZBYTEK JEHO PRÁCE SE ODEŠLE.
   */
  it("přehozená dodávka NEZASEKNE zbytek fronty — ostatní práce odejde", async () => {
    await enqueueMutation("prehozena", { storyId: "s-1", toStatus: "done" }, "transition_status");
    await enqueueMutation("moje-platna", { storyId: "s-2", toStatus: "done" }, "transition_status");

    // Aplikace: „tenhle krok už není tvůj" (42501 → 403 S KÓDEM). Druhá projde.
    mockRpc.mockResolvedValueOnce(odmitnutiOd(403, "42501", "milestone not completed: not allowed to complete this step"));
    mockRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });

    const r = await processOfflineQueue();

    expect(r.stoppedBy).toBeNull();            // žádná okolnost — nezastavovat
    expect(r.processed).toBe(1);               // platná práce ODEŠLA
    expect(mockRpc).toHaveBeenCalledTimes(2);  // druhá se opravdu zkusila
    expect(await getQueueSize()).toBe(1);      // přehozená zůstala k vyřešení
  });

  it("zamčené dveře běh naopak zastavit MUSÍ — druhá se ani nezkusí", async () => {
    await enqueueMutation("prvni", { storyId: "s-1", toStatus: "done" }, "transition_status");
    await enqueueMutation("druha", { storyId: "s-2", toStatus: "done" }, "transition_status");
    mockRpc.mockResolvedValue(odmitnutiOd(403, DVERNIK));

    const r = await processOfflineQueue();

    expect(r.stoppedBy).toBe("denied");
    expect(r.processed).toBe(0);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(await getQueueSize()).toBe(2);      // práce se NEZTRATÍ
  });

  it("odmítnutí nároku nespotřebuje pokusy donekonečna — skončí u člověka", async () => {
    await enqueueMutation("prehozena", { storyId: "s-1", toStatus: "done" }, "transition_status");
    mockRpc.mockResolvedValue(odmitnutiOd(403, "42501"));

    for (let i = 0; i < 3; i++) await processOfflineQueue();

    expect(await getQueueSize()).toBe(1);              // NIKDY se nemaže
    expect(await getNeedsAttentionCount()).toBe(1);    // ale ví se o ní
  });
});

/**
 * Fronta na disku je od 2026-08-19 ZAMČENÁ — a nečitelný trezor se nesmí
 * zaměnit za prázdnou frontu.
 *
 * ⛔ Do téhle změny stálo v `loadQueue` doslova `catch { return [] }`. Se
 * šifrováním je ta věta smrtelná: ztracený klíč (obnova systému, jiný profil)
 * by vypadal jako „nic nemáš", appka by to odsouhlasila a první zápis by obsah
 * PŘEPSAL — z dočasné nečitelnosti by se stala trvalá ztráta podepsaného
 * předání. Táž třída jako PR #154, potřetí a na novém místě.
 */
describe("zamčená fronta — nečitelno není prázdno", () => {
  beforeEach(async () => {
    mockRpc.mockReset();
    await clearQueue();
  });

  it("na disku neleží podpis ani jméno čitelně", async () => {
    await enqueueMutation("predani", {
      recipient: "Jana Nováková",
      signature: "data:image/png;base64,AAAA",
    }, "complete_workflow_step");

    const naDisku = [...disk.values()].join("\n");
    expect(naDisku).not.toContain("Nováková");
    expect(naDisku).not.toContain("data:image");
    expect(naDisku).toContain("v1.");
  });

  it("co se zařadilo, jde po zamčení zase přečíst", async () => {
    await enqueueMutation("a", { storyId: "s-1", toStatus: "done" }, "transition_status");
    expect(await getQueueSize()).toBe(1);
  });

  it("⛔ ztracený klíč: běh se NEKONÁ a obsah na disku ZŮSTÁVÁ", async () => {
    await enqueueMutation("podepsane-predani", { storyId: "s-1", toStatus: "done" }, "transition_status");
    const pred = disk.get(FRONTA_KEY);

    secure.clear();                 // obnova systému / přeinstalace
    _zapomenTrezorKlic();

    const r = await processOfflineQueue();

    expect(r.stoppedBy).toBe("unreadable-store");
    expect(r.processed).toBe(0);
    expect(mockRpc).not.toHaveBeenCalled();
    // ⛔ Nejdůležitější řádek: nic se nepřepsalo, ztráta NENÍ trvalá.
    expect(disk.get(FRONTA_KEY)).toBe(pred);
  });

  it("⛔ počítadlo raději vyhodí, než aby tvrdilo nulu", async () => {
    await enqueueMutation("podepsane-predani", { storyId: "s-1", toStatus: "done" }, "transition_status");
    secure.clear();
    _zapomenTrezorKlic();
    await expect(getQueueSize()).rejects.toThrow();
  });

  it("plaintext ze staršího buildu se přečte A zamkne (migrace)", async () => {
    disk.set(FRONTA_KEY, JSON.stringify([
      { id: "stara-prace", payload: { recipient: "Petr Svoboda" }, retryCount: 0, timestamp: 1, type: "transition_status" },
    ]));
    expect(await getQueueSize()).toBe(1);
    // Po přečtení už na disku leží zamčené — a jméno v něm není.
    expect(disk.get(FRONTA_KEY)).toContain("v1.");
    expect(disk.get(FRONTA_KEY)).not.toContain("Svoboda");
  });
});

/**
 * Cache pásky — týž zámek jako fronta, ale OPAČNÉ pravidlo při selhání.
 *
 * ⭐ Dvojice `persistQueryCache`/`restoreQueryCache` tu do 2026-08-19 LEŽELA
 * NEPOUŽITÁ: definovaná a nikým nevolaná. Mrtvý kód není ověřený kód — naposledy
 * to v tomhle repu dokázal `knock.ts`, který měl šest testů a první skutečný
 * import shodil archiv. Zapojuje se proto rovnou s testy.
 */
describe("cache pásky — zamčená, ale s opačným pravidlem", () => {
  beforeEach(async () => { disk.clear(); });

  it("na disku neleží odběratel ani adresa čitelně", async () => {
    await persistQueryCache({ items: [{ title: "Kamenolom Bohučovice", quote: "Opava, Těšínská 12" }] });
    const naDisku = [...disk.values()].join("\n");
    expect(naDisku).not.toContain("Bohučovice");
    expect(naDisku).not.toContain("Těšínská");
    expect(naDisku).toContain("v1.");
  });

  it("co se uložilo, jde přečíst", async () => {
    await persistQueryCache({ items: [1, 2, 3] });
    expect(await restoreQueryCache()).toEqual({ items: [1, 2, 3] });
  });

  it("prázdná cache je null, ne pád", async () => {
    expect(await restoreQueryCache()).toBeNull();
  });

  /**
   * ⛔ TADY JE TICHO SPRÁVNĚ — a je to jediné místo v tomhle souboru, kde ano.
   * Cache je odvozená kopie serveru: ztratit ji stojí jedno síťové volání.
   * Fronta je JEDINÝ výskyt práce z terénu, a proto tam totéž ticho znamená
   * ztrátu. Týž zápis, opačné pravidlo — proto se to měří zvlášť.
   */
  it("nečitelná cache se MLČKY zahodí (na rozdíl od fronty)", async () => {
    await persistQueryCache({ items: [1] });
    secure.clear();
    _zapomenTrezorKlic();
    await expect(restoreQueryCache()).resolves.toBeNull();
  });
});

/**
 * N3 — fronta ví, ČÍ práci veze.
 *
 * ⛔ Sdílený telefon směny je běžný provoz: řidič A zaznamená předání offline,
 * telefon převezme B a přihlásí se. Do 2026-08-19 mutace nenesla uid a flush
 * běžel pod tokeny toho, kdo je zrovna přihlášený — takže by se A práce
 * odeslala pod účtem B a server by zapsal `completed_by = B` k podpisu, který
 * sbíral A. Audit by tvrdil nepravdu o právním důkazu pro fakturaci.
 *
 * Rozhodnutí majitele (08-19): odhlášení frontu ZAMKNE, neblokuje se. Cizí
 * práce se tedy neodesílá, nemaže a počká na svého člověka.
 */
describe("N3 — cizí práce se neodešle ani neztratí", () => {
  beforeEach(async () => {
    mockRpc.mockReset();
    jaUid = "ridic-A";
    await clearQueue();
  });

  it("vlastní práce odejde normálně", async () => {
    await enqueueMutation("moje", { storyId: "s-1", toStatus: "done" }, "transition_status");
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });

    const r = await processOfflineQueue();
    expect(r.processed).toBe(1);
    expect(r.cizi).toBe(0);
    expect(await getQueueSize()).toBe(0);
  });

  it("⛔ po předání telefonu se práce A NEODEŠLE pod účtem B", async () => {
    await enqueueMutation("predani-od-A", { storyId: "s-1", toStatus: "done" }, "transition_status");

    jaUid = "ridic-B";                       // směna se vystřídala
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    const r = await processOfflineQueue();

    expect(mockRpc).not.toHaveBeenCalled();  // nikdo to nezkusil
    expect(r.processed).toBe(0);
    expect(r.cizi).toBe(1);
    expect(await getQueueSize()).toBe(1);    // ⛔ a NEZTRATILA se
  });

  it("a odejde, až se A vrátí — proto se nemaže", async () => {
    await enqueueMutation("predani-od-A", { storyId: "s-1", toStatus: "done" }, "transition_status");
    jaUid = "ridic-B";
    await processOfflineQueue();

    jaUid = "ridic-A";                       // A se vrátil
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    const r = await processOfflineQueue();

    expect(r.processed).toBe(1);
    expect(await getQueueSize()).toBe(0);
  });

  /**
   * ⭐ Cizí práce NENÍ okolnost: běh pokračuje, aby vlastní práce přihlášeného
   * odešla. Kdyby se na ní zastavil, stačilo by jedno cizí předání a řidič by
   * neodeslal celou směnu.
   */
  it("cizí položka NEZASTAVÍ běh — vlastní práce jede dál", async () => {
    await enqueueMutation("od-A", { storyId: "s-1", toStatus: "done" }, "transition_status");
    jaUid = "ridic-B";
    await enqueueMutation("od-B", { storyId: "s-2", toStatus: "done" }, "transition_status");
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });

    const r = await processOfflineQueue();
    expect(r.processed).toBe(1);             // B odeslal SVOJE
    expect(r.cizi).toBe(1);                  // A práce počkala
    expect(r.stoppedBy).toBeNull();          // a nic se nezastavilo
    expect(await getQueueSize()).toBe(1);
  });

  it("odhlášení (nikdo přihlášený) neodešle nic a nic neztratí", async () => {
    await enqueueMutation("moje", { storyId: "s-1", toStatus: "done" }, "transition_status");
    jaUid = null;
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });

    const r = await processOfflineQueue();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(r.cizi).toBe(1);
    expect(await getQueueSize()).toBe(1);
  });

  /**
   * Mutace z buildu PŘED touhle změnou nenese vlastníka. Přiřknout ji komukoli
   * by byla táž vada, kterou to má řešit — rozhodne o ní člověk.
   */
  it("práce bez vlastníka (starý build) se NEODEŠLE a označí se pro člověka", async () => {
    disk.set(FRONTA_KEY, JSON.stringify([
      { id: "z-minula", payload: { storyId: "s-1", toStatus: "done" }, retryCount: 0, timestamp: 1, type: "transition_status" },
    ]));
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });

    const r = await processOfflineQueue();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(r.cizi).toBe(1);
    expect(await getNeedsAttentionCount()).toBe(1);
    expect(await getQueueSize()).toBe(1);
  });
});

/**
 * Vratné okno — předloha majitele („VRATNÉ 15 MIN“).
 *
 * ⭐ ZDRŽENÍ OUTBOXU, NE MAZÁNÍ AUDITNÍHO ZÁZNAMU. Dokud práce neodešla, na
 * serveru nic nevzniklo a vrácení je prosté zahození řádku ve frontě. Kdyby se
 * odesílalo hned a vracelo kompenzací, musel by se rušit auditovaný záznam
 * o právním důkazu — a ten se ruší hůř než čeká.
 */
describe("vratné okno — držená práce ještě nemá odejít", () => {
  const ZA_15_MIN = () => Date.now() + 15 * 60 * 1000;

  beforeEach(async () => {
    mockRpc.mockReset();
    jaUid = "ridic-A";
    await clearQueue();
  });

  it("držené předání se NEODEŠLE a není to vada", async () => {
    await enqueueMutation("predani", { storyId: "s-1", toStatus: "done" }, "transition_status", { notBefore: ZA_15_MIN() });
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });

    const r = await processOfflineQueue();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(r.drzene).toBe(1);
    expect(r.processed).toBe(0);
    // ⛔ Ani cizí, ani k vyřízení — je to normální stav prvních 15 minut.
    expect(r.cizi).toBe(0);
    expect(await getNeedsAttentionCount()).toBe(0);
    expect(r.stoppedBy).toBeNull();
  });

  it("po vypršení okna odejde samo", async () => {
    await enqueueMutation("predani", { storyId: "s-1", toStatus: "done" }, "transition_status", { notBefore: Date.now() - 1 });
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });

    const r = await processOfflineQueue();
    expect(r.processed).toBe(1);
    expect(r.drzene).toBe(0);
    expect(await getQueueSize()).toBe(0);
  });

  it("držená položka NEZASTAVÍ zbytek fronty", async () => {
    await enqueueMutation("drzene", { storyId: "s-1", toStatus: "done" }, "transition_status", { notBefore: ZA_15_MIN() });
    await enqueueMutation("bezne", { storyId: "s-2", toStatus: "done" }, "transition_status");
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });

    const r = await processOfflineQueue();
    expect(r.processed).toBe(1);
    expect(r.drzene).toBe(1);
    expect(await getQueueSize()).toBe(1);
  });

  it("vrátit jde, dokud okno běží", async () => {
    await enqueueMutation("predani", { storyId: "s-1", toStatus: "done" }, "transition_status", { notBefore: ZA_15_MIN() });
    await expect(vratDrzenePredani("predani")).resolves.toBe(true);
    expect(await getQueueSize()).toBe(0);
  });

  /**
   * ⛔ Po vypršení okna už vracet NEJDE — a musí to říct nahlas. Tichý úspěch by
   * z „práce už je na serveru“ udělal „zrušeno“ a řidič by odešel s tím, že
   * předání neplatí.
   */
  it("po vypršení okna vrátit NELZE a nic se nesmaže", async () => {
    await enqueueMutation("predani", { storyId: "s-1", toStatus: "done" }, "transition_status", { notBefore: Date.now() - 1 });
    await expect(vratDrzenePredani("predani")).resolves.toBe(false);
    expect(await getQueueSize()).toBe(1);
  });

  it("běžná mutace bez okna se vrátit nedá — není co vracet", async () => {
    await enqueueMutation("odecet", { storyId: "s-1", toStatus: "done" }, "transition_status");
    await expect(vratDrzenePredani("odecet")).resolves.toBe(false);
    expect(await getQueueSize()).toBe(1);
  });

  it("neznámé id se tváří jako neúspěch, ne jako hotovo", async () => {
    await expect(vratDrzenePredani("neexistuje")).resolves.toBe(false);
  });
});

/**
 * Poloha tabletu (2026-09-18) se měří PŘI POTVRZENÍ a fronta ji nese beze změny —
 * při přehrání o hodinu později by nové měření popisovalo jiné místo.
 */
describe("poloha tabletu odejde s předáním tak, jak byla změřena", () => {
  const POLOHA = { lat: 50.08, lon: 14.42, accuracy_m: 12, captured_at: "2026-09-18T10:00:00.000Z" };
  const predani = (extra: Record<string, unknown>) => ({
    stepId: "krok-1",
    mutationId: "predani-1",
    occurredAt: "2026-09-18T10:00:05.000Z",
    recipient: "Jana",
    ...extra,
  });

  beforeEach(async () => {
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    jaUid = "ridic-A";
    await clearQueue();
  });

  it("s podpisem jde do evidence jako device_position", async () => {
    await enqueueMutation("predani-1", predani({ signature: "data:image/png;base64,AAAA", devicePosition: POLOHA }), "complete_workflow_step");
    await processOfflineQueue();
    expect(mockRpc).toHaveBeenCalledWith("submit_evidence_review_audited", expect.objectContaining({
      p_evidence: { recipient: "Jana", signature: "data:image/png;base64,AAAA", device_position: POLOHA },
    }));
  });

  it("poctivá mezera jde taky — i ta je údaj", async () => {
    await enqueueMutation("predani-1", predani({ signature: "data:image/png;base64,AAAA", devicePosition: { unavailable: "denied" } }), "complete_workflow_step");
    await processOfflineQueue();
    expect(mockRpc.mock.calls[0][1].p_evidence.device_position).toEqual({ unavailable: "denied" });
  });

  it("položka ze staršího buildu klíč NEPOŠLE (uzavřená množina by ji jinak odmítla)", async () => {
    await enqueueMutation("predani-1", predani({ signature: "data:image/png;base64,AAAA" }), "complete_workflow_step");
    await processOfflineQueue();
    expect(mockRpc.mock.calls[0][1].p_evidence).not.toHaveProperty("device_position");
  });

  it("bez podpisu jde do výstupu kroku", async () => {
    await enqueueMutation("predani-1", predani({ devicePosition: POLOHA }), "complete_workflow_step");
    await processOfflineQueue();
    expect(mockRpc).toHaveBeenCalledWith("complete_workflow_step", expect.objectContaining({
      p_output_data: { recipient: "Jana", items_ok: true, device_position: POLOHA },
    }));
  });
});
