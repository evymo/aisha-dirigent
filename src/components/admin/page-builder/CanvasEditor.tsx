import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import GjsEditor, { Canvas } from "@grapesjs/react";
import grapesjs from "grapesjs";
// CSS knihovny z BUNDLU (verze z lockfile). Z unpkg ho CSP `style-src 'self'`
// zablokuje — plátno pak nemá absolutní rozložení a spadne na 150 px.
import "grapesjs/dist/css/grapes.min.css";
import type { Editor, ProjectData } from "grapesjs";
import {
  Save, Upload, Loader2, Undo2, Redo2, ArrowLeft,
  Monitor, Tablet, Smartphone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useUpsertTranslations } from "@/hooks/useDynamicTranslations";
import { safeError, safeInfo } from "@/lib/security/safeLogger";
import { aishaBlocksPlugin } from "@/lib/builder/aishaBlocksPlugin";
import { extractI18nFromCanvas } from "@/lib/builder/extractI18nFromCanvas";
import { useGrapesJSi18n } from "@/lib/builder/useGrapesJSi18n";
import { getPageEditorConfig } from "@/lib/builder/editorConfig";
import { EditorSidebar } from "@/components/admin/page-builder/EditorSidebar";
import { ctiLocalePlatna } from "@/lib/builder/canvasLocale";
import { zajistiI18nKlice } from "@/lib/builder/klicePlatna";
import { useVyskaPlatna } from "@/lib/builder/vyskaPlatna";

/**
 * Zdrojová locale plátna. Plátno v seedu i v editoru je psané anglicky a
 * překlady ostatních jazyků vznikají nad ním (svc-web-render i SPA žádají
 * `p_fallback_locale: "en"`). Není to fallback nad konfigurací, ale fakt
 * o obsahu: dokud do plátna nikdo neinjektoval jiný jazyk, JE anglické.
 */
const ZDROJOVA_LOCALE_PLATNA = "en";

const AUTO_SAVE_DELAY_MS = 5000;

/**
 * ⛔ SELHÁNÍ NAHRÁVÁNÍ SE MUSÍ OZVAT (naměřeno 2026-09-21).
 *
 * `assetManager.uploadFile` v `editorConfig` volá předaný handler BEZ `catch`.
 * Výjimka z něj (nepovolený typ, velký soubor, 403 z preflightu) skončila jako
 * neodchycené odmítnutí promise — v konzoli, ne na obrazovce. Autor viděl jen to,
 * že se obrázek „neobjevil". Obal důvod pojmenuje a chybu pustí dál, aby GrapesJS
 * nepřidal do správce obrázek, který nevznikl.
 *
 * Je to funkce MODULU, ne hook: ráčna WP 4.5 (React Compiler) drží ruční
 * memoizaci na klesající křivce, takže nový `useMemo` sem nepatří — a není
 * potřeba, obal se skládá uvnitř už existujícího `useMemo` pro konfiguraci.
 */
function obalNahravani(
  nahrat: (file: File) => Promise<string>,
  toast: ReturnType<typeof useToast>["toast"],
  t: (klic: string) => string,
): (file: File) => Promise<string> {
  return async (file: File): Promise<string> => {
    try {
      return await nahrat(file);
    } catch (chyba) {
      safeError("CanvasEditor.assetUpload", chyba);
      toast({
        title: t("builder.assets.uploadFailed"),
        description: chyba instanceof Error ? chyba.message : undefined,
        variant: "destructive",
      });
      throw chyba;
    }
  };
}

export interface CanvasSavePayload {
  canvasData: unknown;
  canvasHtml: string;
  canvasCss: string;
  publish: boolean;
}

