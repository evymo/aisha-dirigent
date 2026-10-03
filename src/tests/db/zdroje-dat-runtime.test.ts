/**
 * ZDROJE DAT U UŽIVATELE: „MODĚVA, Avant… to jsou zdroje dat z Money, které chceme zpřístupnit."
 *
 * ⭐ ROZHODNUTÍ MAJITELE 2026-09-28: ingest navrhuje vazby a protistrany, ale o PŘÍSTUPU
 * nerozhoduje. Přístup ke zdroji dat uděluje správa u uživatele (data_source_grants),
 * přístup do sekce zvlášť. Zdroj dokladu = jeho PŮVOD:
 *   • instance zdroje, jak ji zapsal KONEKTOR (`raw_data.source_record._instance`),
 *   • adresář ve vstupu ingestu (`raw_data.source_path`) — udělený podstrom pustí i podsložky,
 *   • firma = IČO smluvní strany SMLUVNÍHO dokumentu („vazba na firmy, které vidíme v přehledu").
 *
 * ⭐ CO SE MĚŘÍ: že udělení zdroje změní PRÁVĚ JEDNU třídu identity — uživatele s uděleným
 * zdrojem — a že klíčem je původ od konektoru, ne pole vytažené ingestem: faktura se
 * stejným vlastníkem (owner_company), ale bez záznamu konektoru, se přes instanci neotevře.
 *
 * ⛔ Čte se pod `SET ROLE authenticated`: připojení je superuser, který RLS obchází.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const CISLA = String(Date.now() % 100000).padStart(5, "0");

const ADMIN = randomUUID();
const CLEN = randomUUID();
const CESTAR = randomUUID();
const CIZI = randomUUID();
const FIRMAR = randomUUID();
const PLNY = randomUUID();
const DOKUMENTAR = randomUUID();
const DVOJCATAR = randomUUID();
const JEDNOTKA = randomUUID();
const OSOBA_CIZI = randomUUID();

const DLUZNIK_X = randomUUID();
const DLUZNIK_Y = randomUUID();
const FIRMA_F = randomUUID();
const ICO_F = `906${CISLA}`;
const JMENO_F = `ZZ Pronajimatel F ${RUN}`;
const ICO_X = `904${CISLA}`;
const ICO_Y = `905${CISLA}`;
const JMENO_X = `ZZ Zdroj dluznik X ${RUN}`;
const JMENO_Y = `ZZ Zdroj dluznik Y ${RUN}`;

const INSTANCE_A = `ZZ Agenda A ${RUN}`;
const INSTANCE_B = `ZZ Agenda B ${RUN}`;
const ZDROJ_A = `instance:money/${INSTANCE_A}`;
const SLOZKA = `ZZ Najmy ${RUN}`;
const PODSLOZKA = `${SLOZKA}/Bohunicka`;

const FA = `zf-${RUN}-a`;
const FB = `zf-${RUN}-b`;
const FO = `zf-${RUN}-bez-konektoru`;
const SC = `zs-${RUN}-slozka`;
const SD = `zs-${RUN}-jinde`;
const SF = `zs-${RUN}-firma`;
const DOKLADY = [FA, FB, FO, SC, SD, SF];

function psql(claims: string, sql: string, role?: string): string {
  const nastavRoli = role ? `SET ROLE ${role};\n` : "";
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n${nastavRoli}\\o\n${sql};`,
      encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    },
  ).trim();
}
const svc = (sql: string) => psql('{"role":"service_role"}', sql);
const jako = (uid: string, sql: string) => psql(`{"sub":"${uid}","role":"authenticated"}`, sql, "authenticated");
const q = (s: string) => s.replace(/'/g, "''");

/** Které z NAŠICH dokladů identita vidí (ne „kolik má registr" — to by měřilo cizí data). */
const vidi = (uid: string) =>
  jako(uid, `SELECT coalesce(string_agg(doc_slug, ',' ORDER BY doc_slug), '')
               FROM public.li_source_registry WHERE doc_slug IN (${DOKLADY.map((d) => `'${d}'`).join(",")})`);
