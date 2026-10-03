/**
 * Hlas a Matrix: kdo smí do místnosti a k mapování story — na SKUTEČNÉ databázi.
 *
 * ⛔ NAMĚŘENO (audit hlasu 2026-09-29 H-5, audit vydání 2026-10-01 B2): šest RPC
 * nad voice_rooms / story_matrix_rooms se ptalo jen na přihlášení a svc-livekit
 * vydával token do cizí konzultace. Pravidla teď nesou dva predikáty:
 *   can_access_story      — story (vlastník, účastník; zápis bez role viewer; správa)
 *   can_enter_voice_room  — místnost (konzultace jen volající/volaný; story místnost
 *                           vlastník/účastník; správa BEZ obchvatu do hovoru)
 *
 * Měří se pod rolí authenticated / service_role / anon s request.jwt.claims — pod
 * superuserem by stráž neřekla nic. Kroky běží POPOŘADĚ v podtransakcích (úspěšný
 * join_ptt_channel místnost založí, takže pořadí je součást scénáře); každý zapíše
 * SQLSTATE nebo 'ok' a případně hodnotu. Celý běh končí ROLLBACK.
 *
 * Spouští se přes: node scripts/db/with-throwaway-db.mjs -- npx vitest run <tento soubor>
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const ID = {
  vlastnik: randomUUID(),
  clen: randomUUID(),
  divak: randomUUID(),
  cizi: randomUUID(),
  admin: randomUUID(),
  volajici: randomUUID(),
  volany: randomUUID(),
};
type Osoba = keyof typeof ID;
type Identita = Osoba | "service_role" | "anon";

const S = randomUUID(); // story s PTT místností a Matrix mapováním
const S2 = randomUUID(); // story BEZ PTT místnosti (zakládání kanálu)
const PTT = randomUUID();
const KONZ = randomUUID(); // konzultace bez story
const KONZ_S = randomUUID(); // konzultace navázaná na story S
const ZAVRENA = randomUUID();
const LK = { ptt: `ptt-${RUN}`, konz: `konz-${RUN}`, konzS: `konzs-${RUN}`, zavrena: `zavrena-${RUN}` };

function prepni(identita: Identita): string {
  if (identita === "service_role") {
    return `PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true); PERFORM set_config('role', 'service_role', true);`;
  }
  if (identita === "anon") {
    return `PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true); PERFORM set_config('role', 'anon', true);`;
  }
  return `PERFORM set_config('request.jwt.claims', '{"sub":"${ID[identita]}","role":"authenticated"}', true); PERFORM set_config('role', 'authenticated', true);`;
}

const kroky: string[] = [];
let poradi = 0;
/** Krok scénáře: `sql` smí naplnit v_hodnota (text). Klíč = popis pro aserci. */
function krok(klic: string, identita: Identita, sql: string): void {
  poradi += 1;
  kroky.push(`
  ${prepni(identita)}
  v_hodnota := NULL;
  BEGIN
    ${sql}
    v_stav := 'ok';
  EXCEPTION WHEN OTHERS THEN
    v_stav := SQLSTATE;
  END;
  PERFORM set_config('role', v_orig, true);
  INSERT INTO pg_temp.hlas_vysledky VALUES (${poradi}, '${klic}', v_stav, v_hodnota);`);
}

const CTENI_STORY: Osoba[] = ["vlastnik", "clen", "divak", "admin"];
const BEZ_STORY: Osoba[] = ["cizi", "volany"];

