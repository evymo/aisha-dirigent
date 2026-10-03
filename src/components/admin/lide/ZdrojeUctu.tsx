import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useUdelitZdroj, useZdrojeUctu, type UcetHr, type ZdrojDatRadek } from "@/hooks/useHrLideUcty";
import { jmenoUctu } from "@/lib/hr/jmena";

/**
 * Zdroje dat, ke kterým má účet přístup — udělení u uživatele, ne výsledek ingestu.
 *
 * Rozhodnutí majitele (2026-09-28): „ingest navrhuje vazby, protistrany… ale neměl
 * by řešit, kdo k čemu má přístup; MODĚVA, Avant… to jsou zdroje dat z Money, které
 * chceme zpřístupnit." Nabídka je z DAT: instance zdrojů podle záznamu konektoru
 * (agendy Money → faktury a dlužníci), složky vstupu ingestu a firmy podle IČO smluvní
 * strany (smlouvy, ve kterých je firma stranou), u každé počet dokladů. Přístup do
 * sekce extranetu je zvlášť (Sekce extranetu).
 */
export function ZdrojeUctu({ ucet, onClose }: { ucet: UcetHr | null; onClose: () => void }) {
  const { t } = useTranslation();
  const zdroje = useZdrojeUctu(ucet?.user_id ?? null);
  const udelit = useUdelitZdroj();
  const [hledat, setHledat] = useState("");
  const vse = zdroje.data?.vse ?? { zdroj: "vse:*", dokladu: 0, udeleno: false };

  const prepni = (z: ZdrojDatRadek, zapnout: boolean) => {
    if (!ucet) return;
    udelit.mutate(
      { userId: ucet.user_id, zdroj: z.zdroj, udelit: zapnout },
      {
        onSuccess: () =>
          toast.success(t(zapnout ? "admin.people.sources.granted" : "admin.people.sources.revoked", { source: z.label })),
        onError: (e) => toast.error(t("admin.people.sources.failed", { reason: e.message })),
      },
    );
  };

  const seznam = (nadpis: string, radky: ZdrojDatRadek[]) => (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{nadpis}</h3>
      {radky.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.people.sources.none")}</p>
      ) : (
        <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
          {radky.map((z) => (
            <li key={z.zdroj} className="flex items-center justify-between gap-3 p-3">
              <label htmlFor={`zdroj-${z.zdroj}`} className="min-w-0 text-sm">
                <span className={`block truncate font-medium ${z.uroven === 2 ? "pl-4" : ""}`}>{z.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {z.ico ? `${t("admin.people.sources.ico", { ico: z.ico })} · ` : ""}
                  {z.druhy
                    ? t("admin.people.sources.twins", { n: z.dokladu, kinds: z.druhy })
                    : t("admin.people.sources.documents", { n: z.dokladu })}
                </span>
              </label>
              <Switch
                id={`zdroj-${z.zdroj}`}
                checked={z.udeleno}
                disabled={udelit.isPending}
                onCheckedChange={(zapnout) => prepni(z, zapnout)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <Dialog open={ucet !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("admin.people.sources.title", { account: ucet ? jmenoUctu(ucet) : "" })}</DialogTitle>
          <DialogDescription>{t("admin.people.sources.subtitle")}</DialogDescription>
        </DialogHeader>
        {zdroje.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("admin.people.loading")}</p>
        ) : zdroje.isError || !zdroje.data ? (
          <p className="text-sm text-destructive">{t("admin.people.loadError")}</p>
        ) : (
          <div className="space-y-4">
            {/* Plný přístup (majitel 2026-09-28): jeden přepínač „všechna data bez výběru";
                omezený výběr níž zůstává pro uživatele, kterým se data omezují. */}
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <label htmlFor="zdroj-vse" className="min-w-0 text-sm">
                <span className="block font-medium">{t("admin.people.sources.all")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("admin.people.sources.allHint", { n: vse.dokladu })}
                </span>
              </label>
              <Switch
                id="zdroj-vse"
                checked={vse.udeleno}
                disabled={udelit.isPending}
                onCheckedChange={(zapnout) => prepni({ ...vse, label: t("admin.people.sources.all") }, zapnout)}
              />
            </div>
            {seznam(t("admin.people.sources.inputs"), zdroje.data.vstupy)}
            {seznam(t("admin.people.sources.twinSources"), zdroje.data.dvojcata)}
            {seznam(t("admin.people.sources.instances"), zdroje.data.instance)}
            {seznam(t("admin.people.sources.folders"), zdroje.data.slozky)}
            <div className="space-y-2">
              <Input
                value={hledat}
                onChange={(e) => setHledat(e.target.value)}
                placeholder={t("admin.people.sources.firmsSearch")}
                aria-label={t("admin.people.sources.firmsSearch")}
              />
              {seznam(
                t("admin.people.sources.firms"),
                zdroje.data.firmy
                  .filter((f) => {
                    const q = hledat.trim().toLowerCase();
                    return !q || f.label.toLowerCase().includes(q) || (f.ico ?? "").includes(q) || f.udeleno;
                  })
                  .slice(0, 50),
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
