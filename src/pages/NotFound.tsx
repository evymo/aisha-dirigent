import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

/**
 * ⛔ TEXT 404 NESMÍ VISET NA OBSAHOVÉM JMENNÉM PROSTORU (naměřeno 2026-09-01
 * na živém webu instance).
 *
 * Tady stály klíče z `web.*`. Jenže to je jmenný prostor INSTANČNÍHO obsahu:
 * 478 z 499 klíčů je ve všech šesti slovnících schválně prázdných, protože je
 * dodává instance z databáze přes `useDynamicTranslationsMap`. Statické `t()`
 * se tam nikdy nedostane.
 *
 * Stránka 404 proto na produkci ukazovala doslova tři znaky — „404" — a pod
 * tím prázdný odstavec a tlačítko BEZ POPISKU. Brána `i18nKeysExist` to
 * nechytila: klíče EXISTUJÍ, jen jsou prázdné. Existence není obsah.
 *
 * Platformní chrome bere text z `core.*`, který se dodává vyplněný (0 %
 * prázdných klíčů ve všech šesti jazycích). `notFound.*` tam byl celou dobu
 * hotový včetně cs/de/fr/ru/th — nový klíč se nezakládá, jen se konečně
 * použije ten existující.
 */
const NotFound = () => {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy">
      <div className="text-center max-w-md mx-auto px-6">
        <h1 className="font-serif text-7xl font-bold text-gold mb-4">{"404"}</h1>
        <p className="font-sans text-white/90 text-xl mb-2">{t("notFound.message")}</p>
        <p className="font-sans text-white/60 text-lg mb-8">
          {t("notFound.description")}
        </p>
        <a
          href="/"
          className="inline-flex items-center gap-2 bg-gold hover:bg-gold-dark text-navy px-6 py-3 rounded-full font-sans font-semibold text-sm transition-colors"
        >
          <ArrowLeft size={16} />
          {t("notFound.returnHome")}
        </a>
      </div>
    </div>
  );
};

export default NotFound;