const dvojcata = (uid: string) => {
  const jmena: Record<string, string> = { [DLUZNIK_X]: "X", [DLUZNIK_Y]: "Y" };
  const ids = jako(uid, `SELECT coalesce(string_agg(id::text, ','), '') FROM public.twin_entities
                          WHERE id IN ('${DLUZNIK_X}','${DLUZNIK_Y}')`);
  return ids ? ids.split(",").map((i) => jmena[i]).sort().join(",") : "";
};
const udel = (kdo: string, komu: string, zdroj: string, udelit: boolean) =>
  jako(kdo, `SELECT public.hr_udel_zdroj_admin(${udelit}, '${komu}', '${q(zdroj)}')::text`);

const pole = (o: Record<string, string>) =>
  JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]))).replace(/'/g, "''");
const faktura = (vlastnik: string, jmeno: string, ico: string) =>
  pole({ owner_company: vlastnik, counterparty: jmeno, counterparty_id: ico, document_subtype: "issued",
         amount_unpaid: "1000", issue_date: "2025-12-01", due_date: "2026-01-01" });
const zKonektoru = (instance: string) =>
  JSON.stringify({ source_record: { _instance: instance, _marker: "money.faktura_vydana", ID: RUN } }).replace(/'/g, "''");
const zeSlozky = (cesta: string) => JSON.stringify({ source_path: cesta }).replace(/'/g, "''");

beforeAll(() => {
  if (!dbAvailable) return;
  svc(`INSERT INTO aisha_auth.users (id, email) VALUES
         ('${ADMIN}','zdroje-admin-${RUN}@test.local'), ('${CLEN}','zdroje-clen-${RUN}@test.local'),
         ('${CESTAR}','zdroje-cestar-${RUN}@test.local'), ('${CIZI}','zdroje-cizi-${RUN}@test.local'),
         ('${FIRMAR}','zdroje-firmar-${RUN}@test.local'), ('${PLNY}','zdroje-plny-${RUN}@test.local'),
         ('${DOKUMENTAR}','zdroje-dok-${RUN}@test.local'), ('${DVOJCATAR}','zdroje-dvoj-${RUN}@test.local')
       ON CONFLICT (id) DO NOTHING`);
  svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING`);
  svc(`INSERT INTO public.twin_entities (id, entity_type, label) VALUES
         ('${DLUZNIK_X}','company','${JMENO_X}'), ('${DLUZNIK_Y}','company','${JMENO_Y}'),
         ('${FIRMA_F}','company','${JMENO_F}'),
         ('${JEDNOTKA}','unit','ZZ jednotka ${RUN}'),
         ('${OSOBA_CIZI}','person','ZZ osoba ${RUN}')
       ON CONFLICT (id) DO NOTHING`);
  // Vazba účtu (kdo je čí uživatel) — plný přístup k DATŮM ji číst nesmí.
  svc(`INSERT INTO public.twin_external_refs (twin_id, ref_kind, source, source_key, state, proposed_by, confirmed_at, valid_from)
         VALUES ('${OSOBA_CIZI}', 'account', 'aisha_auth', '${CIZI}', 'confirmed', 'zdroje-test', now(), now() - interval '1 day')`);
  // Parametry jednotky v čase (tak je nese sez-vyuctovani): nájemce a obsazenost.
  svc(`INSERT INTO public.twin_events (event_type, twin_id, occurred_at, attrs, source) VALUES
         ('parameter', '${JEDNOTKA}', now() - interval '1 day', '{"code":"unit_tenant","value":"ZZ Najemce ${RUN} s.r.o."}'::jsonb, 'zdroje-test'),
         ('parameter', '${JEDNOTKA}', now() - interval '1 day', '{"code":"unit_occupied","value":"ano"}'::jsonb, 'zdroje-test')`);
  // Protistrany jen NAVRŽENÉ podle IČO — tak je dnes zná ingest.
  svc(`INSERT INTO public.twin_external_refs (twin_id, ref_kind, source, source_key, state, proposed_by) VALUES
         ('${DLUZNIK_X}','company_ico','ingest','${ICO_X}','proposed','zdroje-test'),
         ('${DLUZNIK_Y}','company_ico','ingest','${ICO_Y}','proposed','zdroje-test'),
         ('${FIRMA_F}','company_ico','ingest','${ICO_F}','proposed','zdroje-test')`);

  svc(`INSERT INTO public.li_source_registry (doc_slug, source_sha256, doc_type, doc_class, fields, raw_data) VALUES
         ('${FA}','sha-${FA}','invoice','transactional','${faktura(INSTANCE_A, JMENO_X, ICO_X)}'::jsonb, '${zKonektoru(INSTANCE_A)}'::jsonb),
         ('${FB}','sha-${FB}','invoice','transactional','${faktura(INSTANCE_B, JMENO_Y, ICO_Y)}'::jsonb, '${zKonektoru(INSTANCE_B)}'::jsonb),
         ('${FO}','sha-${FO}','invoice','transactional','${faktura(INSTANCE_A, JMENO_Y, ICO_Y)}'::jsonb, '{}'::jsonb),
         ('${SC}','sha-${SC}','contract','contractual','${pole({ counterparty: JMENO_X })}'::jsonb, '${zeSlozky(`${PODSLOZKA}/smlouva.pdf`)}'::jsonb),
         ('${SD}','sha-${SD}','contract','contractual','${pole({ counterparty: JMENO_Y })}'::jsonb, '${zeSlozky(`ZZ Jinde ${RUN}/smlouva.pdf`)}'::jsonb),
         ('${SF}','sha-${SF}','contract','contractual','${pole({ supplier_id: ICO_F, supplier_name: "ocr šum", counterparty: JMENO_Y })}'::jsonb, '{"source_record":null}'::jsonb)
       ON CONFLICT (source_sha256) DO NOTHING`);

  const doklady = svc(`SELECT count(*) FROM public.li_source_registry WHERE doc_slug IN (${DOKLADY.map((d) => `'${d}'`).join(",")})`);
  if (doklady !== "6") throw new Error(`fixtura: doklady ${doklady}/6 — test by měřil prázdno`);
});

afterAll(() => {
  if (!dbAvailable) return;
  svc(`DELETE FROM public.li_source_registry WHERE doc_slug IN (${DOKLADY.map((d) => `'${d}'`).join(",")})`);
  svc(`DELETE FROM public.twin_events WHERE twin_id = '${JEDNOTKA}'`);
  svc(`DELETE FROM public.twin_entities WHERE id IN ('${DLUZNIK_X}','${DLUZNIK_Y}','${FIRMA_F}','${JEDNOTKA}','${OSOBA_CIZI}')`);
  svc(`DELETE FROM public.user_roles WHERE user_id = '${ADMIN}'`);
  svc(`DELETE FROM aisha_auth.users WHERE id IN ('${ADMIN}','${CLEN}','${CESTAR}','${CIZI}','${FIRMAR}','${PLNY}','${DOKUMENTAR}','${DVOJCATAR}')`);
});

describe.skipIf(!dbAvailable)("zdroje dat — udělení správou", () => {
  it("⛔ bez udělení běžný uživatel nevidí nic; správa vidí vše", () => {
    expect(vidi(CLEN)).toBe("");
    expect(vidi(ADMIN)).toBe([...DOKLADY].sort().join(","));
  });

  it("⛔ udělovat ani prohlížet zdroje smí jen správa", () => {
    expect(() => udel(CLEN, CLEN, ZDROJ_A, true)).toThrow(/Unauthorized/);
    expect(() => jako(CLEN, `SELECT public.hr_zdroje_uctu_admin('${CLEN}')`)).toThrow(/Unauthorized/);
  });

  it("⛔ zdroj, který v datech není, ani nesmyslný tvar udělit nejde (nic by neotevřel)", () => {
    expect(() => udel(ADMIN, CLEN, `instance:money/ZZ neexistuje ${RUN}`, true)).toThrow(/zdroj_not_found/);
    expect(() => udel(ADMIN, CLEN, `agenda:${INSTANCE_A}`, true)).toThrow(/invalid_zdroj/);
  });

  it("⭐ přehled pro správu nabízí instanci a složky z DAT, s počtem dokladů a stavem", () => {
    const z = JSON.parse(jako(ADMIN, `SELECT public.hr_zdroje_uctu_admin('${CLEN}')::text`));
    const inst = z.instance.find((i: { zdroj: string }) => i.zdroj === ZDROJ_A);
    expect(inst).toMatchObject({ label: `money/${INSTANCE_A}`, dokladu: 1, udeleno: false });
    const slozky = z.slozky.map((s: { label: string }) => s.label);
    expect(slozky).toEqual(expect.arrayContaining([SLOZKA, PODSLOZKA]));
  });

  it("⭐ udělená instance otevře doklady TÉ instance od konektoru; zápis jde do auditu", () => {
    expect(JSON.parse(udel(ADMIN, CLEN, ZDROJ_A, true))).toMatchObject({ ok: true, udeleno: true, zmena: true });
    expect(vidi(CLEN)).toBe(FA);
    expect(svc(`SELECT count(*) FROM public.audit_journal
                 WHERE entity_type = 'data_source_grants' AND entity_id = '${CLEN}'`)).not.toBe("0");
    const z = JSON.parse(jako(ADMIN, `SELECT public.hr_zdroje_uctu_admin('${CLEN}')::text`));
    expect(z.instance.find((i: { zdroj: string }) => i.zdroj === ZDROJ_A).udeleno).toBe(true);
  });

  it("⛔ faktura se stejným vlastníkem, ale bez záznamu konektoru se přes instanci NEotevře", () => {
    expect(vidi(CLEN)).not.toContain(FO);
    expect(vidi(CLEN)).not.toContain(FB);
  });

  it("⭐ protistranu dokladů z uděleného zdroje čte (karta dlužníka), cizí ne", () => {
    expect(dvojcata(CLEN)).toBe("X");
    expect(dvojcata(CIZI)).toBe("");
  });

  it("⭐ blok dlužníků (SECURITY INVOKER) ukáže jen dlužníka z uděleného zdroje", () => {
    const blok = jako(CLEN, `SELECT public.get_receivables_overdue('{"limit":500}'::jsonb)::text`);
    expect(blok).toContain(JMENO_X);
    expect(blok).not.toContain(JMENO_Y);
  });

  it("⭐ udělená složka pustí i podsložky, sousední složku ne", () => {
    expect(JSON.parse(udel(ADMIN, CESTAR, `cesta:${SLOZKA}`, true))).toMatchObject({ ok: true, zmena: true });
    expect(vidi(CESTAR)).toBe(SC);
  });

  it("⭐ udělená firma otevře smluvní dokumenty, ve kterých je stranou (podle IČO)", () => {
    const z = JSON.parse(jako(ADMIN, `SELECT public.hr_zdroje_uctu_admin('${FIRMAR}')::text`));
    expect(z.firmy.find((f: { zdroj: string }) => f.zdroj === `firma:${ICO_F}`))
      .toMatchObject({ label: JMENO_F, ico: ICO_F, dokladu: 1, udeleno: false });
    expect(JSON.parse(udel(ADMIN, FIRMAR, `firma:${ICO_F}`, true))).toMatchObject({ ok: true, zmena: true });
    expect(vidi(FIRMAR)).toBe(SF);
  });

  it("⛔ firma neotevře doklady z konektoru (Money), kde je jen odběratelem — ty jdou instancí", () => {
    // FA je faktura z instance A s protistranou X (IČO); firma X by ji otevřít NESMĚLA:
    // blok dlužníků by jinak udělal z firmy dlužníka cizí agendy.
    expect(() => udel(ADMIN, FIRMAR, `firma:${ICO_X}`, true)).toThrow(/zdroj_not_found/);
  });

  it("⛔ udělení platí jen tomu, komu bylo dáno; tabulku udělení nikdo přímo nečte", () => {
    expect(vidi(CIZI)).toBe("");
    expect(() => jako(CLEN, `SELECT count(*) FROM public.data_source_grants`)).toThrow(/permission denied/);
    expect(jako(CIZI, `SELECT count(*) FROM public.li_doc_slugs_v_rozsahu('${CLEN}')`)).toBe("0");
  });

  it("⭐ odebrání vezme přístup hned; druhé odebrání nic nemění", () => {
    expect(JSON.parse(udel(ADMIN, CLEN, ZDROJ_A, false))).toMatchObject({ ok: true, udeleno: false, zmena: true });
    expect(vidi(CLEN)).toBe("");
    expect(JSON.parse(udel(ADMIN, CLEN, ZDROJ_A, false))).toMatchObject({ zmena: false });
  });
});

describe.skipIf(!dbAvailable)("zdroje dat — plný přístup bez výběru (vse:*)", () => {
  const jednotkaCte = (uid: string) =>
    jako(uid, `SELECT count(*) FROM public.twin_events WHERE twin_id = '${JEDNOTKA}'`);

  it("⛔ bez udělení běžný uživatel nevidí doklady, dvojčata ani parametry jednotky", () => {
    expect(vidi(PLNY)).toBe("");
    expect(dvojcata(PLNY)).toBe("");
    expect(jednotkaCte(PLNY)).toBe("0");
  });

  it("⛔ plný přístup je jen vse:*, jiná hodnota se odmítne", () => {
    expect(() => udel(ADMIN, PLNY, "vse:cokoli", true)).toThrow(/invalid_zdroj/);
  });

  it("⭐ vse:* otevře VŠECHNY doklady (i bez záznamu konektoru), dvojčata a parametry v čase; zápis do auditu", () => {
    expect(JSON.parse(udel(ADMIN, PLNY, "vse:*", true))).toMatchObject({ ok: true, udeleno: true, zmena: true });
    expect(vidi(PLNY)).toBe([...DOKLADY].sort().join(","));
    expect(dvojcata(PLNY)).toBe(["X", "Y"].sort().join(","));
    expect(jednotkaCte(PLNY)).toBe("2");
    const z = JSON.parse(jako(ADMIN, `SELECT public.hr_zdroje_uctu_admin('${PLNY}')::text`));
    expect(z.vse).toMatchObject({ zdroj: "vse:*", udeleno: true });
    expect(svc(`SELECT count(*) FROM public.audit_journal
                 WHERE entity_type = 'data_source_grants' AND entity_id = '${PLNY}'`)).not.toBe("0");
  });

  it("⛔ ani s plným přístupem nečte vazby ÚČTŮ (kdo je čí uživatel) a nedostane správu", () => {
    expect(jako(ADMIN, `SELECT count(*) FROM public.twin_external_refs WHERE twin_id = '${OSOBA_CIZI}' AND ref_kind = 'account'`)).toBe("1");
    expect(jako(PLNY, `SELECT count(*) FROM public.twin_external_refs WHERE twin_id = '${OSOBA_CIZI}' AND ref_kind = 'account'`)).toBe("0");
    expect(() => jako(PLNY, `SELECT public.hr_zdroje_uctu_admin('${PLNY}')`)).toThrow(/Unauthorized/);
  });

  it("⛔ oracle guard: cizí účet se na plný přístup jiného nezeptá", () => {
    expect(jako(CIZI, `SELECT public.ma_plny_pristup_k_datum('${PLNY}')::text`)).toBe("false");
    expect(jako(PLNY, `SELECT public.ma_plny_pristup_k_datum('${PLNY}')::text`)).toBe("true");
  });

  it("⭐ detail jednotky ukazuje nájemce a obsazenost (parametry v čase, jako registr)", () => {
    const d = JSON.parse(jako(PLNY, `SELECT public.get_twin_detail('{"twin_id":"${JEDNOTKA}"}'::jsonb)::text`));
    const pole = Object.fromEntries(d.data.fields.map((f: { key: string; value: string }) => [f.key, f.value]));
    expect(pole.unit_tenant).toBe(`ZZ Najemce ${RUN} s.r.o.`);
    expect(pole.unit_occupied).toBe("ano");
  });

  it("⭐ odebrání plného přístupu vezme data hned", () => {
    expect(JSON.parse(udel(ADMIN, PLNY, "vse:*", false))).toMatchObject({ zmena: true });
    expect(vidi(PLNY)).toBe("");
    expect(jednotkaCte(PLNY)).toBe("0");
  });
});

describe.skipIf(!dbAvailable)("zdroje dat po druzích — dokumenty vstupu a zdroj dvojčat", () => {
  it("⭐ vstup:dokumenty otevře dokumenty zpracovaného vstupu (smlouvy ze souborů), ne záznamy konektoru", () => {
    const z = JSON.parse(jako(ADMIN, `SELECT public.hr_zdroje_uctu_admin('${DOKUMENTAR}')::text`));
    expect(z.vstupy.find((v: { zdroj: string }) => v.zdroj === "vstup:dokumenty")).toBeTruthy();
    expect(JSON.parse(udel(ADMIN, DOKUMENTAR, "vstup:dokumenty", true))).toMatchObject({ ok: true, zmena: true });
    expect(vidi(DOKUMENTAR)).toBe([SC, SD, SF].sort().join(","));
  });

  it("⛔ zdroj dvojčat, o kterém data nejsou, udělit nejde", () => {
    expect(() => udel(ADMIN, DVOJCATAR, `udalosti:zz-neexistuje-${RUN}`, true)).toThrow(/zdroj_not_found/);
  });

  it("⭐ udalosti:<zdroj> otevře dvojčata toho zdroje i jejich parametry v čase (jednotka s nájemcem)", () => {
    const z = JSON.parse(jako(ADMIN, `SELECT public.hr_zdroje_uctu_admin('${DVOJCATAR}')::text`));
    expect(z.dvojcata.find((v: { zdroj: string }) => v.zdroj === "udalosti:zdroje-test")).toMatchObject({ druhy: "unit" });
    expect(jako(DVOJCATAR, `SELECT count(*) FROM public.twin_events WHERE twin_id = '${JEDNOTKA}'`)).toBe("0");
    expect(JSON.parse(udel(ADMIN, DVOJCATAR, "udalosti:zdroje-test", true))).toMatchObject({ ok: true, zmena: true });
    expect(jako(DVOJCATAR, `SELECT count(*) FROM public.twin_entities WHERE id = '${JEDNOTKA}'`)).toBe("1");
    expect(jako(DVOJCATAR, `SELECT count(*) FROM public.twin_events WHERE twin_id = '${JEDNOTKA}'`)).toBe("2");
    const d = JSON.parse(jako(DVOJCATAR, `SELECT public.get_twin_detail('{"twin_id":"${JEDNOTKA}"}'::jsonb)::text`));
    expect(d.data.fields.find((f: { key: string }) => f.key === "unit_tenant")?.value).toBe(`ZZ Najemce ${RUN} s.r.o.`);
    // zdroj dvojčat nedává doklady
    expect(vidi(DVOJCATAR)).toBe("");
  });

  it("⛔ katalog parametrů čte jen ten, kdo má nějaký zdroj dat; bez zdroje nic", () => {
    expect(jako(DVOJCATAR, `SELECT public.ma_zdroj_dat('${DVOJCATAR}')::text`)).toBe("true");
    expect(jako(CIZI, `SELECT public.ma_zdroj_dat('${CIZI}')::text`)).toBe("false");
    expect(jako(CIZI, `SELECT public.ma_zdroj_dat('${DVOJCATAR}')::text`)).toBe("false");
  });
});

