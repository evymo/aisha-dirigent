import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { History, Send, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminNewsArticle,
  useUpdateNewsArticleCanvas,
} from "@/hooks/useAdminNewsArticleCanvas";
import { useAdminNewsArticles } from "@/hooks/useAdminNewsArticles";
import { useNewsArticleVersions, useRestoreNewsArticleVersion } from "@/hooks/useNewsArticleVersions";
import { useMediaAssets, verejnaAdresaMedia } from "@/hooks/useMediaAssets";
import { CanvasEditor, type CanvasSavePayload } from "@/components/admin/page-builder/CanvasEditor";
import { usePageAssetUpload } from "@/hooks/usePageAssetUpload";
import { jeKonfliktUlozeni } from "@/lib/novinky/konflikt";
import { safeError } from "@/lib/security/safeLogger";

/**
 * News-article authoring screen. Reuses the shared CanvasEditor (so authoring +
 * the i18n string-extraction that makes the article multilingual are identical
 * to a web page); supplies the article load/save RPC, the version history and
 * the draft/publish flow.
 *
 * 2026-09-24 — bezpečnost autosave:
 *   • editor hydratuje z KONCEPTU, je-li (`article.draft`), jinak ze živého stavu;
 *   • uložení posílá razítko z načtení; konflikt (409) se nabídne k řešení,
 *     ne tiše přepíše;
 *   • ukládá se jen když se něco změnilo (otisk plátna) — autosave po undo
 *     zpět na uložený stav neposílá totéž znovu;
 *   • u zveřejněného článku jde uložení do konceptu (server), „Zveřejnit změny"
 *     ho přelije na web.
 */
