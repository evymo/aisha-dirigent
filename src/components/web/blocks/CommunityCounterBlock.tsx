/**
 * CommunityCounterBlock — živé počítadlo praktikujících v hero sekci.
 *
 * Předloha webu instance má pod tlačítky velké číslo a malé slovo:
 *
 *     1234 users
 *
 * ⛔ PROČ RUNTIME BLOK, A NE ČÍSLO V CANVASU. Canvas je statické HTML, které se
 * edituje v GrapesJS. Kdyby v něm stálo číslo, byl by to údaj, který nikdo
 * neaktualizuje a který se rozejde se skutečností — přesně ta třída vad, na
 * kterou tenhle repozitář doplácí jinde. Placeholder `data-runtime-block`
 * zůstává v GrapesJS editovatelný jako prvek (dá se přesunout, obalit, smazat),
 * ale HODNOTA teče z API.
 *
 * Zdroj je veřejné RPC `get_public_homepage_stats` — totéž, které si stránka už
 * volá; nepřidává tedy žádný nový dotaz na kritické cestě.
 *
 * @module
 */
import { useQuery } from "@tanstack/react-query";
import { gatewayUrl } from "@/integrations/api/client";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

interface PocetKomunity {
  count?: number | null;
}

/**
 * Konfigurace z `data-block-config`:
 *   labelKey — i18n klíč pro slovo za číslem
 *
 * ⛔ ZDROJ ČÍSLA SE ZMĚNIL (naměřeno 2026-09-01 na živém webu instance).
 *
 * Blok volal `get_public_homepage_stats` a bral z něj `member_count`. Jenže to
 * počítá tabulku `memberships` — PRODUKTOVÝ pojem Studia (placené členství),
 * ne praktikující v aplikaci. Na téhle instanci vrací 0, takže se počítadlo
 * nikdy nevykreslilo, přestože blok i jeho místo v plátně byly hotové.
 *
 * Autoritativní číslo žije ve zdrojové aplikaci instance (source-api, Django/DRF). Do prohlížeče se nedostane
 * přímo — byl by to jiný původ (CORS) a adresa zadrátovaná do statického buildu
 * — takže ho podává BRÁNA serverovou stranou: `GET /public/community-count`.
 *
 * NIC SE NEDRŽÍ: dotaz na vykreslení, aktuální stav, nebo nic. Uložené číslo by
 * po výpadku tvrdilo něco, co už neplatí, a nikdo by nepoznal, jak je staré.
 */
export function CommunityCounterBlock({ config }: RuntimeBlockProps) {
  const labelKey = (config.labelKey as string) ?? "web.hero.counterLabel";

  const { data } = useQuery({
    queryKey: ["community-count"],
    queryFn: async (): Promise<PocetKomunity | null> => {
      const odpoved = await fetch(`${gatewayUrl}/public/community-count`, {
        headers: { Accept: "application/json" },
        // ⛔ HERO NESMÍ ČEKAT DONEKONEČNA. Timeout na skoku brána→zdroj tu
        // nestačí: kdyby nedopověděla sama brána, dotaz by visel a s ním
        // i překreslení. Pro počítadlo je pomalá odpověď totéž co žádná —
        // vykreslí se nic. Chytila brána `codebase-security-patterns`.
        signal: AbortSignal.timeout(6_000),
      });
      // Brána u nedostupného čísla poctivě vrací 502/503 s důvodem. Pro hero
      // je to všechno týž stav: číslo nemám, takže nekreslím.
      if (!odpoved.ok) return null;
      return (await odpoved.json()) as PocetKomunity;
    },
    retry: 1,
  });

  // ⛔ POPISEK JE INSTANČNÍ OBSAH, ne statický klíč (naměřeno 2026-09-01).
  //
  // Tady stálo `t(labelKey)`. Jenže `web.*` je jmenný prostor, který se dodává
  // PRÁZDNÝ (478 z 499 klíčů) — text do něj dává instance z databáze. Statické
  // `t()` by tedy vedle čísla vypsalo doslova `web.hero.counterLabel`. Tentýž
  // omyl měla stránka 404; tady by byl vidět v hero.
  //
  // V databázi ten klíč JE, v osmi jazycích (users, praktikujících,
  // Praktizierende, pratiquants, практикующих, ผู้ปฏิบัติ, praticanti,
  // practicantes) — jen se na něj musí zeptat správnou cestou.
  const preklady = useDynamicTranslationsMap([labelKey], "web", "en");
  const popisek = preklady[labelKey]?.trim() || null;

  const hodnota = Number(data?.count ?? 0);

  // ⛔ Dokud číslo nedorazí (nebo když RPC selže), NEVYKRESLÍ SE NIC.
  // Nula napsaná velkým písmem v hero je horší než prázdno: tvrdila by
  // návštěvníkovi, že komunita je prázdná. Prázdno jen mlčí.
  if (!Number.isFinite(hodnota) || hodnota <= 0) return null;

  return (
    <p className="hero__count">
      <span className="hero__count-value">{hodnota.toLocaleString()}</span>
      {popisek ? <> <span className="hero__count-label">{popisek}</span></> : null}
    </p>
  );
}

export default CommunityCounterBlock;
