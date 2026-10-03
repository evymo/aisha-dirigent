import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/useDebounce";
import { useHrUcty, useOsobyBezUctu, type OsobaBezUctu, type UcetHr } from "@/hooks/useHrLideUcty";

type Prirazeni = { strana: "ucet"; ucet: UcetHr } | { strana: "osoba"; osoba: OsobaBezUctu };
type Vybrana = { ucet: UcetHr; osoba: { twin_id: string; label: string } };

const jmenoUctu = (u: UcetHr) => u.jmeno || u.email || u.user_id;
const jmenoOsoby = (o: OsobaBezUctu) => o.twin_label || o.twin_id;

/**
 * Výběr protějšku k přiřazení. Obsah se vykreslí (a dotazy běží) jen když je
 * dialog otevřený — zavřený dialog nemá co načítat.
 */
export function VyberProtistrany(props: {
  prirazeni: Prirazeni | null;
  probiha: boolean;
  onZavrit: () => void;
  onPriradit: (ucet: UcetHr, osoba: { twin_id: string; label: string }) => void;
}) {
  const { t } = useTranslation();
  const p = props.prirazeni;
  return (
    <Dialog open={p !== null} onOpenChange={(o) => !o && props.onZavrit()}>
      <DialogContent className="max-w-lg">
        {p ? <Obsah key={p.strana === "ucet" ? p.ucet.user_id : p.osoba.twin_id} {...props} prirazeni={p} t={t} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Obsah({
  prirazeni,
  probiha,
  onZavrit,
  onPriradit,
  t,
}: {
  prirazeni: Prirazeni;
  probiha: boolean;
  onZavrit: () => void;
  onPriradit: (ucet: UcetHr, osoba: { twin_id: string; label: string }) => void;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  const [hledat, setHledat] = useState("");
  const [vybrana, setVybrana] = useState<Vybrana | null>(null);
  const h = useDebounce(hledat.trim(), 300);
  const hledamOsobu = prirazeni.strana === "ucet";
  const osoby = useOsobyBezUctu(hledamOsobu ? h : "", null);
  const ucty = useHrUcty(hledamOsobu ? "" : h);

  const nadpis = hledamOsobu
    ? t("admin.people.assign.titleForAccount", { name: jmenoUctu(prirazeni.ucet) })
    : t("admin.people.assign.titleForPerson", { name: jmenoOsoby(prirazeni.osoba) });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{nadpis}</DialogTitle>
        <DialogDescription>{t(hledamOsobu ? "admin.people.assign.pickPerson" : "admin.people.assign.pickAccount")}</DialogDescription>
      </DialogHeader>
      <Input autoFocus aria-label={t("admin.people.assign.search")} placeholder={t("admin.people.assign.search")} value={hledat} onChange={(e) => setHledat(e.target.value)} />
      <ul className="max-h-72 divide-y overflow-y-auto rounded-md border" role="listbox" aria-label={nadpis}>
        {hledamOsobu
          ? (osoby.data?.items ?? []).map((o) => {
              const zvolena = vybrana?.osoba.twin_id === o.twin_id;
              return (
                <li key={o.twin_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={zvolena}
                    className={`w-full p-3 text-left text-sm hover:bg-muted ${zvolena ? "bg-muted" : ""}`}
                    onClick={() => setVybrana({ ucet: prirazeni.ucet, osoba: { twin_id: o.twin_id, label: jmenoOsoby(o) } })}
                  >
                    <span className="font-medium">{jmenoOsoby(o)}</span>{" "}
                    <span className="text-xs text-muted-foreground">· {o.entity_type}</span>
                    {o.kroky && o.kroky.celkem > 0 ? (
                      <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                        {t("admin.people.persons.tasks", { total: o.kroky.celkem, pending: o.kroky.ceka })}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })
          : (ucty.data?.items ?? []).map((u) => {
              const zvolena = vybrana?.ucet.user_id === u.user_id;
              return (
                <li key={u.user_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={zvolena}
                    className={`w-full p-3 text-left text-sm hover:bg-muted ${zvolena ? "bg-muted" : ""}`}
                    onClick={() =>
                      prirazeni.strana === "osoba" &&
                      setVybrana({ ucet: u, osoba: { twin_id: prirazeni.osoba.twin_id, label: jmenoOsoby(prirazeni.osoba) } })
                    }
                  >
                    <span className="font-medium">{jmenoUctu(u)}</span>
                    {u.jmeno && u.email ? <span className="ml-2 text-xs text-muted-foreground">{u.email}</span> : null}
                    {u.osoba ? (
                      <Badge variant="outline" className="ml-2">
                        {t("admin.people.assign.willMove", { person: u.osoba.label || u.osoba.twin_id })}
                      </Badge>
                    ) : null}
                  </button>
                </li>
              );
            })}
      </ul>
      <DialogFooter>
        <Button variant="ghost" onClick={onZavrit}>
          {t("admin.people.cancel")}
        </Button>
        <Button disabled={!vybrana || probiha} onClick={() => vybrana && onPriradit(vybrana.ucet, vybrana.osoba)}>
          {t("admin.people.assign.confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