export interface CanvasEditorProps {
  /** Current canvas (GrapesJS ProjectData) to load into the editor. */
  canvasData?: unknown;
  /** Fallback HTML/CSS when no ProjectData exists (seeded/legacy nodes). */
  canvasHtml?: string | null;
  canvasCss?: string | null;
  /** Persist the canvas. The shared core extracts + upserts i18n separately. */
  onSave: (payload: CanvasSavePayload) => Promise<void>;
  /** Disable the save/publish buttons while a mutation is in flight. */
  isSaving?: boolean;
  /** Namespace the extracted canvas strings land in. Must match the renderer
   *  (PageRenderer resolves canvas keys from "web"), so default "web". */
  i18nNamespace?: string;
  /** Asset upload handler wired into the GrapesJS asset manager. */
  assetUpload?: (file: File) => Promise<string>;
  /**
   * Rozlišení uvnitř namespacu (typicky slug uzlu). Když je zadané, editor při
   * RUČNÍM uložení dorazí `data-i18n-key` textům, které ho nemají — teprve tím
   * je text napsaný v editoru přeložitelný (viz klicePlatna.ts).
   *
   * Bez téhle vlastnosti se klíče nerazí. Pro seedované stránky webu je to
   * záměr: jejich klíče přicházejí z `instance-data` a razítko by do sdíleného
   * HTML webu přidalo klíče, které seed nezná (rozešel by se s DB). Nové typy
   * obsahu (novinky) razítko zapínají, protože žádný seed nemají.
   */
  i18nKeyScope?: string;
  /** Where the back button navigates. */
  backTo: string;
  /** Left-of-toolbar node — e.g. the slug + status badge. */
  headerCenter?: ReactNode;
  /** Extra toolbar buttons (e.g. versions / templates) shown before status. */
  toolbarExtras?: ReactNode;
  /** Node-specific panels rendered under the toolbar (settings, dropdowns). */
  belowToolbar?: ReactNode;
  /** Node-specific error mapping (e.g. invalid page-settings JSON). */
  onError?: (error: unknown) => void;
  /** Hand the live editor instance to the parent (for restore/template flows). */
  onEditorReady?: (editor: Editor) => void;
  /** Auto-save on canvas change (default true). */
  autoSave?: boolean;
  /**
   * Adresy už nahraných obrázků (galerie médií) — objeví se ve správci obrázků
   * editoru, aby autor nemusel totéž nahrávat podruhé (2026-09-24).
   */
  existingAssets?: string[];
}

/**
 * Shared GrapesJS canvas editor — the universal authoring core for ANY content
 * node (web pages, news articles, …). It owns the editor lifecycle, canvas load,
 * the save flow, and the i18n string-extraction-on-save that makes content nodes
 * multilingual (canvas text → data-i18n-key → translations, resolved per-locale
 * by PageRenderer). Node-specific concerns (which RPC saves, versions, templates,
 * page settings) are injected via props/slots so each node type composes only
 * what it has.
 */
