import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Newspaper, Loader2, Eye, EyeOff, LayoutTemplate, Search, Images, X, Send, Undo2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { aisha } from "@/integrations/db/client";
import { useAdminNewsArticles, type NewsArticlePayload, type NewsArticleAdmin, type NewsArticleFields } from "@/hooks/useAdminNewsArticles";
import {
  useFetchTranslationsForKeys,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@/hooks/useDynamicTranslations";
import { LocalizedFieldEditor } from "@/components/admin/LocalizedFieldEditor";
import { useSupportedLanguages } from "@/hooks/useSupportedLanguages";
import { ALLOWED_ASSET_TYPES, MAX_ASSET_BYTES, usePageAssetUpload } from "@/hooks/usePageAssetUpload";
import { NahravaciPole } from "@/components/admin/media/NahravaciPole";
import { GalerieMedii } from "@/components/admin/media/GalerieMedii";
import { OhniskoObrazku } from "@/components/admin/media/OhniskoObrazku";
import { StitkyInput } from "@/components/admin/StitkyInput";
import { SpravaStitkuDialog } from "@/components/admin/news/SpravaStitkuDialog";
import { NewsArticleDraftSchema } from "@/schemas/rpcResponseSchemas";
import { jeKonfliktUlozeni } from "@/lib/novinky/konflikt";
import { klicRozepsaneho, nactiRozepsane, smazRozepsane, ulozRozepsane } from "@/lib/novinky/rozepsanyText";
import { safeError } from "@/lib/security/safeLogger";
import { toast } from "sonner";

type LocalizedText = Partial<Record<SupportedLocale, string>>;

const createEmptyLocalized = (
  locales: SupportedLocale[],
  defaultValue = ""
): LocalizedText =>
  locales.reduce<LocalizedText>((acc, locale) => {
    acc[locale] = defaultValue;
    return acc;
  }, {});

const ensureLocalizedLocales = (
  values: LocalizedText,
  locales: SupportedLocale[],
  fallback = ""
): LocalizedText => {
  const next = { ...values };
  locales.forEach((locale) => {
    if (next[locale] === undefined) next[locale] = fallback;
  });
  return next;
};

interface NewsArticleFormData {
  title: LocalizedText;
  content: LocalizedText;
  excerpt: LocalizedText;
  slug: string;
  image_url: string;
  image_focus_x: number;
  image_focus_y: number;
  image_zoom: number;
  tags: string[];
  is_published: boolean;
  sort_order: number;
}

const createEmptyFormData = (
  locales: SupportedLocale[]
): NewsArticleFormData => ({
  title: createEmptyLocalized(locales),
  content: createEmptyLocalized(locales),
  excerpt: createEmptyLocalized(locales),
  slug: "",
  image_url: "",
  image_focus_x: 0.5,
  image_focus_y: 0.5,
  image_zoom: 1,
  tags: [],
  is_published: false,
  sort_order: 0,
});

type Razeni = "newest" | "oldest" | "title" | "status";
const ACCEPT_OBRAZKU = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif";

/** Texty formuláře → tvar `fields.texts` konceptu (prázdné se vynechají). */
function textyZFormulare(f: NewsArticleFormData, locales: SupportedLocale[]): NonNullable<NewsArticleFields["texts"]> {
  const out: NonNullable<NewsArticleFields["texts"]> = {};
  for (const locale of locales) {
    const t: { title?: string; excerpt?: string; content?: string } = {};
    if (f.title[locale]) t.title = f.title[locale];
    if (f.excerpt[locale]) t.excerpt = f.excerpt[locale];
    if (f.content[locale]) t.content = f.content[locale];
    if (Object.keys(t).length > 0) out[locale] = t;
  }
  return out;
}

export default function AdminNewsArticles() {
  const { t } = useTranslation();
  const {
    articles,
    isLoading,
    createArticleAsync,
    updateArticleAsync,
    saveDraftAsync,
    publishAsync,
    discardDraftAsync,
    deleteArticle,
    isCreating,
    isUpdating,
    isSavingDraft,
    isPublishing,
    isDeleting,
  } = useAdminNewsArticles();

  const { data: supportedLanguages } = useSupportedLanguages();
  const activeLocales = (
    supportedLanguages
      ?.filter((l) => l.is_active)
      .map((l) => l.code as SupportedLocale)
      .filter((c) => (SUPPORTED_LOCALES as readonly string[]).includes(c)) ??
    [...SUPPORTED_LOCALES]
  ) as SupportedLocale[];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<NewsArticleAdmin | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [formData, setFormData] = useState<NewsArticleFormData>(createEmptyFormData(activeLocales));
  const [sourceLocale, setSourceLocale] = useState<SupportedLocale>("en");
  const [targetLocale, setTargetLocale] = useState<SupportedLocale>("cs");
  const [galerieOpen, setGalerieOpen] = useState(false);
  // Razítko stavu z načtení (souběh) — po každém zápisu se přebírá z odpovědi.
  const [expectedStamp, setExpectedStamp] = useState<string | null>(null);
  const [unsavedPrompt, setUnsavedPrompt] = useState(false);
  const [restorePrompt, setRestorePrompt] = useState<{ ulozeno: string; data: NewsArticleFormData } | null>(null);
  const [conflict, setConflict] = useState(false);
  // Otisk formuláře při otevření: dirty = otisk teď ≠ otisk při otevření.
  const snapshotRef = useRef<string>("");

  // Seznam: hledání, štítky, řazení.
  const [hledani, setHledani] = useState("");
  const [vybraneStitky, setVybraneStitky] = useState<string[]>([]);
  const [spravaStitku, setSpravaStitku] = useState(false);
  const [razeni, setRazeni] = useState<Razeni>("newest");

  const { mutateAsync: fetchTranslationsForKeys } = useFetchTranslationsForKeys();
  const { uploadAsset } = usePageAssetUpload();

  const isSaving = isCreating || isUpdating || isSavingDraft || isPublishing;
  const dirty = dialogOpen && JSON.stringify(formData) !== snapshotRef.current;

  // Bez ruční memoizace (React Compiler): 92 řádků se přetřídí za mikrosekundy.
  const vsechnyStitky = [...new Set((articles ?? []).flatMap((a) => a.tags))].sort();

  const hledanyText = hledani.trim().toLowerCase();
  const datum = (a: NewsArticleAdmin) => Date.parse(a.published_at ?? a.updated_at) || 0;
  const titulek = (a: NewsArticleAdmin) => (a.title ?? a.slug).toLocaleLowerCase();
  const zobrazene = (articles ?? [])
    .filter((a) => {
      if (vybraneStitky.length > 0 && !vybraneStitky.some((s) => a.tags.includes(s))) return false;
      if (!hledanyText) return true;
      return [a.title, a.excerpt, a.slug, ...a.tags].some((x) => (x ?? "").toLowerCase().includes(hledanyText));
    })
    .sort((a, b) => {
      switch (razeni) {
        case "oldest":
          return datum(a) - datum(b);
        case "title":
          return titulek(a).localeCompare(titulek(b));
        case "status":
          return Number(a.is_published) - Number(b.is_published) || titulek(a).localeCompare(titulek(b));
        default:
          // Nejnovější nahoře; rozepsaná práce (koncepty) úplně nahoře.
          return Number(a.is_published) - Number(b.is_published) || datum(b) - datum(a);
      }
    });

  // ── Rozepsaný text v prohlížeči: otisk každé změny, obnova při otevření ──
  useEffect(() => {
    if (!dialogOpen || !dirty) return;
    const h = setTimeout(() => ulozRozepsane(klicRozepsaneho(editingArticle?.id ?? null), formData), 500);
    return () => clearTimeout(h);
  }, [dialogOpen, dirty, editingArticle?.id, formData]);

  const otevri = (data: NewsArticleFormData, article: NewsArticleAdmin | null) => {
    setEditingArticle(article);
    setFormData(data);
    snapshotRef.current = JSON.stringify(data);
    setExpectedStamp(article?.edit_stamp ?? null);
    setDialogOpen(true);
    const z = nactiRozepsane<NewsArticleFormData>(klicRozepsaneho(article?.id ?? null));
    if (z && JSON.stringify(z.data) !== JSON.stringify(data)) setRestorePrompt(z);
  };

  const zavri = () => {
    setDialogOpen(false);
    setEditingArticle(null);
    setUnsavedPrompt(false);
    setConflict(false);
  };

  const handleOpenCreate = () => otevri(createEmptyFormData(activeLocales), null);

  const handleOpenEdit = async (article: NewsArticleAdmin) => {
    const zaklad: NewsArticleFormData = {
      title: createEmptyLocalized(activeLocales),
      content: createEmptyLocalized(activeLocales),
      excerpt: createEmptyLocalized(activeLocales),
      slug: article.slug,
      image_url: article.image_url ?? "",
      image_focus_x: article.image_focus_x,
      image_focus_y: article.image_focus_y,
      image_zoom: article.image_zoom,
      tags: article.tags,
      is_published: article.is_published,
      sort_order: article.sort_order,
    };

    // Zveřejněný článek s KONCEPTEM: dialog upravuje koncept (hlavička i texty),
    // ne to, co je na webu — jinak by uložení tiše zahodilo rozdělanou práci.
    if (article.has_draft) {
      try {
        const { data, error } = await aisha.rpc("get_news_article_admin", { p_id: article.id });
        if (error) throw new Error(error.message);
        const radek = (Array.isArray(data) ? data[0] : data) as { draft?: unknown } | undefined;
        const draft = radek?.draft ? NewsArticleDraftSchema.parse(radek.draft) : null;
        if (draft) {
          const f = draft.fields;
          const texty = f.texts ?? {};
          const pole = (k: "title" | "excerpt" | "content"): LocalizedText =>
            ensureLocalizedLocales(
              Object.fromEntries(Object.entries(texty).map(([loc, v]) => [loc, v[k] ?? ""])) as LocalizedText,
              activeLocales,
            );
          otevri(
            {
              ...zaklad,
              title: pole("title"),
              excerpt: pole("excerpt"),
              content: pole("content"),
              image_url: f.image_url ?? zaklad.image_url,
              image_focus_x: f.image_focus_x ?? zaklad.image_focus_x,
              image_focus_y: f.image_focus_y ?? zaklad.image_focus_y,
              image_zoom: f.image_zoom ?? zaklad.image_zoom,
              tags: f.tags ?? zaklad.tags,
            },
            article,
          );
          return;
        }
      } catch (err) {
        safeError("admin-news.load-draft", err);
      }
    }

    const keys = [article.title_key, article.content_key, article.excerpt_key].filter(
      (k): k is string => !!k
    );
    try {
      const translations = await fetchTranslationsForKeys({ keys, namespace: "news" });
      const titleTranslations: LocalizedText = {};
      const contentTranslations: LocalizedText = {};
      const excerptTranslations: LocalizedText = {};
      for (const tr of translations) {
        if (tr.key === article.title_key) titleTranslations[tr.locale as SupportedLocale] = tr.value;
        else if (tr.key === article.content_key) contentTranslations[tr.locale as SupportedLocale] = tr.value;
        else if (tr.key === article.excerpt_key) excerptTranslations[tr.locale as SupportedLocale] = tr.value;
      }
      otevri(
        {
          ...zaklad,
          title: ensureLocalizedLocales(titleTranslations, activeLocales),
          content: ensureLocalizedLocales(contentTranslations, activeLocales),
          excerpt: ensureLocalizedLocales(excerptTranslations, activeLocales),
        },
        article,
      );
    } catch (err) {
      safeError("admin-news.load-translations", err);
      otevri(zaklad, article);
    }
  };

  /** Uložení: OBSAH přes koncept (server rozhodne kam), STRUKTURA přes update. */
  const handleSave = async (prepsat = false): Promise<boolean> => {
    const slug = formData.slug || `article-${Date.now()}`;
    const titleKey = editingArticle?.title_key ?? `news.${slug}.title`;
    const contentKey = editingArticle?.content_key ?? `news.${slug}.content`;
    const excerptKey = editingArticle?.excerpt_key ?? `news.${slug}.excerpt`;
    const fields: NewsArticleFields = {
      image_url: formData.image_url || null,
      image_focus_x: formData.image_focus_x,
      image_focus_y: formData.image_focus_y,
      image_zoom: formData.image_zoom,
      tags: formData.tags,
      texts: textyZFormulare(formData, activeLocales),
    };
    let stamp: string | null = prepsat ? null : expectedStamp;

    try {
      if (!editingArticle) {
        const payload: NewsArticlePayload = {
          content_key: contentKey,
          excerpt_key: excerptKey,
          image_focus_x: formData.image_focus_x,
          image_focus_y: formData.image_focus_y,
          image_url: formData.image_url || null,
          image_zoom: formData.image_zoom,
          is_published: false,
          slug,
          sort_order: formData.sort_order,
          tags: formData.tags,
          title_key: titleKey,
        };
        const id = await createArticleAsync(payload);
        stamp = await saveDraftAsync({ id, expectedStamp: null, fields: { texts: fields.texts } });
        if (formData.is_published) await publishAsync({ id, expectedStamp: stamp });
      } else {
        const id = editingArticle.id;
        stamp = await saveDraftAsync({ id, expectedStamp: stamp, fields });
        const strukturaZmenena = slug !== editingArticle.slug || formData.sort_order !== editingArticle.sort_order;
        const stahnout = !formData.is_published && editingArticle.is_published;
        if (strukturaZmenena || stahnout) {
          stamp = await updateArticleAsync({
            id,
            data: {
              expected_stamp: stamp,
              is_published: stahnout ? false : undefined,
              slug: strukturaZmenena ? slug : undefined,
              sort_order: strukturaZmenena ? formData.sort_order : undefined,
            },
          });
        }
        if (formData.is_published && !editingArticle.is_published) {
          await publishAsync({ id, expectedStamp: stamp });
        } else if (editingArticle.is_published && !stahnout) {
          toast.info(t("admin.newsArticles.form.savedAsDraft"));
        }
      }
    } catch (err) {
      if (jeKonfliktUlozeni(err)) {
        setConflict(true);
        return false;
      }
      safeError("admin-news.save-article", err);
      // Hook's onError already shows a toast — no duplicate toast needed
      return false;
    }

    smazRozepsane(klicRozepsaneho(editingArticle?.id ?? null));
    zavri();
    return true;
  };

  const handlePublishDraft = async () => {
    if (!editingArticle) return;
    if (!(await handleSave())) return;
  };

  const handleDiscardDraft = async () => {
    if (!editingArticle) return;
    try {
      await discardDraftAsync(editingArticle.id);
      smazRozepsane(klicRozepsaneho(editingArticle.id));
      zavri();
    } catch (err) {
      safeError("admin-news.discard-draft", err);
    }
  };

  const handleDelete = (id: string) => {
    deleteArticle(id);
    setDeleteConfirmId(null);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString();
  };

  const zkusZavrit = (open: boolean) => {
    if (open) return;
    if (dirty) {
      setUnsavedPrompt(true);
      return;
    }
    smazRozepsane(klicRozepsaneho(editingArticle?.id ?? null));
    zavri();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            <div>
              <CardTitle>{t("admin.newsArticles.title")}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {t("admin.newsArticles.subtitle")}
              </p>
            </div>
          </div>
          <Dialog open={dialogOpen} onOpenChange={zkusZavrit}>
            <DialogTrigger asChild>
              <Button onClick={handleOpenCreate}>
                <Plus className="h-4 w-4 mr-2" />
                {t("admin.newsArticles.addArticle")}
              </Button>
            </DialogTrigger>
            <DialogContent
              className="max-w-4xl max-h-[90vh] overflow-y-auto"
              // Klik vedle okna NIKDY nezavírá (ztráta textu, naměřeno testerem 2026-09-24);
              // Esc a křížek se při rozepsaných změnách zeptají.
              onInteractOutside={(e) => e.preventDefault()}
              onEscapeKeyDown={(e) => {
                if (dirty) {
                  e.preventDefault();
                  setUnsavedPrompt(true);
                }
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {editingArticle
                    ? t("admin.newsArticles.editArticle")
                    : t("admin.newsArticles.addArticle")}
                </DialogTitle>
              </DialogHeader>
              {editingArticle?.has_draft ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{t("admin.newsArticles.form.hasDraft")}</span>
                  <Button size="sm" onClick={() => void handlePublishDraft()} disabled={isSaving}>
                    <Send className="h-4 w-4 mr-1" />
                    {t("admin.newsArticles.form.publishChanges")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleDiscardDraft()} disabled={isSaving}>
                    <Undo2 className="h-4 w-4 mr-1" />
                    {t("admin.newsArticles.form.discardDraft")}
                  </Button>
                </div>
              ) : null}
              <div className="space-y-6 py-4">
                {/* Slug */}
                <div className="space-y-2">
                  <Label htmlFor="slug">{t("admin.newsArticles.form.slug")}</Label>
                  <Input
                    id="slug"
                    value={formData.slug}
                    onChange={(e) => setFormData((p) => ({ ...p, slug: e.target.value }))}
                    placeholder={t("admin.newsArticles.form.slugPlaceholder")}
                  />
                </div>

                {/* Title (localized) */}
                <LocalizedFieldEditor
                  label={t("admin.newsArticles.form.title")}
                  fieldId="news-title"
                  value={formData.title}
                  onChange={(locale, val) =>
                    setFormData((p) => ({
                      ...p,
                      title: { ...p.title, [locale]: val },
                    }))
                  }
                  primaryLocale={sourceLocale}
                  targetLocale={targetLocale}
                  onSourceLocaleChange={setSourceLocale}
                  onTargetLocaleChange={setTargetLocale}
                  locales={activeLocales}
                  required
                />

                {/* Excerpt (localized) */}
                <LocalizedFieldEditor
                  label={t("admin.newsArticles.form.excerpt")}
                  fieldId="news-excerpt"
                  value={formData.excerpt}
                  onChange={(locale, val) =>
                    setFormData((p) => ({
                      ...p,
                      excerpt: { ...p.excerpt, [locale]: val },
                    }))
                  }
                  primaryLocale={sourceLocale}
                  targetLocale={targetLocale}
                  onSourceLocaleChange={setSourceLocale}
                  onTargetLocaleChange={setTargetLocale}
                  locales={activeLocales}
                  multiline
                  rows={3}
                />

                {/*
                  Tělo článku: PRVNÍ je plátno (editor), tohle pole je zděděný text.
                  POZOR: do 2026-09-21 se pole jmenovalo „Obsah (Markdown)". Markdown to
                  není — naměřeno na instanci, že 226 z 226 uložených těl je HTML
                  a 0 markdown — a hlavně: článek napsaný v editoru má tělo
                  v `canvas_html`, takže autor měl na tělo DVĚ místa a to hlavní
                  z dialogu nebylo vidět. Pole zůstává (zděděná těla se jím dají
                  opravit), ale říká, co je, a ukazuje cestu do editoru.
                */}
                <LocalizedFieldEditor
                  label={t("admin.newsArticles.form.content")}
                  fieldId="news-content"
                  value={formData.content}
                  onChange={(locale, val) =>
                    setFormData((p) => ({
                      ...p,
                      content: { ...p.content, [locale]: val },
                    }))
                  }
                  primaryLocale={sourceLocale}
                  targetLocale={targetLocale}
                  onSourceLocaleChange={setSourceLocale}
                  onTargetLocaleChange={setTargetLocale}
                  locales={activeLocales}
                  multiline
                  rows={10}
                />
                <p className="text-xs text-muted-foreground">
                  {t("admin.newsArticles.form.contentHint")}
                </p>
                {editingArticle && (
                  <Button variant="outline" size="sm" className="gap-2" asChild>
                    <Link to={`/admin/news-articles/${editingArticle.id}/edit`}>
                      <LayoutTemplate className="h-4 w-4" />
                      {t("admin.newsArticles.editInBuilder", "Edit in builder")}
                    </Link>
                  </Button>
                )}

                {/* Štítky */}
                <div className="space-y-2">
                  <Label htmlFor="news-tags">{t("admin.newsArticles.form.tags")}</Label>
                  <StitkyInput
                    id="news-tags"
                    value={formData.tags}
                    onChange={(tags) => setFormData((p) => ({ ...p, tags }))}
                    nabidka={vsechnyStitky}
                    placeholder={t("admin.newsArticles.form.tagsPlaceholder")}
                  />
                </div>

                {/* Titulní obrázek */}
                <div className="space-y-3">
                  <Label>{t("admin.newsArticles.form.cover")}</Label>
                  {formData.image_url ? (
                    <OhniskoObrazku
                      url={formData.image_url}
                      hodnota={{ fx: formData.image_focus_x, fy: formData.image_focus_y, zoom: formData.image_zoom }}
                      onChange={(o) => setFormData((p) => ({ ...p, image_focus_x: o.fx, image_focus_y: o.fy, image_zoom: o.zoom }))}
                    />
                  ) : null}
                  <NahravaciPole
                    povoleneTypy={ALLOWED_ASSET_TYPES}
                    accept={ACCEPT_OBRAZKU}
                    maxBytes={MAX_ASSET_BYTES}
                    kompaktni
                    popisek={t("admin.newsArticles.form.coverUpload")}
                    napoveda={t("admin.media.heicHint")}
                    onFile={async (soubor, onProgress, signal) => {
                      const url = await uploadAsset(soubor, { onProgress, signal });
                      setFormData((p) => ({ ...p, image_url: url, image_focus_x: 0.5, image_focus_y: 0.5, image_zoom: 1 }));
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setGalerieOpen(true)}>
                      <Images className="h-4 w-4 mr-1" />
                      {t("admin.newsArticles.form.coverPick")}
                    </Button>
                    {formData.image_url ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setFormData((p) => ({ ...p, image_url: "", image_focus_x: 0.5, image_focus_y: 0.5, image_zoom: 1 }))}
                      >
                        <X className="h-4 w-4 mr-1" />
                        {t("admin.newsArticles.form.coverRemove")}
                      </Button>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="image_url" className="text-xs text-muted-foreground">{t("admin.newsArticles.form.imageUrl")}</Label>
                    <Input
                      id="image_url"
                      value={formData.image_url}
                      onChange={(e) => setFormData((p) => ({ ...p, image_url: e.target.value }))}
                      placeholder="https://..."
                    />
                  </div>
                </div>

                {/* Settings row */}
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="is_published"
                      checked={formData.is_published}
                      onCheckedChange={(checked) =>
                        setFormData((p) => ({ ...p, is_published: checked }))
                      }
                    />
                    <Label htmlFor="is_published">{t("admin.newsArticles.form.isPublished")}</Label>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sort_order">{t("admin.newsArticles.form.sortOrder")}</Label>
                    <Input
                      id="sort_order"
                      type="number"
                      value={formData.sort_order}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, sort_order: parseInt(e.target.value, 10) || 0 }))
                      }
                      className="w-24"
                    />
                  </div>
                </div>

                {/* Save */}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => zkusZavrit(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button onClick={() => void handleSave()} disabled={isSaving}>
                    {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {editingArticle?.is_published && !formData.is_published
                      ? t("common.save")
                      : editingArticle?.is_published
                        ? t("admin.newsArticles.form.saveDraft")
                        : t("common.save")}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Hledání, štítky, řazení */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                value={hledani}
                onChange={(e) => setHledani(e.target.value)}
                placeholder={t("admin.newsArticles.list.search")}
                aria-label={t("admin.newsArticles.list.search")}
                className="pl-8"
              />
            </div>
            <select
              aria-label={t("admin.newsArticles.list.sort")}
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={razeni}
              onChange={(e) => setRazeni(e.target.value as Razeni)}
            >
              <option value="newest">{t("admin.newsArticles.list.sortNewest")}</option>
              <option value="oldest">{t("admin.newsArticles.list.sortOldest")}</option>
              <option value="title">{t("admin.newsArticles.list.sortTitle")}</option>
              <option value="status">{t("admin.newsArticles.list.sortStatus")}</option>
            </select>
          </div>
          {vsechnyStitky.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("admin.newsArticles.list.filterTags")}>
              <button
                type="button"
                className={`rounded-full border px-2 py-0.5 text-xs ${vybraneStitky.length === 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                onClick={() => setVybraneStitky([])}
                aria-pressed={vybraneStitky.length === 0}
              >
                {t("admin.newsArticles.list.allTags")}
              </button>
              {vsechnyStitky.map((s) => {
                const on = vybraneStitky.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    className={`rounded-full border px-2 py-0.5 text-xs ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                    onClick={() => setVybraneStitky((v) => (on ? v.filter((x) => x !== s) : [...v, s]))}
                  >
                    {s}
                  </button>
                );
              })}
              <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setSpravaStitku(true)}>
                {t("admin.newsArticles.tags.manage")}
              </Button>
            </div>
          ) : null}
          <SpravaStitkuDialog open={spravaStitku} onOpenChange={setSpravaStitku} />

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !articles?.length ? (
            <p className="text-center text-muted-foreground py-8">
              {t("admin.newsArticles.noArticles")}
            </p>
          ) : zobrazene.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{t("admin.newsArticles.list.noMatch")}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{t("admin.newsArticles.list.count", { shown: zobrazene.length, total: articles.length })}</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("admin.newsArticles.table.title")}</TableHead>
                    <TableHead>{t("admin.newsArticles.table.tags")}</TableHead>
                    <TableHead>{t("admin.newsArticles.table.status")}</TableHead>
                    <TableHead>{t("admin.newsArticles.table.publishedAt")}</TableHead>
                    <TableHead>{t("admin.newsArticles.table.updatedAt")}</TableHead>
                    <TableHead className="text-right">{t("common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zobrazene.map((article) => (
                    <TableRow key={article.id} data-testid={`news-row-${article.slug}`}>
                      <TableCell>
                        <div className="font-medium">{article.title ?? <span className="text-muted-foreground">{t("admin.newsArticles.list.untitled")}</span>}</div>
                        <div className="font-mono text-xs text-muted-foreground">{article.slug}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {article.tags.map((s) => (
                            <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {article.is_published ? (
                            <Badge variant="default" className="gap-1">
                              <Eye className="h-3 w-3" />
                              {t("admin.newsArticles.published")}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1">
                              <EyeOff className="h-3 w-3" />
                              {t("admin.newsArticles.draft")}
                            </Badge>
                          )}
                          {article.has_draft ? <Badge variant="outline">{t("admin.newsArticles.list.draftPending")}</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(article.published_at)}</TableCell>
                      <TableCell>{formatDate(article.updated_at)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            asChild
                            title={t("admin.newsArticles.editInBuilder", "Edit in builder")}
                          >
                            <Link to={`/admin/news-articles/${article.id}/edit`}>
                              <LayoutTemplate className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void handleOpenEdit(article)}
                            aria-label={t("admin.newsArticles.editArticle")}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteConfirmId(article.id)}
                            aria-label={t("common.delete")}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {galerieOpen ? (
        <GalerieMedii
          open={galerieOpen}
          onOpenChange={setGalerieOpen}
          onPick={(url) => {
            setFormData((p) => ({ ...p, image_url: url, image_focus_x: 0.5, image_focus_y: 0.5, image_zoom: 1 }));
            setGalerieOpen(false);
          }}
        />
      ) : null}

      {/* Neuložené změny při zavírání */}
      <AlertDialog open={unsavedPrompt} onOpenChange={setUnsavedPrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.newsArticles.unsaved.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.newsArticles.unsaved.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                smazRozepsane(klicRozepsaneho(editingArticle?.id ?? null));
                zavri();
              }}
            >
              {t("admin.newsArticles.unsaved.discard")}
            </Button>
            <AlertDialogCancel>{t("admin.newsArticles.unsaved.keepEditing")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSave()} disabled={isSaving}>
              {t("admin.newsArticles.unsaved.saveDraft")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Obnova rozepsaného textu z prohlížeče */}
      <AlertDialog open={!!restorePrompt} onOpenChange={(o) => !o && setRestorePrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.newsArticles.restore.title", { time: restorePrompt ? new Date(restorePrompt.ulozeno).toLocaleString() : "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("admin.newsArticles.restore.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                smazRozepsane(klicRozepsaneho(editingArticle?.id ?? null));
                setRestorePrompt(null);
              }}
            >
              {t("admin.newsArticles.restore.discard")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (restorePrompt) setFormData(restorePrompt.data);
                setRestorePrompt(null);
              }}
            >
              {t("admin.newsArticles.restore.restore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Konflikt: někdo mezitím uložil */}
      <AlertDialog open={conflict} onOpenChange={setConflict}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.newsArticles.conflict.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.newsArticles.conflict.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setConflict(false);
                const cerstvy = articles?.find((a) => a.id === editingArticle?.id);
                zavri();
                if (cerstvy) void handleOpenEdit(cerstvy);
              }}
            >
              {t("admin.newsArticles.conflict.reload")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSave(true)}>{t("admin.newsArticles.conflict.overwrite")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.newsArticles.deleteWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
