import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Database, FolderInput, GitMerge, History, Info, LayoutGrid, Link2, Undo2, Unlink, UserRound, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/useDebounce";
import {
  OsobaMaJinyUcet,
  useHrUcty,
  useOdvazatUcet,
  useOsobyBezUctu,
  usePriraditUcet,
  useDruhyOsob,
  useRozhodnutiSjednoceni,
  useVratitRozhodnuti,
  type OsobaBezUctu,
  type RozhodnutiSjednoceni,
  type UcetHr,
} from "@/hooks/useHrLideUcty";
import { VyberProtistrany } from "@/components/admin/lide/VyberProtistrany";
import { SjednotitOsobu, type Kanon } from "@/components/admin/lide/SjednotitOsobu";
import { SekceUctu } from "@/components/admin/lide/SekceUctu";
import { VazbyUctu } from "@/components/admin/lide/VazbyUctu";
import { ZdrojeUctu } from "@/components/admin/lide/ZdrojeUctu";
import { jmenoOsoby, jmenoUctu } from "@/lib/hr/jmena";

/**
 * Lidé a účty — HR propojuje účty platformy (Keycloak) s osobami z twinverse.
 *
 * ⭐ Zadání majitele (2026-09-23): „obrazovka speciálně pro HR, kdy účty v KC
 * propojujeme s entitami z twinverse". Co účet uvidí (dodáky, úkoly), plyne
 * z téhle vazby — ne z role (oprávnění z vazeb).
 */
type Prirazeni = { strana: "ucet"; ucet: UcetHr } | { strana: "osoba"; osoba: OsobaBezUctu };

