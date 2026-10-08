/**
 * Dialog „Spravovat štítky“ v administraci novinek (2026-10-02, naměřeno na instanci).
 *
 * Správkyně webu chtěla štítky spravovat sama: přejmenovat (např. „Rodina“ →
 * „Lidé“), sloučit dva do jednoho a nastavit, jak se štítek na webu jmenuje
 * v každém jazyce. Nový štítek vznikne tak jako dosud — napíše se k článku.
 *
 * Přejmenování na existující štítek je SLOUČENÍ — dialog se zeptá. Tvar nového
 * štítku hlídá normalizujStitek (stejně jako pole štítků u článku).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pencil, Languages } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNewsTagNames, useNewsTagsAdmin, useRenameNewsTag } from "@/hooks/useAdminNewsTags";
import { useUpsertTranslations } from "@/hooks/useDynamicTranslations";
import { useSupportedLanguages } from "@/hooks/useSupportedLanguages";
import { NAMESPACE_STITKU, normalizujStitek, popisekStitku } from "@/lib/novinky/stitky";
import { safeError } from "@/lib/security/safeLogger";
import { jeKodJazyka } from "@/lib/i18n/kodJazyka";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SpravaStitkuDialog({ open, onOpenChange }: Props) {
  const { t, i18n } = useTranslation();
  const { data: stitky, isLoading } = useNewsTagsAdmin(open);
  const hodnoty = (stitky ?? []).map((s) => s.tag);
  const { data: nazvy } = useNewsTagNames(open ? hodnoty : []);
  const { data: jazyky } = useSupportedLanguages(true);
  const prejmenuj = useRenameNewsTag();
  const ulozNazvy = useUpsertTranslations();

  const [upravovany, setUpravovany] = useState<string | null>(null);
  const [novaHodnota, setNovaHodnota] = useState("");
  const [slucit, setSlucit] = useState<{ z: string; na: string } | null>(null);
  const [nazvyOtevrene, setNazvyOtevrene] = useState<string | null>(null);
  const [rozepsaneNazvy, setRozepsaneNazvy] = useState<Record<string, string>>({});

  const seznamJazyku = ((jazyky ?? []) as Array<{ code: string; name_native: string }>).filter((j) => jeKodJazyka(j.code));
  const nazvyProJazyk = (stitek: string) => nazvy?.[stitek] ?? {};
  const zobrazeny = (stitek: string) =>
    popisekStitku(stitek, { [stitek]: nazvyProJazyk(stitek)[i18n.language] ?? nazvyProJazyk(stitek).en });

  const proved = async (z: string, na: string) => {
    try {
      const pocet = await prejmenuj.mutateAsync({ z, na });
      toast.success(t("admin.newsArticles.tags.renamed", { from: z, to: na, count: pocet }));
      setUpravovany(null);
      setSlucit(null);
    } catch (chyba) {
      safeError("SpravaStitkuDialog.rename", chyba);
      toast.error(t("admin.newsArticles.tags.renameError"));
    }
  };

  const potvrdPrejmenovani = (z: string) => {
    const na = normalizujStitek(novaHodnota);
    if (!na || na === z) {
      setUpravovany(null);
      return;
    }
    if (hodnoty.includes(na)) {
      setSlucit({ z, na });
      return;
    }
    void proved(z, na);
  };

  const otevriNazvy = (stitek: string) => {
    setNazvyOtevrene(nazvyOtevrene === stitek ? null : stitek);
    setRozepsaneNazvy({ ...nazvyProJazyk(stitek) });
  };

  const ulozNazvyStitku = async (stitek: string) => {
    const zmeny = seznamJazyku
      .map((j) => ({ locale: j.code, value: (rozepsaneNazvy[j.code] ?? "").trim() }))
      .filter((z) => z.value !== "" && z.value !== (nazvyProJazyk(stitek)[z.locale] ?? ""));
    if (zmeny.length === 0) {
      setNazvyOtevrene(null);
      return;
    }
    try {
      await ulozNazvy.mutateAsync(zmeny.map((z) => ({ key: stitek, locale: z.locale, value: z.value, namespace: NAMESPACE_STITKU })));
      toast.success(t("admin.newsArticles.tags.namesSaved"));
      setNazvyOtevrene(null);
    } catch (chyba) {
      safeError("SpravaStitkuDialog.names", chyba);
      toast.error(t("admin.newsArticles.tags.namesError"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("admin.newsArticles.tags.title")}</DialogTitle>
          <DialogDescription>{t("admin.newsArticles.tags.description")}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : hodnoty.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("admin.newsArticles.tags.none")}</p>
        ) : (
          <ul className="divide-y">
            {(stitky ?? []).map((s) => (
              <li key={s.tag} className="py-2 space-y-2" data-stitek={s.tag}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{zobrazeny(s.tag)}</span>
                  <Badge variant="outline" className="font-mono text-xs">{s.tag}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {t("admin.newsArticles.tags.counts", { count: s.article_count, published: s.published_count })}
                  </span>
                  <span className="ml-auto flex gap-1">
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setUpravovany(s.tag); setNovaHodnota(s.tag); }}
                      aria-label={t("admin.newsArticles.tags.rename")}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => otevriNazvy(s.tag)}
                      aria-label={t("admin.newsArticles.tags.names")}>
                      <Languages className="h-4 w-4" />
                    </Button>
                  </span>
                </div>

                {upravovany === s.tag ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={novaHodnota}
                      onChange={(e) => setNovaHodnota(e.target.value)}
                      aria-label={t("admin.newsArticles.tags.newValue")}
                      className="h-8 max-w-xs"
                      onKeyDown={(e) => { if (e.key === "Enter") potvrdPrejmenovani(s.tag); }}
                    />
                    <span className="text-xs text-muted-foreground">→ {normalizujStitek(novaHodnota) || "—"}</span>
                    <Button type="button" size="sm" onClick={() => potvrdPrejmenovani(s.tag)} disabled={prejmenuj.isPending}>
                      {t("admin.newsArticles.tags.renameConfirm")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setUpravovany(null)}>
                      {t("common.cancel")}
                    </Button>
                  </div>
                ) : null}

                {slucit?.z === s.tag ? (
                  <div role="alert" className="rounded-md border bg-muted/40 p-2 text-sm space-y-2">
                    <p>{t("admin.newsArticles.tags.mergeQuestion", { from: slucit.z, to: slucit.na })}</p>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => void proved(slucit.z, slucit.na)} disabled={prejmenuj.isPending}>
                        {t("admin.newsArticles.tags.mergeConfirm")}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setSlucit(null)}>
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {nazvyOtevrene === s.tag ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {seznamJazyku.map((j) => (
                      <label key={j.code} className="flex items-center gap-2 text-sm">
                        <span className="w-24 shrink-0 text-muted-foreground">{j.name_native}</span>
                        <Input
                          className="h-8"
                          value={rozepsaneNazvy[j.code] ?? ""}
                          placeholder={popisekStitku(s.tag, {})}
                          onChange={(e) => setRozepsaneNazvy((v) => ({ ...v, [j.code]: e.target.value }))}
                        />
                      </label>
                    ))}
                    <div className="sm:col-span-2 flex justify-end">
                      <Button type="button" size="sm" onClick={() => void ulozNazvyStitku(s.tag)} disabled={ulozNazvy.isPending}>
                        {t("admin.newsArticles.tags.saveNames")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
