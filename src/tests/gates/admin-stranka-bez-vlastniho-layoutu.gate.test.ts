/**
 * Admin stránka pod layout routou `/admin` se NEOBALUJE vlastním `<AdminLayout>`
 * a každá položka admin menu má překlad.
 *
 * ⛔ NAMĚŘENO 2026-09-19 (guru, hlášení majitele „vypadá to skoro jako
 * picture in picture"): route `/admin` vykresluje `<AdminLayout />`, který
 * vnořené stránky pouští přes `<Outlet />`. AdminWarmupWizard, AdminKnowledgeTopics,
 * AdminKnowledgeModeration a AdminKnowledgeQuarantine se přitom obalovaly
 * `<AdminLayout>` ZNOVU — hlavička, záložky i podmenu se vykreslily dvakrát,
 * jedno v druhém. Ve stejném menu stál nepřeložený klíč
 * `admin.sidebar.items.publicChat` (položka `publicChat` v adminNavConfig bez
 * záznamu v segmentech).
 *
 * ⭐ Měří se vlastnost nad routerem a navigací, ne jmenovitý seznam stránek:
 *   1. každá stránka, kterou router vykresluje pod `/admin`, nerenderuje `<AdminLayout`;
 *   2. každá položka i skupina adminNavGroups má překlad tak, jak ho menu hledá
 *      (labelKey, jinak admin.sidebar.items.<titleKey>; skupina admin.sidebar.groups.<titleKey>).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const cti = (p: string) => readFileSync(join(ROOT, p), "utf8");
const ROUTER = cti("src/router.tsx");

/** Komponenty vykreslené v bloku `<Route path="/admin" …> … </Route>` (vnořené routy). */
function komponentyPodAdminem(): string[] {
  const start = ROUTER.indexOf('path="/admin"');
  expect(start, "route /admin nenalezena").toBeGreaterThan(0);
  // Blok končí první uzavírací značkou Route na stejné úrovni odsazení jako otevírací.
  const odsazeni = /\n(\s*)<Route\s*$/.exec(ROUTER.slice(0, start))?.[1] ?? "";
  const konec = ROUTER.indexOf(`\n${odsazeni}</Route>`, start);
  const blok = ROUTER.slice(start, konec > 0 ? konec : undefined);
  return [...new Set([...blok.matchAll(/element=\{\s*<([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]))];
}

/** Soubor komponenty podle `lazy(() => import("./pages/…"))` nebo přímého importu v routeru. */
function souborKomponenty(jmeno: string): string | null {
  const lazy = new RegExp(`const ${jmeno} = lazy\\(\\(\\) => import\\("\\./([^"]+)"\\)\\)`).exec(ROUTER);
  const imp = new RegExp(`import (?:\\{[^}]*\\b${jmeno}\\b[^}]*\\}|${jmeno}) from "(?:\\./|@/)([^"]+)"`).exec(ROUTER);
  const cesta = lazy?.[1] ?? imp?.[1];
  if (!cesta) return null;
  for (const kandidat of [`src/${cesta}.tsx`, `src/${cesta}/index.tsx`, `src/${cesta}.ts`]) {
    if (existsSync(join(ROOT, kandidat))) return kandidat;
  }
  return null;
}

describe("admin stránky: layout jednou, menu přeložené (brána)", () => {
  const pod = komponentyPodAdminem();

  test("univerzum: router má pod /admin desítky stránek a umím je dohledat", () => {
    expect(pod.length, "měřidlo nevidí vnořené admin routy").toBeGreaterThan(40);
    const dohledane = pod.map(souborKomponenty).filter(Boolean);
    expect(dohledane.length, "měřidlo nedohledá soubory stránek").toBeGreaterThan(40);
  });

  test("⛔ stránka pod /admin nevykresluje vlastní <AdminLayout> (layout dává route)", () => {
    const vady = pod
      .map((k) => ({ k, s: souborKomponenty(k) }))
      .filter(({ s }) => s && /<AdminLayout[\s>]/.test(cti(s)))
      .map(({ k, s }) => `${k} (${s})`);
    expect(vady, `dvojitý admin layout („picture in picture"):\n${vady.join("\n")}`).toEqual([]);
  });

  test("⛔ každá položka i skupina admin menu má překlad (tak, jak ho menu hledá)", async () => {
    // Stejné rozlišení jako AdminSidebar / AdminRibbonNav / AdminRibbonSubNav:
    // položka → labelKey, jinak admin.sidebar.items.<titleKey>; skupina → admin.sidebar.groups.<titleKey>.
    const { adminNavGroups } = await import("../../components/admin/adminNavConfig");
    const en: Record<string, unknown> = {};
    const slouc = (cil: Record<string, unknown>, zdroj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(zdroj)) {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          cil[k] = cil[k] && typeof cil[k] === "object" ? cil[k] : {};
          slouc(cil[k] as Record<string, unknown>, v as Record<string, unknown>);
        } else cil[k] = v;
      }
    };
    const adresar = join(ROOT, "src/i18n/segments/en");
    for (const f of readdirSync(adresar).filter((x) => x.endsWith(".json"))) slouc(en, JSON.parse(readFileSync(join(adresar, f), "utf8")));
    const ma = (klic: string) => typeof klic.split(".").reduce<unknown>((o, c) => (o && typeof o === "object" ? (o as Record<string, unknown>)[c] : undefined), en) === "string";
    const klice = adminNavGroups.flatMap((g) => [
      `admin.sidebar.groups.${g.titleKey}`,
      ...g.items.map((i) => (i as { labelKey?: string }).labelKey ?? `admin.sidebar.items.${i.titleKey}`),
    ]);
    expect(klice.length, "měřidlo nevidí položky menu").toBeGreaterThan(20);
    const chybi = [...new Set(klice)].filter((k) => !ma(k));
    expect(chybi, `položka menu bez překladu (zobrazí se syrový klíč):\n${chybi.join("\n")}`).toEqual([]);
  });
});
