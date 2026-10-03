/**
 * Čisté jádro executoru akcí po události (F3a): plán z pravidla, šablony, rozvrh CRON.
 * Bez DB a bez sítě — každé rozhodnutí „kdo dostane co / co je chyba konfigurace /
 * co jen chybějící příjemce“ je tu ověřené samo o sobě.
 */
import { describe, expect, it } from "vitest";
import {
  KANALY_EXECUTORU,
  bezpecnyOdkaz,
  kontextSablony,
  naplanuj,
  posledniSlot,
  vyplnSablonu,
  type ZabranyBeh,
} from "../../../services/event-worker/src/proaktivni/jadro.js";

const V = "11111111-2222-4333-8444-555555555555";
function beh(cfg: Record<string, unknown>, data: Record<string, unknown> = {}): ZabranyBeh {
  return {
    run: {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      user_id: "99999999-8888-4777-8666-555555555555",
      source_record_id: "12345678-1234-4234-8234-123456789012",
      source_data: data,
      metadata: {},
      created_at: "2026-09-28T10:00:00Z",
    },
    definition: {
      id: "d", name: "predani.push", action_type: "notification",
      source_table: "story_entries", source_event: "INSERT", action_config: cfg,
    },
  };
}
const VSE = { push: true, email: false };

describe("šablony", () => {
  it("dosadí skaláry a chybějící pole vrátí jménem, nic nedoplní potichu", () => {
    expect(vyplnSablonu("DL {cislo} pro {firma}", { cislo: "7" })).toEqual({ text: "DL 7 pro ", chybi: ["firma"] });
  });
  it("kontext nese jen skaláry — vnořený objekt ani pole se do textu nedostanou", () => {
    const k = kontextSablony(beh({}, { a: "x", n: 3, b: true, o: { tajne: 1 }, p: [1] }));
    expect(k).toMatchObject({ a: "x", n: "3", b: "true", source_record_id: "12345678-1234-4234-8234-123456789012" });
    expect(k).not.toHaveProperty("o");
    expect(k).not.toHaveProperty("p");
  });
  it("odkaz jen relativní cesta nebo http(s)", () => {
    expect(bezpecnyOdkaz("/?detail=x")).toBe(true);
    expect(bezpecnyOdkaz("https://web.example/x")).toBe(true);
    expect(bezpecnyOdkaz("//evil.example")).toBe(false);
    expect(bezpecnyOdkaz("javascript:alert(1)")).toBe(false);
  });
});

describe("plán z pravidla", () => {
  it("kanál, který executor nezná, je chyba konfigurace (ne tiché vyřízení)", () => {
    expect(naplanuj(beh({ channel: "in_app" }), VSE)).toEqual({
      druh: "selhat", duvod: 'config: kanál "in_app" executor nezná',
    });
  });
  it("email bez pošty = no_transport", () => {
    expect(naplanuj(beh({ channel: "email" }), VSE)).toEqual({ druh: "selhat", duvod: "no_transport" });
  });
  it("extranet potřebuje odkaz; odkaz bez hodnoty je rozbitý odkaz → selhat", () => {
    expect(naplanuj(beh({ channel: "extranet" }), VSE).druh).toBe("selhat");
    expect(naplanuj(beh({ channel: "extranet", link: "/?d={chybi}" }), VSE)).toEqual({
      druh: "selhat", duvod: "data: odkaz potřebuje chybi",
    });
    expect(naplanuj(beh({ channel: "extranet", link: "/?d={source_record_id}" }), VSE)).toEqual({
      druh: "extranet", odkaz: "/?d=12345678-1234-4234-8234-123456789012",
    });
  });
  it("push: příjemce z pole zdroje; chybějící příjemce = skipped, ne porucha", () => {
    const cfg = { channel: "push", title: "Doklad {cislo}", recipient: { field: "ridic" } };
    expect(naplanuj(beh(cfg, { cislo: "DL1", ridic: V }), VSE)).toMatchObject({
      druh: "push", prijemci: [V], titulek: "Doklad DL1", kategorie: "proaktivni:predani.push",
    });
    expect(naplanuj(beh(cfg, { cislo: "DL1" }), VSE)).toEqual({ druh: "preskocit", duvod: "no_recipient" });
    expect(naplanuj(beh(cfg, { cislo: "DL1", ridic: "neni-uuid" }), VSE).druh).toBe("preskocit");
  });
  it("push bez svc-push = no_transport; bez titulku = config", () => {
    expect(naplanuj(beh({ channel: "push", title: "x" }), { push: false, email: false }))
      .toEqual({ druh: "selhat", duvod: "no_transport" });
    expect(naplanuj(beh({ channel: "push" }), VSE).druh).toBe("selhat");
  });
  it("push: výchozí příjemce je uživatel běhu; text se ořízne a zbaví řídicích znaků", () => {
    const p = naplanuj(beh({ channel: "push", title: "a\u0000b", body: "x".repeat(900) }), VSE);
    expect(p).toMatchObject({ druh: "push", prijemci: ["99999999-8888-4777-8666-555555555555"], titulek: "ab" });
    expect(p.druh === "push" && p.text.length).toBe(500);
  });
  it("výčet kanálů je extranet, push, email (parita s SQL CHECK hlídá brána)", () => {
    expect([...KANALY_EXECUTORU]).toEqual(["extranet", "push", "email"]);
  });
});

describe("rozvrh CRON", () => {
  const t = new Date("2026-09-28T10:07:30Z");
  it("every_minutes: slot zarovnaný od epochy, poslední ≤ teď", () => {
    expect(posledniSlot({ every_minutes: 5 }, t)?.toISOString()).toBe("2026-09-28T10:05:00.000Z");
    expect(posledniSlot({ every_minutes: 60 }, t)?.toISOString()).toBe("2026-09-28T10:00:00.000Z");
  });
  it("daily_at v pásmu: dnes, když už bylo; jinak včera", () => {
    // 10:07 UTC = 12:07 v Praze (letní čas, +2)
    expect(posledniSlot({ daily_at: "06:00", tz: "Europe/Prague" }, t)?.toISOString()).toBe("2026-09-28T04:00:00.000Z");
    expect(posledniSlot({ daily_at: "13:00", tz: "Europe/Prague" }, t)?.toISOString()).toBe("2026-09-27T11:00:00.000Z");
  });
  it("daily_at přes změnu času: v zimě je posun +1", () => {
    const zima = new Date("2026-11-02T10:00:00Z");
    expect(posledniSlot({ daily_at: "06:00", tz: "Europe/Prague" }, zima)?.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
  it("neplatný rozvrh = null (executor ho nahlásí, nevymýšlí)", () => {
    for (const r of [undefined, {}, { every_minutes: 0 }, { every_minutes: 1.5 }, { daily_at: "25:00" },
      { daily_at: "06:00", tz: "Mars/Olymp" }]) {
      expect(posledniSlot(r, t)).toBeNull();
    }
  });
});