export default function AdminLideUcty() {
  const { t } = useTranslation();
  const [hledatUcet, setHledatUcet] = useState("");
  const [hledatOsobu, setHledatOsobu] = useState("");
  const [typ, setTyp] = useState<string | null>(null);
  const [prirazeni, setPrirazeni] = useState<Prirazeni | null>(null);
  const [odvazat, setOdvazat] = useState<UcetHr | null>(null);
  const [sjednotit, setSjednotit] = useState<Kanon | null>(null);
  const [vratit, setVratit] = useState<RozhodnutiSjednoceni | null>(null);
  const [duvodVraceni, setDuvodVraceni] = useState("");
  const [sekceUctu, setSekceUctu] = useState<UcetHr | null>(null);
  const [vazbyUctu, setVazbyUctu] = useState<UcetHr | null>(null);
  const [zdrojeUctu, setZdrojeUctu] = useState<UcetHr | null>(null);

  const ucty = useHrUcty(useDebounce(hledatUcet.trim(), 300));
  const osoby = useOsobyBezUctu(useDebounce(hledatOsobu.trim(), 300), typ);
  const priradit = usePriraditUcet();
  const odvaz = useOdvazatUcet();
  const rozhodnuti = useRozhodnutiSjednoceni();
  const vratitMut = useVratitRozhodnuti();

  // Druhy se neodhadují z kódu ani z načtené stránky — celá nabídka je z dat.
  const druhy = useDruhyOsob();

  const provedPrirazeni = (ucet: UcetHr, osoba: { twin_id: string; label: string }) => {
    priradit.mutate(
      { userId: ucet.user_id, twinId: osoba.twin_id },
      {
        onSuccess: (r) => {
          setPrirazeni(null);
          if (r.already) {
            toast.info(t("admin.people.assign.already"));
            return;
          }
          toast.success(t("admin.people.assign.done", { account: jmenoUctu(ucet), person: osoba.label }), {
            description: r.predchozi_twin_id ? t("admin.people.assign.moved") : undefined,
          });
        },
        onError: (e) =>
          toast.error(e instanceof OsobaMaJinyUcet ? t("admin.people.assign.otherAccount") : t("admin.people.assign.failed", { reason: e.message })),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.people.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("admin.people.subtitle")}</p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{t("admin.people.notice.title")}</AlertTitle>
        <AlertDescription>{t("admin.people.notice.body")}</AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              {t("admin.people.accounts.title")}
            </CardTitle>
            <CardDescription>{t("admin.people.accounts.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              aria-label={t("admin.people.accounts.search")}
              placeholder={t("admin.people.accounts.search")}
              value={hledatUcet}
              onChange={(e) => setHledatUcet(e.target.value)}
            />
            {ucty.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("admin.people.loading")}</p>
            ) : ucty.isError || !ucty.data ? (
              <p className="text-sm text-destructive">{t("admin.people.loadError")}</p>
            ) : ucty.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("admin.people.accounts.empty")}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {ucty.data.items.map((u) => (
                  <li key={u.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{jmenoUctu(u)}</p>
                      {u.jmeno && u.email ? <p className="truncate text-xs text-muted-foreground">{u.email}</p> : null}
                    </div>
                    <Button variant="ghost" size="sm" aria-label={t("admin.people.sections.action")} onClick={() => setSekceUctu(u)}>
                      <LayoutGrid className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={t("admin.people.sources.action")} onClick={() => setZdrojeUctu(u)}>
                      <FolderInput className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={t("admin.people.bindings.action")} onClick={() => setVazbyUctu(u)}>
                      <Database className="h-4 w-4" />
                    </Button>
                    {u.osoba ? (
                      <>
                        <Badge variant="secondary" className="gap-1">
                          <UserRound className="h-3 w-3" />
                          {u.osoba.label || u.osoba.twin_id}
                          <span className="text-muted-foreground">· {u.osoba.entity_type}</span>
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("admin.people.merge.action")}
                          onClick={() =>
                            u.osoba &&
                            setSjednotit({ twin_id: u.osoba.twin_id, label: u.osoba.label || u.osoba.twin_id, entity_type: u.osoba.entity_type })
                          }
                        >
                          <GitMerge className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setOdvazat(u)} aria-label={t("admin.people.accounts.unbind")}>
                          <Unlink className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-muted-foreground">{t("admin.people.accounts.none")}</span>
                        <Button variant="outline" size="sm" onClick={() => setPrirazeni({ strana: "ucet", ucet: u })}>
                          <Link2 className="h-4 w-4" />
                          {t("admin.people.accounts.assign")}
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {ucty.data?.limitovano ? <p className="text-xs text-muted-foreground">{t("admin.people.limited", { count: ucty.data.count })}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="w-5 h-5" />
              {t("admin.people.persons.title")}
            </CardTitle>
            <CardDescription>{t("admin.people.persons.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label={t("admin.people.persons.search")}
                placeholder={t("admin.people.persons.search")}
                value={hledatOsobu}
                onChange={(e) => setHledatOsobu(e.target.value)}
              />
              <select
                aria-label={t("admin.people.persons.type")}
                className="h-10 rounded-md border bg-background px-3 text-sm sm:w-48"
                value={typ ?? ""}
                onChange={(e) => setTyp(e.target.value || null)}
              >
                <option value="">{t("admin.people.persons.allTypes")}</option>
                {(druhy.data ?? []).map((d) => (
                  <option key={d.entity_type} value={d.entity_type}>
                    {t("admin.people.persons.typeOption", { type: d.entity_type, count: d.bez_uctu })}
                  </option>
                ))}
              </select>
            </div>
            {osoby.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("admin.people.loading")}</p>
            ) : osoby.isError || !osoby.data ? (
              <p className="text-sm text-destructive">{t("admin.people.loadError")}</p>
            ) : osoby.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("admin.people.persons.empty")}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {osoby.data.items.map((o) => (
                  <li key={o.twin_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate font-medium">
                        {jmenoOsoby(o)} <span className="text-xs font-normal text-muted-foreground">· {o.entity_type}</span>
                      </p>
                      <div className="flex flex-wrap gap-1">
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
                        {o.pozvanky.some((p) => p.is_active) ? <Badge>{t("admin.people.persons.invitation")}</Badge> : null}
                        {o.navrhy_uctu.length > 0 ? <Badge>{t("admin.people.persons.proposal")}</Badge> : null}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("admin.people.merge.action")}
                      onClick={() => setSjednotit({ twin_id: o.twin_id, label: jmenoOsoby(o), entity_type: o.entity_type })}
                    >
                      <GitMerge className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPrirazeni({ strana: "osoba", osoba: o })}>
                      <Link2 className="h-4 w-4" />
                      {t("admin.people.persons.assign")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {osoby.data?.limitovano ? <p className="text-xs text-muted-foreground">{t("admin.people.limited", { count: osoby.data.count })}</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            {t("admin.people.decisions.title")}
          </CardTitle>
          <CardDescription>{t("admin.people.decisions.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {rozhodnuti.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("admin.people.loading")}</p>
          ) : rozhodnuti.isError || !rozhodnuti.data ? (
            <p className="text-sm text-destructive">{t("admin.people.loadError")}</p>
          ) : rozhodnuti.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("admin.people.decisions.empty")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {rozhodnuti.data.map((d) => (
                <li key={d.decision_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs tabular-nums text-muted-foreground">{new Date(d.kdy).toLocaleString()}</p>
                    <p className="break-words">{d.souhrn}</p>
                  </div>
                  {d.vraceno ? (
                    <Badge variant="outline">{t("admin.people.decisions.reverted", { date: new Date(d.vraceno.kdy).toLocaleString() })}</Badge>
                  ) : d.vratne ? (
                    <Button variant="outline" size="sm" onClick={() => { setDuvodVraceni(""); setVratit(d); }}>
                      <Undo2 className="h-4 w-4" />
                      {t("admin.people.decisions.revert")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <SjednotitOsobu kanon={sjednotit} onZavrit={() => setSjednotit(null)} />

      <SekceUctu ucet={sekceUctu} onClose={() => setSekceUctu(null)} />
      <VazbyUctu ucet={vazbyUctu} onClose={() => setVazbyUctu(null)} />
      <ZdrojeUctu ucet={zdrojeUctu} onClose={() => setZdrojeUctu(null)} />

      <AlertDialog open={vratit !== null} onOpenChange={(o) => !o && setVratit(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.people.decisions.revertTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.people.decisions.revertBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label={t("admin.people.decisions.reason")}
            placeholder={t("admin.people.decisions.reason")}
            value={duvodVraceni}
            onChange={(e) => setDuvodVraceni(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.people.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!duvodVraceni.trim() || vratitMut.isPending}
              onClick={() => {
                if (!vratit) return;
                vratitMut.mutate(
                  { decisionId: vratit.decision_id, duvod: duvodVraceni.trim() },
                  {
                    onSuccess: (r) =>
                      toast.success(
                        t("admin.people.decisions.revertDone", { records: r.twinu ?? 0, tasks: r.kroku_zpet ?? 0, skipped: r.preskoceno_zmenene ?? 0 }),
                      ),
                    onError: (e) => toast.error(t("admin.people.decisions.revertFailed", { reason: e.message })),
                  },
                );
                setVratit(null);
              }}
            >
              {t("admin.people.decisions.revertConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VyberProtistrany
        prirazeni={prirazeni}
        probiha={priradit.isPending}
        onZavrit={() => setPrirazeni(null)}
        onPriradit={provedPrirazeni}
      />

      <AlertDialog open={odvazat !== null} onOpenChange={(o) => !o && setOdvazat(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.people.unbind.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {odvazat?.osoba
                ? t("admin.people.unbind.body", { account: jmenoUctu(odvazat), person: odvazat.osoba.label || odvazat.osoba.twin_id })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.people.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const ref = odvazat?.osoba?.ref_id;
                if (!ref) return;
                odvaz.mutate(ref, {
                  onSuccess: () => toast.success(t("admin.people.unbind.done")),
                  onError: (e) => toast.error(t("admin.people.unbind.failed", { reason: e.message })),
                });
                setOdvazat(null);
              }}
            >
              {t("admin.people.unbind.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
