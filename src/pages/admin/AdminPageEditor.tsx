import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { History, BookTemplate } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminWebPage,
  useUpdateWebPageCanvas,
} from "@/hooks/useAdminWebPages";
import { usePageAssetUpload } from "@/hooks/usePageAssetUpload";
import { useCreatePageVersion, usePageVersions, useRestorePageVersion } from "@/hooks/usePageVersions";
import { useApplyPageTemplate, usePageTemplates, useSavePageAsTemplate } from "@/hooks/usePageTemplates";
import { safeError } from "@/lib/security/safeLogger";
import { CanvasEditor, type CanvasSavePayload } from "@/components/admin/page-builder/CanvasEditor";
import type { WebPageAdminDetail } from "@/lib/schemas/webPageSchemas";

const PUBLISH_VERSION_LABEL = "publish";

interface EditablePageSettings {
  background: string;
  className: string;
  styleJson: string;
}

function getEditablePageSettings(raw: unknown): EditablePageSettings {
  if (!raw || typeof raw !== "object") {
    return { background: "", className: "", styleJson: "" };
  }
  const rawRecord = raw as Record<string, unknown>;
  const styleValue = rawRecord.style;
  const styleRecord =
    styleValue && typeof styleValue === "object" && !Array.isArray(styleValue)
      ? styleValue as Record<string, unknown>
      : null;
  return {
    background: typeof rawRecord.background === "string" ? rawRecord.background : "",
    className: typeof rawRecord.className === "string" ? rawRecord.className : "",
    styleJson: styleRecord ? JSON.stringify(styleRecord, null, 2) : "",
  };
}

/**
 * ⛔ NEZNÁMÉ KLÍČE SE ZACHOVÁVAJÍ, NEMAŽOU.
 *
 * Tahle funkce dřív skládala `page_settings` od nuly ze tří editovatelných
 * polí — a všechno ostatní tím při uložení zmizelo. Naměřený dopad: veřejné
 * stránky nesou `chrome: "none"` (bez něj přes ně WebPageShell položí lištu
 * Studia s košíkem a Sign In a překryje navigaci webu, viz 2026-08-29).
 * Stačilo tedy stránku otevřít v editoru a uložit — a web se rozbil, aniž by
 * autor cokoli změnil. Vada se tehdy zahojila přeseedováním, ne opravou.
 *
 * Sdílené útržky přidávají `role: "partial"`, který má tutéž povahu: kdyby se
 * ztratil, změnil by se útržek zpátky na stránku a hlavička by se začala
 * servírovat na vlastní adrese.
 *
 * Editor proto spravuje jen to, co UMÍ zobrazit, a zbytek předává beze změny.
 * Prázdné pole klíč ODSTRANÍ (autor ho vymazal záměrně) — ale jen ten svůj.
 */
function buildPageSettings(
  settings: EditablePageSettings,
  puvodni: unknown,
): Record<string, unknown> {
  const nextSettings: Record<string, unknown> =
    puvodni && typeof puvodni === "object" && !Array.isArray(puvodni)
      ? { ...(puvodni as Record<string, unknown>) }
      : {};

  // Tři pole, která editor zobrazuje: prázdná hodnota = smazat, jinak nastavit.
  if (settings.background.trim()) nextSettings.background = settings.background.trim();
  else delete nextSettings.background;

  if (settings.className.trim()) nextSettings.className = settings.className.trim();
  else delete nextSettings.className;

  if (settings.styleJson.trim()) {
    const parsed = JSON.parse(settings.styleJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("builder.pageSettings.invalidJson");
    }
    nextSettings.style = parsed;
  } else {
    delete nextSettings.style;
  }

  return nextSettings;
}

/**
 * Web-page authoring screen. The GrapesJS shell + save + i18n extraction live in
 * the shared CanvasEditor; this wrapper supplies the page-specific concerns:
 * the page load/save RPC, page settings, version history, and templates.
 */
