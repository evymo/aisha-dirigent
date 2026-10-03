import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import { ChevronDown, FileText, Users, Link2, Globe, Upload, Loader2 } from "lucide-react";
import {
  useCreateArchiveDocument,
  useUpdateArchiveDocument,
} from "@/hooks/useArchiveAdmin";
import { uploadArchiveFile } from "@/hooks/useArchiveStorage";
import type { AdminArchiveDocument } from "@/lib/schemas/adminSchemas";
import { TranslatableTagInput } from "@/components/admin/TranslatableTagInput";
import { LocalizedFieldEditor } from "@/components/admin/LocalizedFieldEditor";
import {
  useFetchTranslationsForKeys,
  useUpsertTranslations,
  type TranslationInput,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@/hooks/useDynamicTranslations";
import {
  PROVENANCE_BADGES,
  DOCUMENT_TYPES,
  ORIGINAL_LANGUAGES,
  TRANSLATION_NAMESPACE,
  createEmptyLocalized,
  initialArchiveFormData,
  type ArchiveFormData,
  type LocalizedText,
} from "./adminArchiveTypes";

interface ArchiveDocumentFormDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  editingItem: AdminArchiveDocument | null;
  onSuccess: () => void;
}

/**
 * Dialog form for creating/editing archive documents with inline localization.
 */
