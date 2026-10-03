import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useSekceUctu, useUdelitSekci, type UcetHr } from "@/hooks/useHrLideUcty";
import { jmenoUctu } from "@/lib/hr/jmena";

/**
 * Sekce extranetu, do kterých účet smí — udělení u uživatele, ne role.
 *
 * ⭐ Rozhodnutí majitele (2026-09-28): „přístup do sekce extranetu je další úroveň
 * než přístup k datům; stačí sekci u uživatele v administraci nastavit — a tam
 * pak vidí jen data, na která má nárok." Udělení jen otevírá sekci; co v ní
 * uvidí, řídí vazby jeho osoby. Nabídka jsou sekce, které data instance
 * deklarují jako udělitelné (osa publika „udeleni").
 */
export function SekceUctu({ ucet, onClose }: { ucet: UcetHr | null; onClose: () => void }) {
  const { t } = useTranslation();
  const sekce = useSekceUctu(ucet?.user_id ?? null);
  const udelit = useUdelitSekci();

  const prepni = (surface: string, nazev: string, zapnout: boolean) => {
    if (!ucet) return;
    udelit.mutate(
      { userId: ucet.user_id, surface, udelit: zapnout },
      {
        onSuccess: () =>
          toast.success(t(zapnout ? "admin.people.sections.granted" : "admin.people.sections.revoked", { section: nazev })),
        onError: (e) => toast.error(t("admin.people.sections.failed", { reason: e.message })),
      },
    );
  };

  return (
    <Dialog open={ucet !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.people.sections.title", { account: ucet ? jmenoUctu(ucet) : "" })}</DialogTitle>
          <DialogDescription>{t("admin.people.sections.subtitle")}</DialogDescription>
        </DialogHeader>
        {sekce.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("admin.people.loading")}</p>
        ) : sekce.isError || !sekce.data ? (
          <p className="text-sm text-destructive">{t("admin.people.loadError")}</p>
        ) : sekce.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.people.sections.empty")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {sekce.data.map((s) => {
              const nazev = s.title_key ? t(s.title_key, { defaultValue: s.surface }) : s.surface;
              return (
                <li key={s.surface} className="flex items-center justify-between gap-3 p-3">
                  <label htmlFor={`sekce-${s.surface}`} className="text-sm font-medium">
                    {nazev}
                  </label>
                  <Switch
                    id={`sekce-${s.surface}`}
                    checked={s.udeleno}
                    disabled={udelit.isPending}
                    onCheckedChange={(zapnout) => prepni(s.surface, nazev, zapnout)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
