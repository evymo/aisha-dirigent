/**
 * Návod pro technika v záložce Tablety: každý krok je v každém jazyce
 * a nese tytéž proměnné jako anglický zdroj.
 *
 * ⛔ NAMĚŘENO 2026-09-19: DeepL v češtině vypustil `{{window}}` z kroku o nočním
 * okně — technik by se nedozvěděl, KDY se aplikace aktualizuje. Kontrola
 * parity klíčů to nepoznala (klíč existoval), proto se měří i proměnné.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { ODDILY, NavodTablety } from "@/components/admin/devices/NavodTablety";

const JAZYKY = ["en", "cs", "de", "fr", "ru", "th"] as const;
const segment = (jazyk: string) =>
  JSON.parse(readFileSync(path.join(process.cwd(), `src/i18n/segments/${jazyk}/admin.json`), "utf8")).admin.devices.tablets.guide;
const promenne = (text: string) => [...text.matchAll(/\{\{\w+\}\}/g)].map((m) => m[0]).sort();

describe("návod k nastavení tabletu", () => {
  const en = segment("en");

  it.each(JAZYKY)("%s: každý krok existuje a nese proměnné zdroje", (jazyk) => {
    const g = segment(jazyk);
    expect(g.title, `${jazyk}: title`).toBeTruthy();
    expect(promenne(g.subtitle)).toEqual(promenne(en.subtitle));
    for (const { klic, kroku } of ODDILY) {
      expect(g[klic]?.title, `${jazyk}: ${klic}.title`).toBeTruthy();
      for (let i = 1; i <= kroku; i++) {
        const text = g[klic]?.[String(i)];
        expect(text, `${jazyk}: ${klic}.${i}`).toBeTruthy();
        expect(promenne(text), `${jazyk}: ${klic}.${i}`).toEqual(promenne(en[klic][String(i)]));
      }
      // Krok navíc by komponenta nikdy neukázala — text, který nikdo neuvidí.
      expect(g[klic]?.[String(kroku + 1)], `${jazyk}: ${klic}.${kroku + 1} navíc`).toBeUndefined();
    }
  });

  it("vykreslí všechny oddíly a kroky", () => {
    render(<NavodTablety kiosk="com.example.kiosk" okno="02:00-04:00" />);
    const kroku = ODDILY.reduce((n, o) => n + o.kroku, 0);
    expect(screen.getAllByRole("listitem")).toHaveLength(kroku);
  });
});