export default function AdminNewsArticleEditor() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: article, isLoading } = useAdminNewsArticle(id ?? "");
  const updateCanvas = useUpdateNewsArticleCanvas();
  const { publishAsync, discardDraftAsync, isPublishing } = useAdminNewsArticles();
  const { data: versions } = useNewsArticleVersions(id);
  const restoreVersion = useRestoreNewsArticleVersion();
  const { data: media } = useMediaAssets("", 60);
  // ⛔ BEZ TOHOHLE NEŠLO DO NOVINKY VLOŽIT OBRÁZEK Z POČÍTAČE (naměřeno 2026-09-21).
  // `CanvasEditor` předává `assetUpload` do `assetManager.uploadFile`; když ho
  // nedostane, GrapesJS nechá ve správci obrázků jen pole „vlož URL".
  const { uploadAsset } = usePageAssetUpload();

  const [showVersions, setShowVersions] = useState(false);
  const [konflikt, setKonflikt] = useState<CanvasSavePayload | null>(null);
  // Razítko stavu, který editor upravuje. Po každém uložení se přebírá z odpovědi.
  const stampRef = useRef<string | null>(null);
  const lastSavedRef = useRef<string | null>(null);
  if (article && stampRef.current === null) stampRef.current = article.edit_stamp;

  const existingAssets = (media ?? []).map(verejnaAdresaMedia);

  const otisk = (p: CanvasSavePayload) => JSON.stringify([p.canvasHtml, p.canvasCss, p.canvasData]);

  // Bez ruční memoizace (React Compiler). Obslužné funkce sahají jen na refy a
  // stabilní mutace, takže i uzávěr zachycený editorem při vzniku zůstává správný.
  const uloz = async (payload: CanvasSavePayload, expectedStamp: string | null) => {
    if (!id) return;
    const stamp = await updateCanvas.mutateAsync({
      id,
      canvas_data: payload.canvasData,
      canvas_html: payload.canvasHtml,
      canvas_css: payload.canvasCss,
      publish: payload.publish,
      expected_stamp: expectedStamp,
    });
    stampRef.current = stamp;
    lastSavedRef.current = otisk(payload);
    if (payload.publish) {
      toast({ title: t("builder.actions.publish"), description: t("builder.status.saved") });
      queryClient.invalidateQueries({ queryKey: ["admin-news-article", id] });
    }
  };

  const handleSave = async (payload: CanvasSavePayload) => {
    if (!id) return;
    // Nic se nezměnilo od posledního uložení → neposílat (undo zpět na uložený stav).
    if (!payload.publish && lastSavedRef.current === otisk(payload)) return;
    try {
      await uloz(payload, stampRef.current);
    } catch (err) {
      if (jeKonfliktUlozeni(err)) {
        setKonflikt(payload);
        return;
      }
      throw err;
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!id) return;
    try {
      const stamp = await restoreVersion.mutateAsync({ articleId: id, versionId });
      stampRef.current = stamp;
      lastSavedRef.current = null;
      toast({
        title: t("admin.newsArticles.versions.restored"),
        description: article?.is_published ? t("admin.newsArticles.versions.restoredToDraft") : undefined,
      });
    } catch (error) {
      safeError("AdminNewsArticleEditor.restoreVersion", error);
      toast({ title: t("builder.status.error"), description: t("admin.newsArticles.versions.restoreError"), variant: "destructive" });
    }
  };

  const handlePublishDraft = async () => {
    if (!id) return;
    try {
      const stamp = await publishAsync({ id, expectedStamp: stampRef.current });
      stampRef.current = stamp;
      queryClient.invalidateQueries({ queryKey: ["admin-news-article", id] });
    } catch (err) {
      if (!jeKonfliktUlozeni(err)) safeError("AdminNewsArticleEditor.publish", err);
      else toast({ title: t("admin.newsArticles.conflict.title"), description: t("admin.newsArticles.errors.conflict"), variant: "destructive" });
    }
  };

  const handleDiscardDraft = async () => {
    if (!id) return;
    const stamp = await discardDraftAsync(id);
    stampRef.current = stamp;
    lastSavedRef.current = null;
    queryClient.invalidateQueries({ queryKey: ["admin-news-article", id] });
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        {t("admin.newsArticles.notFound", "Article not found")}
      </div>
    );
  }

  const draft = article.draft;
  const kindLabel = (kind: string) => t(`admin.newsArticles.versions.kinds.${kind}`, kind);

  return (
    <>
      <CanvasEditor
        // Remount při změně razítka ze serveru (obnova verze, zahození konceptu, načtení
        // po konfliktu): plátno se hydratuje jen při vzniku editoru.
        key={article.edit_stamp}
        canvasData={draft?.canvas_data ?? article.canvas_data}
        canvasHtml={draft?.canvas_html ?? article.canvas_html}
        canvasCss={draft?.canvas_css ?? article.canvas_css}
        onSave={handleSave}
        isSaving={updateCanvas.isPending || isPublishing}
        assetUpload={uploadAsset}
        existingAssets={existingAssets}
        // Texty novinky žijí v namespacu `news` (tam míří title_key/content_key
        // /excerpt_key článku), ne ve `web`. Klíče se proto razí s prefixem
        // `news.<slug>` — `PageRenderer` odvozuje namespace z prvního segmentu
        // klíče, takže prefix a namespace zápisu se MUSÍ shodovat.
        i18nNamespace="news"
        i18nKeyScope={article.slug}
        backTo="/admin/news-articles"
        headerCenter={
          <>
            <span className="text-sm font-medium text-muted-foreground">/{article.slug}</span>
            <Badge variant={article.is_published ? "default" : "secondary"}>
              {article.is_published
                ? t("admin.newsArticles.published", "published")
                : t("admin.newsArticles.draft", "draft")}
            </Badge>
            {draft ? <Badge variant="outline">{t("admin.newsArticles.list.draftPending")}</Badge> : null}
          </>
        }
        toolbarExtras={
          <>
            {draft ? (
              <>
                <Button variant="default" size="sm" onClick={() => void handlePublishDraft()} disabled={isPublishing} title={t("admin.newsArticles.form.publishChanges")}>
                  <Send className="h-4 w-4 mr-1" />
                  {t("admin.newsArticles.form.publishChanges")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void handleDiscardDraft()} title={t("admin.newsArticles.form.discardDraft")}>
                  <Undo2 className="h-4 w-4 mr-1" />
                  {t("admin.newsArticles.form.discardDraft")}
                </Button>
              </>
            ) : null}
            <Button variant={showVersions ? "secondary" : "ghost"} size="sm" onClick={() => setShowVersions((v) => !v)} title={t("admin.newsArticles.versions.title")}>
              <History className="h-4 w-4" />
            </Button>
          </>
        }
        belowToolbar={
          <>
            {draft ? (
              <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                {t("admin.newsArticles.form.hasDraft")}
              </div>
            ) : null}
            {showVersions ? (
              <div className="border-b border-border bg-background px-3 py-2">
                <p className="mb-1 text-xs font-medium">{t("admin.newsArticles.versions.title")}</p>
                {versions && versions.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto">
                    {versions.map((v) => (
                      <div key={v.id} className="flex items-center justify-between rounded px-1 py-1 text-xs hover:bg-muted/40">
                        <span>
                          v{v.version_number}
                          <span className="ml-1 text-muted-foreground">({kindLabel(v.kind)}{v.label ? ` · ${v.label}` : ""})</span>
                          <span className="ml-2 text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span>
                        </span>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => void handleRestoreVersion(v.id)} disabled={restoreVersion.isPending}>
                          {t("admin.newsArticles.versions.restore")}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("admin.newsArticles.versions.none")}</p>
                )}
              </div>
            ) : null}
          </>
        }
      />

      <AlertDialog open={!!konflikt} onOpenChange={(o) => !o && setKonflikt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.newsArticles.conflict.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.newsArticles.conflict.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setKonflikt(null);
                stampRef.current = null;
                lastSavedRef.current = null;
                queryClient.invalidateQueries({ queryKey: ["admin-news-article", id] });
              }}
            >
              {t("admin.newsArticles.conflict.reload")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const p = konflikt;
                setKonflikt(null);
                if (p) void uloz(p, null).catch((err) => safeError("AdminNewsArticleEditor.overwrite", err));
              }}
            >
              {t("admin.newsArticles.conflict.overwrite")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