// 1–2) čtení místností story
for (const o of [...CTENI_STORY, ...BEZ_STORY]) {
  krok(`matrix_general|${o}`, o, `PERFORM * FROM public.get_story_general_matrix_room('${S}');`);
  krok(`ptt_room|${o}`, o, `SELECT livekit_room_name INTO v_hodnota FROM public.get_story_ptt_room('${S}');`);
}
// 3) mapování Matrix místnosti = zápis do story. UNIQUE (story_id, room_type): 'general'
//    už existuje, každý povolený dostane jiný druh. Zamítnutí jdou PRVNÍ s druhem, který
//    je ještě volný — bez stráže by INSERT prošel, takže 42501 je stráž, ne kolize.
const MATRIX_DRUH: Array<[Osoba, string]> = [
  ["divak", "voice"], ["cizi", "voice"], ["vlastnik", "voice"], ["clen", "bridge"], ["admin", "bot"],
];
for (const [o, druh] of MATRIX_DRUH) {
  krok(`matrix_create|${o}`, o, `PERFORM public.create_story_matrix_room(NULL, 'x', '!m-${o}-${RUN}:test', '${druh}', '${S}');`);
}
// 4) PTT: vstup do existujícího kanálu = čtení; založení kanálu = zápis (pořadí!)
for (const o of ["divak", "cizi", "vlastnik"] as Osoba[]) {
  krok(`ptt_join|${o}`, o, `v_hodnota := public.join_ptt_channel('ptt-novy-${o}-${RUN}', 'x', '${S}')->>'room_name';`);
}
krok(`ptt_zalozit|divak`, "divak", `PERFORM public.join_ptt_channel('ptt-s2-divak-${RUN}', 'x', '${S2}');`);
krok(`ptt_zalozit|cizi`, "cizi", `PERFORM public.join_ptt_channel('ptt-s2-cizi-${RUN}', 'x', '${S2}');`);
krok(`ptt_zalozit|clen`, "clen", `PERFORM public.join_ptt_channel('ptt-s2-clen-${RUN}', 'x', '${S2}');`);
// 5) seznam účastníků = kdo smí do místnosti
const UCASTNICI: Array<[string, string, Osoba[]]> = [
  ["konz", KONZ, ["volajici", "volany", "cizi", "admin", "vlastnik"]],
  ["konzS", KONZ_S, ["clen", "volany", "vlastnik", "divak", "admin"]],
  ["ptt", PTT, ["clen", "divak", "vlastnik", "cizi"]],
  ["zavrena", ZAVRENA, ["clen"]],
];
for (const [mistnost, id, osoby] of UCASTNICI) {
  for (const o of osoby) krok(`ucastnici|${mistnost}|${o}`, o, `PERFORM * FROM public.get_room_participants('${id}');`);
}
// 6) verdikt pro svc-livekit (service_role) — tytéž místnosti, totéž pravidlo
const VSTUP: Array<[string, string, Osoba[]]> = [
  ["konz", LK.konz, ["volajici", "volany", "cizi", "admin", "vlastnik"]],
  ["konzS", LK.konzS, ["clen", "volany", "vlastnik", "divak"]],
  ["ptt", LK.ptt, ["clen", "divak", "vlastnik", "cizi"]],
  ["zavrena", LK.zavrena, ["clen"]],
];
for (const [mistnost, lk, osoby] of VSTUP) {
  for (const o of osoby) {
    krok(`vstup|${mistnost}|${o}`, "service_role", `SELECT may_enter::text INTO v_hodnota FROM public.get_voice_room_entry('${lk}', '${ID[o]}');`);
  }
}
// 7) predikát a čtečka nejsou pro uživatele ani anonyma
krok(`entry_primo|cizi`, "cizi", `PERFORM * FROM public.get_voice_room_entry('${LK.konz}', '${ID.cizi}');`);
krok(`predikat_primo|volajici`, "volajici", `PERFORM public.can_enter_voice_room('${KONZ}', '${ID.volajici}');`);
krok(`entry_primo|anon`, "anon", `PERFORM * FROM public.get_voice_room_entry('${LK.konz}', '${ID.cizi}');`);
// 8) konzultace smí na story jen ten, kdo ji vidí
krok(`konz_create|cizi_se_story`, "cizi", `PERFORM public.create_consultation_call(NULL, '${ID.volany}', 'kc-cizi-${RUN}', false, 'x', '${S}');`);
krok(`konz_create|clen_se_story`, "clen", `PERFORM public.create_consultation_call(NULL, '${ID.volany}', 'kc-clen-${RUN}', false, 'x', '${S}');`);
krok(`konz_create|cizi_bez_story`, "cizi", `PERFORM public.create_consultation_call(NULL, '${ID.volany}', 'kc-cizi0-${RUN}', false, 'x', NULL);`);
// 9) call_events anonymovi nic
krok(`call_events|anon`, "anon", `PERFORM count(*) FROM public.call_events;`);