export function ArchiveDocumentFormDialog(props: ArchiveDocumentFormDialogProps) {
  const { isOpen, onOpenChange, editingItem, onSuccess } = props;
  const { t, i18n } = useTranslation();
  const [formData, setFormData] = useState<ArchiveFormData>(initialArchiveFormData);
  const [basicInfoOpen, setBasicInfoOpen] = useState(true);
  const [metadataOpen, setMetadataOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);
  const [uploadingScan, setUploadingScan] = useState(false);
  const [uploadingTranscript, setUploadingTranscript] = useState(false);

  const [sourceLocale, setSourceLocale] = useState<SupportedLocale>(
    (i18n.language as SupportedLocale) || "en"
  );
  const [targetLocale, setTargetLocale] = useState<SupportedLocale>("cs");

  const scanInputRef = useRef<HTMLInputElement>(null);
  const transcriptInputRef = useRef<HTMLInputElement>(null);

  const createMutation = useCreateArchiveDocument();
  const updateMutation = useUpdateArchiveDocument();
  const upsertTranslations = useUpsertTranslations();
  const { mutateAsync: fetchTranslationsForKeys } = useFetchTranslationsForKeys();

  const resetForm = () => {
    setFormData(initialArchiveFormData);
    onSuccess();
  };

  const handleLocalizedChange = (
    field: keyof Pick<ArchiveFormData, "title" | "description" | "summary" | "editorial_note" | "what_you_are_looking_at" | "standards_context">,
    locale: SupportedLocale,
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        [locale]: value,
      },
    }));
  };

  // Populate form when editing an existing document
  useEffect(() => {
    if (!editingItem) {
      setFormData(initialArchiveFormData);
      return;
    }

    const populateForm = async () => {
      const keyFields: Record<string, string | null | undefined> = {
        title: editingItem.title_key,
        description: editingItem.description_key,
        summary: editingItem.summary_key,
        editorial_note: editingItem.editorial_note_key,
        what_you_are_looking_at: editingItem.what_you_are_looking_at_key,
        standards_context: editingItem.standards_context_key,
      };

      const keysToFetch = Object.values(keyFields).filter(
        (key): key is string => !!key && key.trim().length > 0
      );

      const newFormData: ArchiveFormData = {
        slug: editingItem.slug,
        title: createEmptyLocalized(),
        description: createEmptyLocalized(),
        summary: createEmptyLocalized(),
        editorial_note: createEmptyLocalized(),
        what_you_are_looking_at: createEmptyLocalized(),
        standards_context: createEmptyLocalized(),
        content: editingItem.content || "",
        document_type: editingItem.document_type,
        provenance_badge: editingItem.provenance_badge,
        year: editingItem.year ? editingItem.year.toString() : "",
        decade: editingItem.decade || "",
        facility: editingItem.facility || "",
        place: editingItem.place || "",
        preparation: editingItem.preparation || "",
        scan_url: editingItem.scan_url || "",
        transcript_url: editingItem.transcript_url || "",
        source_publication: editingItem.source_publication || "",
        original_language: editingItem.original_language || "en",
        page_count: editingItem.page_count ? editingItem.page_count.toString() : "",
        is_featured: editingItem.is_featured,
        is_download_public: editingItem.is_download_public ?? false,
        people: editingItem.people || [],
        keywords: editingItem.keywords || [],
      };

      if (keysToFetch.length > 0) {
        try {
          const rows = await fetchTranslationsForKeys({
            keys: keysToFetch,
            namespace: TRANSLATION_NAMESPACE,
          });

          const translationsByKey: Record<string, LocalizedText> = {};
          for (const row of rows) {
            if (!translationsByKey[row.key]) {
              translationsByKey[row.key] = {};
            }
            translationsByKey[row.key][row.locale] = row.value;
          }

          const localizedFields = ["title", "description", "summary", "editorial_note", "what_you_are_looking_at", "standards_context"] as const;
          for (const field of localizedFields) {
            const key = keyFields[field];
            if (key && translationsByKey[key]) {
              newFormData[field] = { ...createEmptyLocalized(), ...translationsByKey[key] };
            }
          }
        } catch (error) {
          safeError("admin.archive.loadTranslationsFailed", error);
        }
      }

      // Fallback: populate base locale from item's direct fields if no translations
      const baseLocale = sourceLocale;
      if (!newFormData.title[baseLocale]) {
        newFormData.title[baseLocale] = editingItem.title || "";
      }
      if (!newFormData.description[baseLocale]) {
        newFormData.description[baseLocale] = editingItem.description || "";
      }
      if (!newFormData.editorial_note[baseLocale]) {
        newFormData.editorial_note[baseLocale] = editingItem.editorial_note || "";
      }
      if (!newFormData.what_you_are_looking_at[baseLocale]) {
        newFormData.what_you_are_looking_at[baseLocale] = editingItem.what_you_are_looking_at || "";
      }
      if (!newFormData.standards_context[baseLocale]) {
        newFormData.standards_context[baseLocale] = editingItem.standards_context || "";
      }

      setFormData(newFormData);
    };

    populateForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- populateForm is a stable local closure
  }, [editingItem]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const slug = formData.slug.trim();
    if (!slug) {
      toast.error(t("admin.archive.errors.slugRequired"));
      return;
    }

    try {
      const titleKey = `${TRANSLATION_NAMESPACE}.${slug}.title`;
      const descriptionKey = `${TRANSLATION_NAMESPACE}.${slug}.description`;
      const summaryKey = `${TRANSLATION_NAMESPACE}.${slug}.summary`;
      const editorialNoteKey = `${TRANSLATION_NAMESPACE}.${slug}.editorial_note`;
      const whatYouAreLookingAtKey = `${TRANSLATION_NAMESPACE}.${slug}.what_you_are_looking_at`;
      const standardsContextKey = `${TRANSLATION_NAMESPACE}.${slug}.standards_context`;

      const translationInputs: TranslationInput[] = [];

      const addTranslations = (key: string, values: LocalizedText) => {
        SUPPORTED_LOCALES.forEach((locale) => {
          const value = values[locale];
          if (value && value.trim()) {
            translationInputs.push({
              key,
              locale,
              value: value.trim(),
              namespace: TRANSLATION_NAMESPACE,
            });
          }
        });
      };

      addTranslations(titleKey, formData.title);
      addTranslations(descriptionKey, formData.description);
      addTranslations(summaryKey, formData.summary);
      addTranslations(editorialNoteKey, formData.editorial_note);
      addTranslations(whatYouAreLookingAtKey, formData.what_you_are_looking_at);
      addTranslations(standardsContextKey, formData.standards_context);

      if (translationInputs.length > 0) {
        await upsertTranslations.mutateAsync(translationInputs);
      }

      const baseTitle = formData.title[sourceLocale] || formData.title.en || formData.title.cs || "";
      const baseDescription = formData.description[sourceLocale] || formData.description.en || "";

      const data = {
        slug: formData.slug,
        title: baseTitle,
        description: baseDescription || null,
        content: formData.content || null,
        document_type: formData.document_type,
        provenance_badge: formData.provenance_badge,
        year: formData.year ? parseInt(formData.year) : null,
        decade: formData.decade || null,
        facility: formData.facility || null,
        place: formData.place || null,
        preparation: formData.preparation || null,
        scan_url: formData.scan_url || null,
        transcript_url: formData.transcript_url || null,
        editorial_note: formData.editorial_note[sourceLocale] || null,
        what_you_are_looking_at: formData.what_you_are_looking_at[sourceLocale] || null,
        standards_context: formData.standards_context[sourceLocale] || null,
        source_publication: formData.source_publication || null,
        original_language: formData.original_language || "en",
        page_count: formData.page_count ? parseInt(formData.page_count) : null,
        is_featured: formData.is_featured,
        is_download_public: formData.is_download_public,
        people: formData.people.length > 0 ? formData.people : null,
        keywords: formData.keywords.length > 0 ? formData.keywords : null,
      };

      if (editingItem) {
        updateMutation.mutate({ id: editingItem.id, data }, { onSuccess: () => resetForm() });
      } else {
        createMutation.mutate(data, { onSuccess: () => resetForm() });
      }
    } catch (error) {
      safeError("admin.archive.submitFailed", error);
      toast.error(t("admin.archive.errors.saveFailed"));
    }
  };

  const handleFileUpload = async (
    file: File,
    type: "scan" | "transcript",
    setUploading: (v: boolean) => void
  ) => {
    if (!file) return;

    setUploading(true);
    try {
      const { publicUrl } = await uploadArchiveFile({
        file,
        type,
        slug: formData.slug || String(Date.now()),
      });

      if (type === "scan") {
        setFormData((prev) => ({ ...prev, scan_url: publicUrl }));
      } else {
        setFormData((prev) => ({ ...prev, transcript_url: publicUrl }));
      }

      toast.success(t("admin.archive.uploadSuccess"));
    } catch (error) {
      safeError("archive.upload.failed", error);
      toast.error(t("admin.archive.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending || upsertTranslations.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingItem ? t("admin.archive.editDocument") : t("admin.archive.addDocument")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editingItem ? t("admin.archive.editDocument") : t("admin.archive.addDocument")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Basic Info Section */}
          <Collapsible open={basicInfoOpen} onOpenChange={setBasicInfoOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 bg-muted rounded-lg hover:bg-muted/80">
              <FileText className="h-4 w-4" />
              <span className="font-medium">{t("admin.archive.sections.basicInfo")}</span>
              <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${basicInfoOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="slug">{t("admin.archive.form.slug")} *</Label>
                  <Input
                    id="slug"
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                    placeholder={t("admin.archive.placeholders.slug")}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="year">{t("admin.archive.form.year")}</Label>
                  <Input
                    id="year"
                    type="number"
                    value={formData.year}
                    onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                    placeholder={t("admin.archive.placeholders.year")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="document_type">{t("admin.archive.form.documentType")}</Label>
                  <Select
                    value={formData.document_type}
                    onValueChange={(v) => setFormData({ ...formData, document_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(`admin.archive.documentTypes.${type}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="provenance_badge">{t("admin.archive.form.provenanceBadge")}</Label>
                  <Select
                    value={formData.provenance_badge}
                    onValueChange={(v) => setFormData({ ...formData, provenance_badge: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVENANCE_BADGES.map((badge) => (
                        <SelectItem key={badge} value={badge}>
                          {t(`admin.archive.provenanceBadges.${badge}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="original_language">{t("admin.archive.form.originalLanguage")}</Label>
                  <Select
                    value={formData.original_language}
                    onValueChange={(v) => setFormData({ ...formData, original_language: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORIGINAL_LANGUAGES.map((lang) => (
                        <SelectItem key={lang.value} value={lang.value}>
                          {t(lang.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="page_count">{t("admin.archive.form.pageCount")}</Label>
                  <Input
                    id="page_count"
                    type="number"
                    value={formData.page_count}
                    onChange={(e) => setFormData({ ...formData, page_count: e.target.value })}
                    placeholder={t("admin.archive.placeholders.pageCount")}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="source_publication">{t("admin.archive.form.sourcePublication")}</Label>
                <Input
                  id="source_publication"
                  value={formData.source_publication}
                  onChange={(e) => setFormData({ ...formData, source_publication: e.target.value })}
                  placeholder={t("admin.archive.placeholders.sourcePublication")}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="is_featured"
                  checked={formData.is_featured}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_featured: checked })}
                />
                <Label htmlFor="is_featured">{t("admin.archive.form.featuredDocument")}</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="is_download_public"
                  checked={formData.is_download_public}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_download_public: checked })}
                />
                <Label htmlFor="is_download_public">{t("admin.archive.form.publicDownload")}</Label>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Content Fields - Inline Localization with LocalizedFieldEditor */}
          <div className="space-y-4 border rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Globe className="h-4 w-4" />
              <span>{t("admin.archive.sections.content")}</span>
            </div>

            <LocalizedFieldEditor
              label={t("admin.archive.form.title")}
              fieldId="archive-title"
              value={formData.title}
              onChange={(locale, value) => handleLocalizedChange("title", locale, value)}
              primaryLocale={sourceLocale}
              sourceLocale={sourceLocale}
              targetLocale={targetLocale}
              onSourceLocaleChange={setSourceLocale}
              onTargetLocaleChange={setTargetLocale}
              required
            />

            <LocalizedFieldEditor
              label={t("admin.archive.form.summary")}
              fieldId="archive-summary"
              value={formData.summary}
              onChange={(locale, value) => handleLocalizedChange("summary", locale, value)}
              primaryLocale={sourceLocale}
              sourceLocale={sourceLocale}
              targetLocale={targetLocale}
              onSourceLocaleChange={setSourceLocale}
              onTargetLocaleChange={setTargetLocale}
              multiline
              rows={2}
            />

            <LocalizedFieldEditor
              label={t("admin.archive.form.description")}
              fieldId="archive-description"
              value={formData.description}
              onChange={(locale, value) => handleLocalizedChange("description", locale, value)}
              primaryLocale={sourceLocale}
              sourceLocale={sourceLocale}
              targetLocale={targetLocale}
              onSourceLocaleChange={setSourceLocale}
              onTargetLocaleChange={setTargetLocale}
              multiline
              rows={3}
            />

            <LocalizedFieldEditor
              label={t("admin.archive.form.whatYouAreLookingAt")}
              fieldId="archive-what-you-are-looking-at"
              value={formData.what_you_are_looking_at}
              onChange={(locale, value) => handleLocalizedChange("what_you_are_looking_at", locale, value)}
              primaryLocale={sourceLocale}
              sourceLocale={sourceLocale}
              targetLocale={targetLocale}
              onSourceLocaleChange={setSourceLocale}
              onTargetLocaleChange={setTargetLocale}
              multiline
              rows={2}
            />

            <LocalizedFieldEditor
              label={t("admin.archive.form.editorialNote")}
              fieldId="archive-editorial-note"
              value={formData.editorial_note}
              onChange={(locale, value) => handleLocalizedChange("editorial_note", locale, value)}
              primaryLocale={sourceLocale}
              sourceLocale={sourceLocale}
              targetLocale={targetLocale}
              onSourceLocaleChange={setSourceLocale}
              onTargetLocaleChange={setTargetLocale}
              multiline
              rows={2}
            />

            <LocalizedFieldEditor
              label={t("admin.archive.form.standardsContext")}
              fieldId="archive-standards-context"
              value={formData.standards_context}
              onChange={(locale, value) => handleLocalizedChange("standards_context", locale, value)}
              primaryLocale={sourceLocale}
              sourceLocale={sourceLocale}
              targetLocale={targetLocale}
              onSourceLocaleChange={setSourceLocale}
              onTargetLocaleChange={setTargetLocale}
              multiline
              rows={2}
            />
          </div>

          {/* Metadata Section */}
          <Collapsible open={metadataOpen} onOpenChange={setMetadataOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 bg-muted rounded-lg hover:bg-muted/80">
              <Users className="h-4 w-4" />
              <span className="font-medium">{t("admin.archive.sections.metadata")}</span>
              <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${metadataOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4 space-y-4">
              {/* People/Authors */}
              <div className="space-y-2">
                <Label>{t("admin.archive.form.people")}</Label>
                <TranslatableTagInput
                  category="person"
                  value={formData.people}
                  onChange={(codes) => setFormData({ ...formData, people: codes })}
                  placeholder={t("admin.archive.placeholders.person")}
                  allowCreate
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.archive.form.facility")}</Label>
                  <TranslatableTagInput
                    category="facility"
                    value={formData.facility ? [formData.facility] : []}
                    onChange={(codes) => setFormData({ ...formData, facility: codes[0] || "" })}
                    placeholder={t("admin.archive.placeholders.facility")}
                    maxTags={1}
                    allowCreate
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.archive.form.place")}</Label>
                  <TranslatableTagInput
                    category="place"
                    value={formData.place ? [formData.place] : []}
                    onChange={(codes) => setFormData({ ...formData, place: codes[0] || "" })}
                    placeholder={t("admin.archive.placeholders.place")}
                    maxTags={1}
                    allowCreate
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.archive.form.preparation")}</Label>
                  <TranslatableTagInput
                    category="preparation"
                    value={formData.preparation ? [formData.preparation] : []}
                    onChange={(codes) => setFormData({ ...formData, preparation: codes[0] || "" })}
                    placeholder={t("admin.archive.placeholders.preparation")}
                    maxTags={1}
                    allowCreate
                  />
                </div>
              </div>

              {/* Keywords */}
              <div className="space-y-2">
                <Label>{t("admin.archive.form.keywords")}</Label>
                <TranslatableTagInput
                  category="keyword"
                  value={formData.keywords}
                  onChange={(codes) => setFormData({ ...formData, keywords: codes })}
                  placeholder={t("admin.archive.placeholders.keywords")}
                  allowCreate
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Files Section */}
          <Collapsible open={filesOpen} onOpenChange={setFilesOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 bg-muted rounded-lg hover:bg-muted/80">
              <Link2 className="h-4 w-4" />
              <span className="font-medium">{t("admin.archive.sections.files")}</span>
              <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${filesOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-6">
                {/* Scan Upload */}
                <div className="space-y-3">
                  <Label>{t("admin.archive.form.scanUrl")}</Label>
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        id="scan_url"
                        value={formData.scan_url}
                        onChange={(e) => setFormData({ ...formData, scan_url: e.target.value })}
                        placeholder={t("admin.archive.placeholders.url")}
                        className="flex-1"
                      />
                      <input
                        ref={scanInputRef}
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload(file, "scan", setUploadingScan);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => scanInputRef.current?.click()}
                        disabled={uploadingScan}
                      >
                        {uploadingScan ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {formData.scan_url && (
                      <div className="rounded-lg border border-border overflow-hidden bg-muted/50">
                        <img
                          src={formData.scan_url}
                          alt={t("admin.archive.form.scanPreviewAlt")}
                          className="w-full h-32 object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Transcript Upload */}
                <div className="space-y-3">
                  <Label>{t("admin.archive.form.transcriptUrl")}</Label>
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        id="transcript_url"
                        value={formData.transcript_url}
                        onChange={(e) => setFormData({ ...formData, transcript_url: e.target.value })}
                        placeholder={t("admin.archive.placeholders.url")}
                        className="flex-1"
                      />
                      <input
                        ref={transcriptInputRef}
                        type="file"
                        accept="application/pdf,.txt,.doc,.docx"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload(file, "transcript", setUploadingTranscript);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => transcriptInputRef.current?.click()}
                        disabled={uploadingTranscript}
                      >
                        {uploadingTranscript ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {formData.transcript_url && (
                      <div className="flex items-center gap-2 p-2 rounded-lg border border-border bg-muted/50">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground truncate flex-1">
                          {formData.transcript_url.split("/").pop()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="content">{t("admin.archive.form.fullContent")}</Label>
                <Textarea
                  id="content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  rows={5}
                  placeholder={t("admin.archive.placeholders.fullContent")}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : editingItem ? (
                t("common.save")
              ) : (
                t("admin.archive.createDocument")
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