export default function AdminPageEditor() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data, isLoading } = useAdminWebPage(id ?? "");
  const page = data as unknown as WebPageAdminDetail | null | undefined;
  const updateCanvas = useUpdateWebPageCanvas();
  const { uploadAsset } = usePageAssetUpload();

  const createVersion = useCreatePageVersion();
  const restoreVersion = useRestorePageVersion();
  const { data: versions } = usePageVersions(id);
  const { data: templates } = usePageTemplates();
  const saveAsTemplate = useSavePageAsTemplate();
  const applyTemplate = useApplyPageTemplate();

  const [showVersions, setShowVersions] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [pageSettings, setPageSettings] = useState<EditablePageSettings>({
    background: "", className: "", styleJson: "",
  });

  useEffect(() => {
    setPageSettings(getEditablePageSettings(page?.page_settings));
  }, [page?.page_settings]);

  const handleSave = useCallback(
    async ({ canvasData, canvasHtml, canvasCss, publish }: CanvasSavePayload) => {
      if (!id) return;
      const normalizedPageSettings = buildPageSettings(pageSettings, page?.page_settings); // may throw invalidJson
      await updateCanvas.mutateAsync({
        id,
        canvas_data: canvasData as Record<string, unknown>,
        canvas_html: canvasHtml,
        canvas_css: canvasCss,
        page_settings: normalizedPageSettings,
        publish,
      });
      if (publish) {
        createVersion.mutate({ label: PUBLISH_VERSION_LABEL, pageId: id });
        toast({ title: t("builder.actions.publish"), description: t("builder.status.saved") });
      }
    },
    [createVersion, id, pageSettings, t, toast, updateCanvas],
  );

  const handleSaveError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      toast({
        title: t("builder.actions.save"),
        description:
          message === "builder.pageSettings.invalidJson"
            ? t("builder.pageSettings.invalidJson")
            : t("builder.status.error"),
        variant: "destructive",
      });
    },
    [t, toast],
  );

  const handleRestoreVersion = useCallback(
    async (versionId: string) => {
      if (!id) return;
      try {
        await restoreVersion.mutateAsync({ pageId: id, versionId });
        toast({ title: t("builder.versions.restored"), description: t("builder.versions.restoredDesc") });
        setShowVersions(false);
      } catch (error) {
        safeError("AdminPageEditor.restoreVersion", error);
        toast({ title: t("builder.status.error"), description: t("builder.versions.restoreError"), variant: "destructive" });
      }
    },
    [id, restoreVersion, t, toast],
  );

  const handleSaveAsTemplate = useCallback(async () => {
    if (!id || !templateName.trim()) return;
    try {
      await saveAsTemplate.mutateAsync({ name: templateName.trim(), pageId: id });
      toast({ title: t("builder.templates.saved"), description: t("builder.templates.savedDesc") });
      setTemplateName("");
      setShowTemplates(false);
    } catch (error) {
      safeError("AdminPageEditor.saveAsTemplate", error);
      toast({ title: t("builder.status.error"), description: t("builder.templates.saveError"), variant: "destructive" });
    }
  }, [id, saveAsTemplate, t, templateName, toast]);

  const handleApplyTemplate = useCallback(
    async (templateId: string) => {
      if (!id) return;
      try {
        await applyTemplate.mutateAsync({ pageId: id, templateId });
        toast({ title: t("builder.templates.applied"), description: t("builder.templates.appliedDesc") });
        setShowTemplates(false);
      } catch (error) {
        safeError("AdminPageEditor.applyTemplate", error);
        toast({ title: t("builder.status.error"), description: t("builder.templates.applyError"), variant: "destructive" });
      }
    },
    [applyTemplate, id, t, toast],
  );

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  if (!page) {
    return <div className="p-6 text-center text-muted-foreground">{t("admin.pages.notFound")}</div>;
  }

  return (
    <CanvasEditor
      canvasData={page.canvas_data}
      canvasHtml={page.canvas_html}
      canvasCss={page.canvas_css}
      onSave={handleSave}
      onError={handleSaveError}
      isSaving={updateCanvas.isPending}
      assetUpload={id ? uploadAsset : undefined}
      backTo="/admin/pages"
      headerCenter={
        <>
          <span className="text-sm font-medium text-muted-foreground">/{page.slug}</span>
          <Badge variant={page.status === "published" ? "default" : "secondary"}>{page.status}</Badge>
        </>
      }
      toolbarExtras={
        <>
          <Button variant={showVersions ? "secondary" : "ghost"} size="sm"
            onClick={() => { setShowVersions(!showVersions); setShowTemplates(false); }}
            title={t("builder.versions.title")}>
            <History className="h-4 w-4" />
          </Button>
          <Button variant={showTemplates ? "secondary" : "ghost"} size="sm"
            onClick={() => { setShowTemplates(!showTemplates); setShowVersions(false); }}
            title={t("builder.templates.title")}>
            <BookTemplate className="h-4 w-4" />
          </Button>
        </>
      }
      belowToolbar={
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-b border-border px-3 py-2 bg-background/40">
            <div className="space-y-1">
              <Label htmlFor="page-settings-background">{t("builder.pageSettings.background")}</Label>
              <Input id="page-settings-background" value={pageSettings.background}
                onChange={(e) => setPageSettings((c) => ({ ...c, background: e.target.value }))}
                placeholder={t("builder.pageSettings.backgroundPlaceholder")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="page-settings-class">{t("builder.pageSettings.className")}</Label>
              <Input id="page-settings-class" value={pageSettings.className}
                onChange={(e) => setPageSettings((c) => ({ ...c, className: e.target.value }))}
                placeholder={t("builder.pageSettings.classNamePlaceholder")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="page-settings-style-json">{t("builder.pageSettings.styleJson")}</Label>
              <Input id="page-settings-style-json" value={pageSettings.styleJson}
                onChange={(e) => setPageSettings((c) => ({ ...c, styleJson: e.target.value }))}
                placeholder={t("builder.pageSettings.styleJsonPlaceholder")} />
            </div>
          </div>

          {showVersions && (
            <div className="border-b border-border px-3 py-2 bg-muted/30 max-h-48 overflow-y-auto">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {t("builder.versions.title")}
              </p>
              {versions && versions.length > 0 ? (
                <div className="space-y-1">
                  {versions.map((v) => (
                    <div key={v.id} className="flex items-center justify-between text-xs py-1 px-1 rounded hover:bg-muted/40">
                      <span>
                        v{v.version_number}
                        {v.label && <span className="text-muted-foreground ml-1">({v.label})</span>}
                        <span className="text-muted-foreground ml-2">{new Date(v.created_at).toLocaleString()}</span>
                      </span>
                      <Button variant="ghost" size="sm" className="h-6 text-xs"
                        onClick={() => void handleRestoreVersion(v.id)} disabled={restoreVersion.isPending}>
                        {t("builder.versions.restore")}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("builder.versions.none")}</p>
              )}
            </div>
          )}

          {showTemplates && (
            <div className="border-b border-border px-3 py-2 bg-muted/30 max-h-64 overflow-y-auto">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {t("builder.templates.title")}
              </p>
              <div className="flex items-center gap-2 mb-3">
                <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)}
                  placeholder={t("builder.templates.namePlaceholder")} className="h-7 text-xs" />
                <Button variant="outline" size="sm" className="h-7 text-xs shrink-0"
                  onClick={() => void handleSaveAsTemplate()}
                  disabled={saveAsTemplate.isPending || !templateName.trim()}>
                  {t("builder.templates.saveAs")}
                </Button>
              </div>
              {templates && templates.length > 0 ? (
                <div className="space-y-1">
                  {templates.map((tpl) => (
                    <div key={tpl.id} className="flex items-center justify-between text-xs py-1 px-1 rounded hover:bg-muted/40">
                      <span>
                        {tpl.name}
                        {tpl.description && <span className="text-muted-foreground ml-1">— {tpl.description}</span>}
                      </span>
                      <Button variant="ghost" size="sm" className="h-6 text-xs"
                        onClick={() => void handleApplyTemplate(tpl.id)} disabled={applyTemplate.isPending}>
                        {t("builder.templates.apply")}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("builder.templates.none")}</p>
              )}
            </div>
          )}
        </>
      }
    />
  );
}