type Vysledek = { stav: string; hodnota: string | null };
let vysledky: Record<string, Vysledek> = {};

beforeAll(() => {
  if (!dbAvailable) return;
  const vystup = psqlMultiline(`
\\set ON_ERROR_STOP on
BEGIN;
INSERT INTO aisha_auth.users (id, email) VALUES
${(Object.keys(ID) as Osoba[]).map((o) => `  ('${ID[o]}', 'hlas-${o}-${RUN}@test.local')`).join(",\n")};
INSERT INTO public.user_roles (user_id, role) VALUES ('${ID.admin}', 'admin');
INSERT INTO public.partner_stories (id, title, status, origin, user_id) VALUES
  ('${S}', 'hlas runtime ${RUN}', 'inbox', 'manual', '${ID.vlastnik}'),
  ('${S2}', 'hlas runtime 2 ${RUN}', 'inbox', 'manual', '${ID.vlastnik}');
INSERT INTO public.story_participants (story_id, user_id, role) VALUES
  ('${S}', '${ID.clen}', 'member'), ('${S}', '${ID.divak}', 'viewer'),
  ('${S2}', '${ID.clen}', 'member'), ('${S2}', '${ID.divak}', 'viewer');
INSERT INTO public.story_matrix_rooms (story_id, matrix_room_id, room_type, display_name)
  VALUES ('${S}', '!obecna-${RUN}:test', 'general', 'obecná');
INSERT INTO public.voice_rooms (id, name, room_type, story_id, livekit_room_name, created_by, is_active) VALUES
  ('${PTT}', 'ptt', 'ptt', '${S}', '${LK.ptt}', '${ID.clen}', true),
  ('${KONZ}', 'konz', 'consultation', NULL, '${LK.konz}', '${ID.volajici}', true),
  ('${KONZ_S}', 'konz s', 'consultation', '${S}', '${LK.konzS}', '${ID.clen}', true),
  ('${ZAVRENA}', 'zavřená', 'ptt', '${S}', '${LK.zavrena}', '${ID.clen}', false);
INSERT INTO public.consultation_sessions (voice_room_id, caller_id, callee_id, status) VALUES
  ('${KONZ}', '${ID.volajici}', '${ID.volany}', 'active'),
  ('${KONZ_S}', '${ID.clen}', '${ID.volany}', 'active');
CREATE TEMP TABLE hlas_vysledky (poradi int, klic text, stav text, hodnota text);
GRANT ALL ON pg_temp.hlas_vysledky TO PUBLIC;
DO $$
DECLARE
  v_orig text := current_user;
  v_stav text;
  v_hodnota text;
BEGIN
${kroky.join("\n")}
END $$;
\\t on
\\a on
SELECT 'VYSLEDKY=' || json_object_agg(klic, json_build_object('stav', stav, 'hodnota', hodnota))::text FROM pg_temp.hlas_vysledky;
ROLLBACK;
`);
  const radek = vystup.split("\n").find((l) => l.startsWith("VYSLEDKY="));
  if (!radek) throw new Error(`výsledky nevznikly — výstup psql:\n${vystup}`);
  vysledky = JSON.parse(radek.slice("VYSLEDKY=".length));
}, 120_000);

const r = (klic: string) => vysledky[klic] ?? { stav: "CHYBÍ", hodnota: null };
const DENY = "42501";

