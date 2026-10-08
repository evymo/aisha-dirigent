/**
 * AppBannerBlock — „Stáhněte si naši aplikaci“ s odkazem do správného obchodu.
 *
 * Zadání (2026-10-01, z instance — správkyně webu a majitel): web má návštěvníkovi
 * nabídnout mobilní aplikaci. Telefon pozná sám: iPhone/iPad → App Store,
 * Android → Google Play; počítač nebo nepoznané zařízení → OBA odkazy.
 * Rozhodování je čistá funkce (lib/web/obchodAplikaci.ts), tady se jen kreslí.
 *
 * ⛔ PROČ RUNTIME BLOK, NE ODKAZY V PLÁTNĚ. Statické HTML nezná zařízení — umělo
 * by jen „oba vždy“. A adresy obchodů jsou KONFIGURACE bloku (autor je vyplní
 * v editoru), ne text zadrátovaný do šablony: jiná instance má jinou aplikaci.
 *
 * ⛔ BEZ ADRES NIC. Dokud autor nevyplní ani jednu adresu, blok se nevykreslí —
 * tlačítko, které nikam nevede, je horší než žádné.
 *
 * Texty: nejdřív instanční obsah z databáze (jmenný prostor `web`, upravuje ho
 * správce v překladech), jinak výchozí text platformy — banner tak nikdy
 * neukáže holý klíč.
 *
 * Zástupný symbol v editoru:
 *   <div data-runtime-block="app-banner" data-block-config='{"iosUrl":"…","androidUrl":"…"}'></div>
 *
 * @module
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Smartphone, X } from "lucide-react";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";
import { obchodyKZobrazeni } from "@/lib/web/obchodAplikaci";
import { platformaNavstevnika } from "@/lib/zarizeni/platforma";

/** Klíč v úložišti prohlížeče: návštěvník banner zavřel. */
export const KLIC_ZAVRENI = "aisha.web.appBanner.zavreno";

const KLIC_NADPISU = "web.appBanner.title";
const KLIC_TEXTU = "web.appBanner.text";

/** Jen http(s) — adresa z konfigurace jde rovnou do `href`. */
function bezpecnaAdresa(hodnota: unknown): string {
  if (typeof hodnota !== "string") return "";
  const adresa = hodnota.trim();
  return /^https?:\/\//i.test(adresa) ? adresa : "";
}

function bylZavren(): boolean {
  try {
    return window.localStorage.getItem(KLIC_ZAVRENI) === "1";
  } catch {
    return false; // soukromé okno / zablokované úložiště: banner prostě ukázat
  }
}

function zapamatujZavreni(): void {
  try {
    window.localStorage.setItem(KLIC_ZAVRENI, "1");
  } catch {
    // nepamatovat si nejde — zavře se aspoň do dalšího načtení stránky
  }
}

/**
 * Runtime blok: nabídka mobilní aplikace.
 *
 * Konfigurace: `{ iosUrl?: string, androidUrl?: string, dismissible?: boolean }`.
 */
export function AppBannerBlock({ config }: RuntimeBlockProps) {
  const { t } = useTranslation();
  const odkazy = { ios: bezpecnaAdresa(config?.iosUrl), android: bezpecnaAdresa(config?.androidUrl) };
  const zaviratelny = config?.dismissible !== false;
  const [zavreno, setZavreno] = useState(() => zaviratelny && bylZavren());

  const preklady = useDynamicTranslationsMap([KLIC_NADPISU, KLIC_TEXTU], "web", "en");
  const nadpis = preklady[KLIC_NADPISU]?.trim() || t("appBanner.title");
  const text = preklady[KLIC_TEXTU]?.trim() || t("appBanner.text");

  const platforma =
    typeof navigator === "undefined"
      ? "jina"
      : platformaNavstevnika({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
  const obchody = obchodyKZobrazeni(platforma, odkazy);

  if (zavreno || obchody.length === 0) return null;

  return (
    <aside
      aria-label={nadpis}
      className="app-banner container mx-auto my-6 flex flex-wrap items-center gap-4 rounded-lg border bg-card px-4 py-3 text-card-foreground sm:px-6"
    >
      <Smartphone className="h-8 w-8 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{nadpis}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {obchody.map((obchod) => (
          <a
            key={obchod}
            href={odkazy[obchod]}
            target="_blank"
            rel="noopener noreferrer"
            data-obchod={obchod}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t(obchod === "ios" ? "appBanner.appStore" : "appBanner.googlePlay")}
          </a>
        ))}
      </div>
      {zaviratelny ? (
        <button
          type="button"
          aria-label={t("appBanner.close")}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          onClick={() => {
            zapamatujZavreni();
            setZavreno(true);
          }}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </aside>
  );
}

export default AppBannerBlock;
