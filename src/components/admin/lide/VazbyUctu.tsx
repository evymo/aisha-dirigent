import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/useDebounce";
import {
  useHledatIdentity,
  useOdebratIdentitu,
  usePriraditIdentitu,
  useVazbyUctu,
  type UcetHr,
} from "@/hooks/useHrLideUcty";
import { jmenoUctu } from "@/lib/hr/jmena";

/**
 * Vazby na data — k čemu se účet dostane (nárok z vazeb jeho osoby).
 *
 * ⭐ Rozhodnutí majitele (2026-09-28): „k čemu v extranetu a vazby na data se
 * uživatel dostane" nastavuje správa u uživatele. Sekce otevírá udělení
 * (SekceUctu), data tahle vazba: osoba účtu → identita (firma, areál…) druhem,
 * který znají pravidla nároku instance. Identita bez potvrzeného identifikátoru
 * data nepřinese — dialog to řekne u každé vazby i u výsledku hledání.
 */
export function VazbyUctu({ ucet, onClose }: { ucet: UcetHr | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [hledat, setHledat] = useState("");
  const vazby = useVazbyUctu(ucet?.user_id ?? null);
  const nalezene = useHledatIdentity(useDebounce(hledat.trim(), 300));
  const priradit = usePriraditIdentitu();
  const odebrat = useOdebratIdentitu();
  const druh = vazby.data?.druhy[0] ?? null;

  const pridej = (twinId: string, label: string) => {
    if (!ucet || !druh) return;
    priradit.mutate(
      { relationKind: druh, twinId, userId: ucet.user_id },
      {
        onSuccess: (r) =>
          r.uz_existuje
            ? toast.info(t("admin.people.bindings.already", { identity: label }))
            : toast.success(t("admin.people.bindings.added", { identity: label })),
        onError: (e) => toast.error(t("admin.people.bindings.failed", { reason: e.message })),
      },
    );
  };

  const odeber = (relationId: string, label: string) => {
    if (!ucet) return;
    odebrat.mutate(
      { relationId, userId: ucet.user_id },
      {
        onSuccess: () => toast.success(t("admin.people.bindings.removed", { identity: label })),
        onError: (e) => toast.error(t("admin.people.bindings.failed", { reason: e.message })),
      },
    );
  };

  const bezIdentifikatoru = <Badge variant="outline">{t("admin.people.bindings.noIdentifier")}</Badge>;

  return (
    <Dialog open={ucet !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("admin.people.bindings.title", { account: ucet ? jmenoUctu(ucet) : "" })}</DialogTitle>
          <DialogDescription>{t("admin.people.bindings.subtitle")}</DialogDescription>
        </DialogHeader>
        {vazby.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("admin.people.loading")}</p>
        ) : vazby.isError || !vazby.data ? (
          <p className="text-sm text-destructive">{t("admin.people.loadError")}</p>
        ) : (
          <div className="space-y-4">
            {!druh ? <p className="text-sm text-muted-foreground">{t("admin.people.bindings.noRules")}</p> : null}
            {vazby.data.vazby.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("admin.people.bindings.empty")}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {vazby.data.vazby.map((v) => (
                  <li key={v.relation_id} className="flex flex-wrap items-center gap-2 p-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{v.label || v.twin_id}</span>
                    <span className="text-xs text-muted-foreground">
                      {v.entity_type} · {v.relation_kind}
                    </span>
                    {v.identifikatoru === 0 ? bezIdentifikatoru : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("admin.people.bindings.remove")}
                      disabled={odebrat.isPending}
                      onClick={() => odeber(v.relation_id, v.label || v.twin_id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {druh ? (
              <div className="space-y-2">
                <Input
                  aria-label={t("admin.people.bindings.search")}
                  placeholder={t("admin.people.bindings.search")}
                  value={hledat}
                  onChange={(e) => setHledat(e.target.value)}
                />
                {nalezene.data && nalezene.data.length > 0 ? (
                  <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
                    {nalezene.data.map((i) => (
                      <li key={i.twin_id} className="flex flex-wrap items-center gap-2 p-2">
                        <span className="min-w-0 flex-1 truncate text-sm">{i.label || i.twin_id}</span>
                        <span className="text-xs text-muted-foreground">{i.entity_type}</span>
                        {i.identifikatoru === 0 ? bezIdentifikatoru : null}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={priradit.isPending}
                          onClick={() => pridej(i.twin_id, i.label || i.twin_id)}
                        >
                          <Plus className="h-4 w-4" />
                          {t("admin.people.bindings.add")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
