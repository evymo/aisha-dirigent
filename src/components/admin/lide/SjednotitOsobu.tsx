import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/useDebounce";
import { OdmitnutiSjednoceni, useOsobyBezUctu, useSjednotitOsobu, type PoctySjednoceni } from "@/hooks/useHrLideUcty";
import { vychoziHledani } from "@/lib/hr/jmena";

export type Kanon = { twin_id: string; label: string; entity_type: string };

const klicVyberu = (ids: Iterable<string>) => [...ids].sort().join(",");

/**
 * Sjednocení úlomků téhož člověka pod jednu osobu (hr_sjednot_osobu_admin).
 * „Sjednotit" se odemkne až NÁHLEDEM pro přesně tenhle výběr — rozhodnutí
 * o identitě se nemá dělat naslepo.
 */
export function SjednotitOsobu({ kanon, onZavrit }: { kanon: Kanon | null; onZavrit: () => void }) {
  return (
    <Dialog open={kanon !== null} onOpenChange={(o) => !o && onZavrit()}>
      <DialogContent className="max-w-2xl">{kanon ? <Obsah key={kanon.twin_id} kanon={kanon} onZavrit={onZavrit} /> : null}</DialogContent>
    </Dialog>
  );
}

function Obsah({ kanon, onZavrit }: { kanon: Kanon; onZavrit: () => void }) {
  const { t } = useTranslation();
  const [hledat, setHledat] = useState(() => vychoziHledani(kanon.label));
  const [vybrane, setVybrane] = useState<Set<string>>(new Set());
  const [duvod, setDuvod] = useState(() => t("admin.people.merge.defaultReason"));
  const [nahled, setNahled] = useState<{ klic: string; pocty: PoctySjednoceni } | null>(null);
  const osoby = useOsobyBezUctu(useDebounce(hledat.trim(), 300), kanon.entity_type);
  const sjednotit = useSjednotitOsobu();

  const kandidati = useMemo(() => (osoby.data?.items ?? []).filter((o) => o.twin_id !== kanon.twin_id), [osoby.data, kanon.twin_id]);
  const klic = klicVyberu(vybrane);
  const nahledPlati = nahled !== null && nahled.klic === klic && vybrane.size > 0;

  const prepni = (id: string) =>
    setVybrane((v) => {
      const n = new Set(v);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const chyba = (e: Error) => {
    if (e instanceof OdmitnutiSjednoceni) {
      if (e.kod === "ulomek_ma_ucet") return t("admin.people.merge.errors.hasAccount");
      if (e.kod === "ulomek_neni_stejneho_druhu_nebo_aktivni") return t("admin.people.merge.errors.kind");
      return t("admin.people.merge.errors.generic", { code: e.kod });
    }
    return t("admin.people.merge.failed", { reason: e.message });
  };

  const provedNahled = () =>
    sjednotit.mutate(
      { kanon: kanon.twin_id, ulomky: [...vybrane], nahled: true },
      { onSuccess: (r) => r.pocty && setNahled({ klic, pocty: r.pocty }), onError: (e) => toast.error(chyba(e)) },
    );

  const provedSjednoceni = () =>
    sjednotit.mutate(
      { kanon: kanon.twin_id, ulomky: [...vybrane], duvod: duvod.trim(), nahled: false },
      {
        onSuccess: (r) => {
          toast.success(t("admin.people.merge.done", { records: r.pocty?.zaznamu_archivovat ?? vybrane.size, name: kanon.label }));
          onZavrit();
        },
        onError: (e) => toast.error(chyba(e)),
      },
    );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("admin.people.merge.title", { name: kanon.label })}</DialogTitle>
        <DialogDescription>{t("admin.people.merge.subtitle")}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input aria-label={t("admin.people.merge.search")} placeholder={t("admin.people.merge.search")} value={hledat} onChange={(e) => setHledat(e.target.value)} />
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setVybrane(new Set(kandidati.map((o) => o.twin_id)))}>
            {t("admin.people.merge.selectAll")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setVybrane(new Set())}>
            {t("admin.people.merge.clear")}
          </Button>
        </div>
      </div>
      <ul className="max-h-72 divide-y overflow-y-auto rounded-md border" aria-label={t("admin.people.merge.search")}>
        {kandidati.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">{t("admin.people.merge.empty")}</li>
        ) : (
          kandidati.map((o) => (
            <li key={o.twin_id}>
              <label className="flex cursor-pointer items-start gap-3 p-3 text-sm hover:bg-muted">
                <input type="checkbox" className="mt-1" checked={vybrane.has(o.twin_id)} onChange={() => prepni(o.twin_id)} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{o.twin_label || o.twin_id}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {o.kroky && o.kroky.celkem > 0 ? (
                      <Badge variant="outline" className="tabular-nums">
                        {t("admin.people.persons.tasks", { total: o.kroky.celkem, pending: o.kroky.ceka })}
                      </Badge>
                    ) : null}
                    {o.refs.map((r) => (
                      <Badge key={`${r.source}:${r.source_key}`} variant="secondary" className="font-mono text-[11px]">
                        {r.source_key}
                      </Badge>
                    ))}
                  </span>
                </span>
              </label>
            </li>
          ))
        )}
      </ul>
      <p className="text-xs text-muted-foreground tabular-nums">{t("admin.people.merge.selected", { count: vybrane.size })}</p>
      {nahledPlati ? (
        <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm" role="status">
          <p>
            {t("admin.people.merge.previewText", {
              refs: nahled.pocty.vazeb_presunout,
              tasks: nahled.pocty.kroku_prepojit,
              records: nahled.pocty.zaznamu_archivovat,
              done: nahled.pocty.kroku_hotovych_zustava,
            })}
          </p>
          {nahled.pocty.relaci_zustava > 0 ? (
            <p className="text-muted-foreground">{t("admin.people.merge.relationsKept", { count: nahled.pocty.relaci_zustava })}</p>
          ) : null}
        </div>
      ) : vybrane.size > 0 ? (
        <p className="text-xs text-muted-foreground">{t("admin.people.merge.previewFirst")}</p>
      ) : null}
      <Input aria-label={t("admin.people.merge.reason")} placeholder={t("admin.people.merge.reason")} value={duvod} onChange={(e) => setDuvod(e.target.value)} />
      <DialogFooter>
        <Button variant="ghost" onClick={onZavrit}>
          {t("admin.people.cancel")}
        </Button>
        <Button variant="outline" disabled={vybrane.size === 0 || sjednotit.isPending} onClick={provedNahled}>
          {t("admin.people.merge.preview")}
        </Button>
        <Button disabled={!nahledPlati || !duvod.trim() || sjednotit.isPending} onClick={provedSjednoceni}>
          {t("admin.people.merge.apply")}
        </Button>
      </DialogFooter>
    </>
  );
}