describe.skipIf(!dbAvailable)("hlas a Matrix: stráž (runtime)", () => {
  it("scénář je úplný (jinak by aserce níž měřily prázdno)", () => {
    expect(Object.keys(vysledky)).toHaveLength(poradi);
  });

  it("místnosti story čte vlastník, člen, divák i správa; cizí ani volaný ne", () => {
    for (const o of CTENI_STORY) {
      expect(r(`matrix_general|${o}`).stav, `matrix ${o}`).toBe("ok");
      expect(r(`ptt_room|${o}`), `ptt ${o}`).toEqual({ stav: "ok", hodnota: LK.ptt });
    }
    for (const o of BEZ_STORY) {
      expect(r(`matrix_general|${o}`).stav, `matrix ${o}`).toBe(DENY);
      expect(r(`ptt_room|${o}`).stav, `ptt ${o}`).toBe(DENY);
    }
  });

  it("Matrix místnost ke story připojí jen ten, kdo do ní smí psát", () => {
    for (const o of ["vlastnik", "clen", "admin"]) expect(r(`matrix_create|${o}`).stav, o).toBe("ok");
    for (const o of ["divak", "cizi"]) expect(r(`matrix_create|${o}`).stav, o).toBe(DENY);
  });

  it("do existujícího PTT kanálu vstoupí divák i vlastník (do TÉHOŽ kanálu), cizí ne", () => {
    expect(r("ptt_join|divak")).toEqual({ stav: "ok", hodnota: LK.ptt });
    expect(r("ptt_join|vlastnik")).toEqual({ stav: "ok", hodnota: LK.ptt });
    expect(r("ptt_join|cizi").stav).toBe(DENY);
  });

  it("PTT kanál ZALOŽÍ jen člen se zápisem; divák a cizí ne", () => {
    expect(r("ptt_zalozit|divak").stav).toBe(DENY);
    expect(r("ptt_zalozit|cizi").stav).toBe(DENY);
    expect(r("ptt_zalozit|clen").stav).toBe("ok");
  });

  it("účastníky konzultace vidí jen volající a volaný — ani správa, ani vlastník story", () => {
    expect(r("ucastnici|konz|volajici").stav).toBe("ok");
    expect(r("ucastnici|konz|volany").stav).toBe("ok");
    for (const o of ["cizi", "admin", "vlastnik"]) expect(r(`ucastnici|konz|${o}`).stav, o).toBe(DENY);
  });

  it("konzultace navázaná na story nepouští ostatní členy story", () => {
    expect(r("ucastnici|konzS|clen").stav).toBe("ok");
    expect(r("ucastnici|konzS|volany").stav).toBe("ok");
    for (const o of ["vlastnik", "divak", "admin"]) expect(r(`ucastnici|konzS|${o}`).stav, o).toBe(DENY);
  });

  it("účastníky PTT místnosti story vidí její lidé, cizí ne; zavřená místnost nikomu", () => {
    for (const o of ["clen", "divak", "vlastnik"]) expect(r(`ucastnici|ptt|${o}`).stav, o).toBe("ok");
    expect(r("ucastnici|ptt|cizi").stav).toBe(DENY);
    expect(r("ucastnici|zavrena|clen").stav).toBe(DENY);
  });

  it("verdikt pro svc-livekit říká totéž co RPC (jeden predikát)", () => {
    const ocekavano: Record<string, boolean> = {
      "konz|volajici": true, "konz|volany": true, "konz|cizi": false, "konz|admin": false, "konz|vlastnik": false,
      "konzS|clen": true, "konzS|volany": true, "konzS|vlastnik": false, "konzS|divak": false,
      "ptt|clen": true, "ptt|divak": true, "ptt|vlastnik": true, "ptt|cizi": false,
      "zavrena|clen": false,
    };
    for (const [k, v] of Object.entries(ocekavano)) {
      expect(r(`vstup|${k}`), k).toEqual({ stav: "ok", hodnota: String(v) });
    }
  });

  it("predikát ani čtečku nevolá uživatel ani anonym přímo (PostgREST je nevystaví)", () => {
    expect(r("entry_primo|cizi").stav).toBe(DENY);
    expect(r("predikat_primo|volajici").stav).toBe(DENY);
    expect(r("entry_primo|anon").stav).toBe(DENY);
  });

  it("konzultaci jde navázat jen na story, kterou volající vidí; bez story dál projde", () => {
    expect(r("konz_create|cizi_se_story").stav).toBe(DENY);
    expect(r("konz_create|clen_se_story").stav).toBe("ok");
    expect(r("konz_create|cizi_bez_story").stav).toBe("ok");
  });

  it("call_events anonym nečte vůbec (ne jen prázdně přes RLS)", () => {
    expect(r("call_events|anon").stav).toBe(DENY);
  });
});