export function CanvasEditor({
  canvasData,
  canvasHtml,
  canvasCss,
  onSave,
  isSaving,
  i18nNamespace = "web",
  assetUpload,
  i18nKeyScope,
  backTo,
  headerCenter,
  toolbarExtras,
  belowToolbar,
  onError,
  onEditorReady,
  autoSave = true,
  existingAssets,
}: CanvasEditorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const upsertTranslations = useUpsertTranslations();

  const editorRef = useRef<Editor | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cssPoNacteniRef = useRef<string>("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [activeDevice, setActiveDevice] = useState<"Desktop" | "Tablet" | "Mobile">("Desktop");

  useGrapesJSi18n(editorRef.current);

  const handleSave = useCallback(
    async (publish = false, automaticke = false) => {
      const editor = editorRef.current;
      if (!editor) return;

      setSaveStatus("saving");
      try {
        // Klíče se razí PŘED odečtením plátna, aby je nesl i `ProjectData`
        // i `getHtml()` — a jen při ručním uložení, ze stejného důvodu jako
        // zápis překladů níž: pět sekund po kliknutí autor text nedokončil.
        if (i18nKeyScope && !automaticke) {
          const razeni = zajistiI18nKlice(editor, i18nNamespace, i18nKeyScope);
          if (razeni.vyrazeno > 0) {
            safeInfo("CanvasEditor.zajistiI18nKlice", {
              vyrazeno: razeni.vyrazeno,
              meli: razeni.meli,
              namespace: i18nNamespace,
            });
          }
        }

        const projectData = editor.getProjectData();
        const html = editor.getHtml();
        const css = editor.getCss() ?? "";

        // ⛔ CSS SE ULOŽÍ JEN KDYŽ SE V EDITORU ZMĚNILO (naměřeno 2026-09-03,
        // audit U5-1). `getCss()` vydá CSS tak, jak ho editor drží — a i
        // s `keepUnusedStyles` je to JEHO podoba, ne autorův soubor: přeskládané
        // pořadí, jiná normalizace, zahozené komentáře. Když se stylů nikdo
        // nedotkl, jde zpátky původní canvas_css beze změny; jinak by každé
        // otevření stránky tiše přepsalo sdílené CSS webu.
        const cssKUlozeni = css === cssPoNacteniRef.current ? (canvasCss ?? "") : css;

        await onSave({
          canvasData: projectData,
          canvasHtml: html ?? "",
          canvasCss: cssKUlozeni,
          publish,
        });

        // Překlady: jen při RUČNÍM uložení a jen pod locale, ve které plátno
        // doopravdy je (viz useEditorI18nResolver a canvasLocale.ts).
        // Bez injektáže nese plátno zdrojový text, tedy angličtinu seedu;
        // ukládat ho pod jazyk UI administrátora přepisovalo české hodnoty
        // anglickým zdrojem (audit U5-2). Autosave překlady nezapisuje vůbec —
        // pět vteřin po každém kliknutí není chvíle, kdy autor „dokončil text".
        if (html && !automaticke) {
          const entries = extractI18nFromCanvas(html);
          if (entries.length > 0) {
            const locale = ctiLocalePlatna(editor) ?? ZDROJOVA_LOCALE_PLATNA;
            // ⛔ ODMÍTNUTÝ ZÁPIS PŘEKLADŮ SE MUSÍ OZVAT (naměřeno 2026-09-03,
            // audit U5-9). `upsert_translations` vyžaduje roli admin a jinak
            // vyhodí výjimku, kdežto plátno smí uložit i staff
            // (is_admin_or_staff). Mutace neměla `onError` a volala se
            // nezávazně, takže staff dostal „uloženo" — a jeho úpravy textů
            // zmizely beze slova. Uložení plátna zůstává nezávazné (to prošlo
            // a nemá se kvůli překladům rušit), ale selhání se POJMENUJE.
            upsertTranslations.mutate(
              entries.map((e) => ({
                key: e.key,
                locale,
                namespace: i18nNamespace,
                value: e.value,
              })),
              {
                onError: (chyba) => {
                  safeError("CanvasEditor.upsertTranslations", chyba);
                  toast({
                    title: t("builder.actions.save"),
                    description: t("builder.status.translationsDenied"),
                    variant: "destructive",
                  });
                },
              },
            );
          }
        }

        setSaveStatus("saved");
      } catch (error) {
        safeError("CanvasEditor.handleSave", error);
        setSaveStatus("error");
        if (onError) {
          onError(error);
        } else {
          toast({
            title: t("builder.actions.save"),
            description: t("builder.status.error"),
            variant: "destructive",
          });
        }
      }
    },
    [canvasCss, i18nKeyScope, i18nNamespace, onError, onSave, t, toast, upsertTranslations],
  );

  const scheduleAutoSave = useCallback(() => {
    if (!autoSave) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => void handleSave(false, true), AUTO_SAVE_DELAY_MS);
  }, [autoSave, handleSave]);

  useEffect(() => () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
  }, []);

  // Odchod ze záložky (přepnutí, zavření notebooku) nesmí čekat na prodlevu:
  // rozběhnutý odpočet se vyřídí hned (2026-09-24). Bez toho autor zavře
  // víko 3 s po poslední větě a ta zůstane jen v jeho paměti.
  useEffect(() => {
    if (!autoSave) return;
    const naOdchod = () => {
      if (document.visibilityState !== "hidden" || !autoSaveTimerRef.current) return;
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
      void handleSave(false, true);
    };
    document.addEventListener("visibilitychange", naOdchod);
    return () => document.removeEventListener("visibilitychange", naOdchod);
  }, [autoSave, handleSave]);

  const editorConfig = useMemo(
    () => getPageEditorConfig(undefined, assetUpload ? obalNahravani(assetUpload, toast, t) : undefined),
    [assetUpload, t, toast],
  );

  // Výška plátna = viditelná plocha okna od místa, kde plátno začíná (viz vyskaPlatna.ts).
  const editorBoxRef = useRef<HTMLDivElement>(null);
  const platnoBoxRef = useRef<HTMLDivElement>(null);
  const vyskaPlatna = useVyskaPlatna(editorBoxRef, platnoBoxRef);

  const onEditor = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      aishaBlocksPlugin(editor, { t });
      onEditorReady?.(editor);

      const hasCanvasContent = canvasData &&
        (canvasData as ProjectData).pages?.[0]?.frames?.[0]?.component?.components?.length;

      if (hasCanvasContent) {
        editor.loadProjectData(canvasData as ProjectData);
      } else if (canvasHtml) {
        editor.setComponents(canvasHtml);
        if (canvasCss) editor.setStyle(canvasCss);
      }
      // Otisk CSS tak, jak ho editor vidí HNED po načtení — proti němu se při
      // uložení pozná, jestli se CSS v editoru vůbec změnilo (viz handleSave).
      cssPoNacteniRef.current = editor.getCss() ?? "";

      if (existingAssets && existingAssets.length > 0) {
        editor.AssetManager.add(existingAssets.map((src) => ({ src })));
      }

      editor.on("change:changesCount", () => scheduleAutoSave());
    },
    [canvasData, canvasHtml, canvasCss, existingAssets, onEditorReady, scheduleAutoSave, t],
  );

  const changeDevice = (device: "Desktop" | "Tablet" | "Mobile") => {
    setActiveDevice(device);
    editorRef.current?.setDevice(device);
  };

  const statusLabel =
    saveStatus === "saving" ? t("builder.status.saving")
      : saveStatus === "saved" ? t("builder.status.saved")
        : saveStatus === "error" ? t("builder.status.error")
          : null;
  const statusVariant =
    saveStatus === "error" ? "destructive" : saveStatus === "saved" ? "secondary" : "outline";

  return (
    <div ref={editorBoxRef} className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-background">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(backTo)}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t("common.back")}
          </Button>
          {headerCenter}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 border border-border rounded p-0.5">
            <Button variant={activeDevice === "Desktop" ? "secondary" : "ghost"} size="sm" className="h-7 w-7 p-0"
              onClick={() => changeDevice("Desktop")} title={t("builder.devices.desktop")}>
              <Monitor className="h-3.5 w-3.5" />
            </Button>
            <Button variant={activeDevice === "Tablet" ? "secondary" : "ghost"} size="sm" className="h-7 w-7 p-0"
              onClick={() => changeDevice("Tablet")} title={t("builder.devices.tablet")}>
              <Tablet className="h-3.5 w-3.5" />
            </Button>
            <Button variant={activeDevice === "Mobile" ? "secondary" : "ghost"} size="sm" className="h-7 w-7 p-0"
              onClick={() => changeDevice("Mobile")} title={t("builder.devices.mobile")}>
              <Smartphone className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="w-px h-5 bg-border" />

          <Button variant="ghost" size="sm" onClick={() => editorRef.current?.UndoManager.undo()} title={t("builder.actions.undo")}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => editorRef.current?.UndoManager.redo()} title={t("builder.actions.redo")}>
            <Redo2 className="h-4 w-4" />
          </Button>

          {toolbarExtras && <div className="w-px h-5 bg-border" />}
          {toolbarExtras}

          {statusLabel && (
            <Badge variant={statusVariant} className="text-xs">
              {saveStatus === "saving" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {statusLabel}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => void handleSave(false)} disabled={isSaving}>
            <Save className="h-4 w-4 mr-1" />
            {t("builder.actions.save")}
          </Button>
          <Button variant="default" size="sm" onClick={() => void handleSave(true)} disabled={isSaving}>
            <Upload className="h-4 w-4 mr-1" />
            {t("builder.actions.publish")}
          </Button>
        </div>
      </div>

      {belowToolbar}

      <div
        ref={platnoBoxRef}
        className="min-h-0"
        style={vyskaPlatna === undefined ? undefined : { height: vyskaPlatna }}
      >
        <GjsEditor
          className="flex h-full"
          grapesjs={grapesjs}
          options={editorConfig}
          onEditor={onEditor}
        >
          <Canvas className="flex-1 min-w-0" />
          <EditorSidebar />
        </GjsEditor>
      </div>
    </div>
  );
}
