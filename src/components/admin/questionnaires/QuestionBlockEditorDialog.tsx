import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Plus, Trash2, Eye, Frown, Annoyed, Meh, Smile, Laugh } from "lucide-react";
import {
  type QuestionBlockFormData,
  type QuestionType,
  type QuestionOption,
  type SupportedLanguage,
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  emptyLocaleRecord,
} from "./types";

interface QuestionBlockEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  block: QuestionBlockFormData | null;
  onChange: (block: QuestionBlockFormData) => void;
  onSave: () => void;
  isSaving: boolean;
}

/** Type categories for grouping in UI */
const TYPE_CATEGORIES = {
  input: ["text", "textarea", "number", "date"] as QuestionType[],
  choice: ["select", "radio", "checkbox", "boolean"] as QuestionType[],
  special: ["scale", "tags", "feeling_preset"] as QuestionType[],
};

/**
 * Full-featured block editor dialog supporting all 11 question types
 * with extended config (scoring, sections, tags, reversed flags) and live preview.
 */
export function QuestionBlockEditorDialog({
  open,
  onOpenChange,
  block,
  onChange,
  onSave,
  isSaving,
}: QuestionBlockEditorDialogProps) {
  const { t, i18n } = useTranslation();
  const [activeLang, setActiveLang] = useState<SupportedLanguage>(
    (i18n.language as SupportedLanguage) || "en"
  );
  const [showPreview, setShowPreview] = useState(false);

  if (!block) return null;

  const update = (patch: Partial<QuestionBlockFormData>) =>
    onChange({ ...block, ...patch });

  const hasOptions = ["select", "radio", "checkbox"].includes(block.type);
  const hasScale = block.type === "scale";
  const hasTags = block.type === "tags";
  const hasDate = block.type === "date";
  const hasBoolean = block.type === "boolean";
  const hasFeeling = block.type === "feeling_preset";
  const hasScoring = true; // All types can have scoring config

  // Option management
  const addOption = () => {
    update({
      options: [...block.options, { value: `opt_${Date.now()}`, label: emptyLocaleRecord() }],
    });
  };

  const removeOption = (index: number) => {
    update({ options: block.options.filter((_, i) => i !== index) });
  };

  const updateOption = (index: number, patch: Partial<QuestionOption>) => {
    const next = [...block.options];
    next[index] = { ...next[index], ...patch };
    update({ options: next });
  };

  const addScaleLabel = () => {
    update({
      scaleLabels: [
        ...block.scaleLabels,
        { value: `${block.scaleLabels.length + 1}`, label: emptyLocaleRecord() },
      ],
    });
  };

  const removeScaleLabel = (index: number) => {
    update({ scaleLabels: block.scaleLabels.filter((_, i) => i !== index) });
  };

  const updateScaleLabel = (index: number, patch: Partial<QuestionOption>) => {
    const next = [...block.scaleLabels];
    next[index] = { ...next[index], ...patch };
    update({ scaleLabels: next });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {block.id
              ? t("admin.questionnaires.blocks.edit")
              : t("admin.questionnaires.blocks.add")}
          </DialogTitle>
          <DialogDescription>
            {t("admin.questionnaires.blocks.formDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Code & Type */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("admin.questionnaires.blocks.form.code")} *</Label>
              <Input
                value={block.code}
                onChange={(e) => update({ code: e.target.value })}
                disabled={Boolean(block.id)}
                placeholder="e.g., os_energy_level"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.questionnaires.blocks.form.type")}</Label>
              <Select
                value={block.type}
                onValueChange={(v) => update({ type: v as QuestionType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_CATEGORIES).map(([category, types]) => (
                    <div key={category}>
                      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase">
                        {t(`admin.questionnaires.blockEditor.category.${category}`, category)}
                      </div>
                      {types.map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(`admin.questionnaires.types.${type}`, type)}
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Language switcher */}
          <div className="flex items-center justify-between">
            <Tabs
              value={activeLang}
              onValueChange={(v) => setActiveLang(v as SupportedLanguage)}
            >
              <TabsList className="h-8">
                {SUPPORTED_LOCALES.map((lang) => (
                  <TabsTrigger key={lang} value={lang} className="text-xs px-3">
                    {LOCALE_LABELS[lang]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
            >
              <Eye className="h-4 w-4 mr-1" />
              {t("admin.questionnaires.blockEditor.preview")}
            </Button>
          </div>

          {/* Text & Description */}
          <div className="space-y-2">
            <Label>
              {t("admin.questionnaires.blocks.form.text")} ({LOCALE_LABELS[activeLang]}) *
            </Label>
            <Textarea
              value={block.text[activeLang]}
              onChange={(e) =>
                update({ text: { ...block.text, [activeLang]: e.target.value } })
              }
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>
              {t("admin.questionnaires.blocks.form.description")} ({LOCALE_LABELS[activeLang]})
            </Label>
            <Textarea
              value={block.description[activeLang]}
              onChange={(e) =>
                update({ description: { ...block.description, [activeLang]: e.target.value } })
              }
              rows={2}
            />
          </div>

          {/* Toggles row */}
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center space-x-2">
              <Switch
                checked={block.required}
                onCheckedChange={(checked) => update({ required: checked })}
              />
              <Label>{t("admin.questionnaires.requiredField")}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                checked={block.is_active}
                onCheckedChange={(checked) => update({ is_active: checked })}
              />
              <Label>{t("admin.questionnaires.form.active")}</Label>
            </div>
          </div>

          {/* Type-specific config */}

          {/* Scale config */}
          {hasScale && (
            <div className="space-y-4 border rounded-lg p-4">
              <h4 className="font-medium">{t("admin.questionnaires.blockEditor.scaleConfig")}</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.questionnaires.minValue")}</Label>
                  <Input
                    type="number"
                    value={block.min}
                    onChange={(e) => update({ min: parseInt(e.target.value) || 1 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.questionnaires.maxValue")}</Label>
                  <Input
                    type="number"
                    value={block.max}
                    onChange={(e) => update({ max: parseInt(e.target.value) || 10 })}
                  />
                </div>
              </div>

              {/* Scale labels */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("admin.questionnaires.scaleLabels")}</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addScaleLabel}>
                    <Plus className="h-4 w-4 mr-1" />
                    {t("admin.questionnaires.addScaleLabel")}
                  </Button>
                </div>
                {block.scaleLabels.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    {t("admin.questionnaires.noScaleLabels")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {block.scaleLabels.map((label, index) => (
                      <div key={index} className="flex gap-2 items-start p-3 bg-muted/50 rounded">
                        <div className="w-16">
                          <Input
                            value={label.value}
                            onChange={(e) => updateScaleLabel(index, { value: e.target.value })}
                            placeholder="#"
                          />
                        </div>
                        <div className="flex-1">
                          <Input
                            placeholder={`${LOCALE_LABELS[activeLang]}...`}
                            value={label.label[activeLang]}
                            onChange={(e) =>
                              updateScaleLabel(index, {
                                label: { ...label.label, [activeLang]: e.target.value },
                              })
                            }
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeScaleLabel(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Options for select/radio/checkbox */}
          {hasOptions && (
            <div className="space-y-3 border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">{t("admin.questionnaires.options")}</h4>
                <Button type="button" size="sm" variant="outline" onClick={addOption}>
                  <Plus className="h-4 w-4 mr-1" />
                  {t("admin.questionnaires.addOption")}
                </Button>
              </div>
              {block.options.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">
                  {t("admin.questionnaires.noOptions")}
                </p>
              ) : (
                <div className="space-y-2">
                  {block.options.map((option, index) => (
                    <div key={index} className="flex gap-2 items-start p-3 bg-muted/50 rounded">
                      <div className="w-24">
                        <Input
                          value={option.value}
                          onChange={(e) => updateOption(index, { value: e.target.value })}
                          placeholder="value"
                        />
                      </div>
                      <div className="flex-1">
                        <Input
                          placeholder={`${LOCALE_LABELS[activeLang]}...`}
                          value={option.label[activeLang]}
                          onChange={(e) =>
                            updateOption(index, {
                              label: { ...option.label, [activeLang]: e.target.value },
                            })
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeOption(index)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tags config */}
          {hasTags && (
            <div className="space-y-4 border rounded-lg p-4">
              <h4 className="font-medium">{t("admin.questionnaires.blockEditor.tagsConfig")}</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.questionnaires.blockEditor.emoji")}</Label>
                  <Input
                    value={block.emoji}
                    onChange={(e) => update({ emoji: e.target.value })}
                    placeholder="e.g., activity"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.questionnaires.blockEditor.tagCategory")}</Label>
                  <Input
                    value={block.tag_category}
                    onChange={(e) => update({ tag_category: e.target.value })}
                    placeholder="e.g., symptoms"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={block.multi_select}
                      onCheckedChange={(checked) => update({ multi_select: checked })}
                    />
                    <Label>{t("admin.questionnaires.blockEditor.multiSelect")}</Label>
                  </div>
                </div>
              </div>

              {/* Tag options (reuse option list) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t("admin.questionnaires.blockEditor.tagOptions")}</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addOption}>
                    <Plus className="h-4 w-4 mr-1" />
                    {t("admin.questionnaires.addOption")}
                  </Button>
                </div>
                {block.options.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    {t("admin.questionnaires.blockEditor.noTagOptions")}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {block.options.map((option, index) => (
                      <div key={index} className="flex gap-2 items-center p-2 bg-muted/50 rounded">
                        <div className="flex-1">
                          <Input
                            placeholder={`${LOCALE_LABELS[activeLang]}...`}
                            value={option.label[activeLang]}
                            onChange={(e) =>
                              updateOption(index, {
                                label: { ...option.label, [activeLang]: e.target.value },
                              })
                            }
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => removeOption(index)}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Date config */}
          {hasDate && (
            <div className="space-y-4 border rounded-lg p-4">
              <h4 className="font-medium">{t("admin.questionnaires.blockEditor.dateConfig")}</h4>
              <div className="space-y-2">
                <Label>{t("admin.questionnaires.blockEditor.dateFormat")}</Label>
                <Select
                  value={block.date_format}
                  onValueChange={(v) => update({ date_format: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DD.MM.YYYY">DD.MM.YYYY</SelectItem>
                    <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                    <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Boolean config */}
          {hasBoolean && (
            <div className="space-y-4 border rounded-lg p-4">
              <h4 className="font-medium">{t("admin.questionnaires.blockEditor.booleanConfig")}</h4>
              <p className="text-sm text-muted-foreground">
                {t("admin.questionnaires.blockEditor.booleanDescription")}
              </p>
            </div>
          )}

          {/* Feeling preset config */}
          {hasFeeling && (
            <div className="space-y-4 border rounded-lg p-4">
              <h4 className="font-medium">{t("admin.questionnaires.blockEditor.feelingConfig")}</h4>
              <p className="text-sm text-muted-foreground">
                {t("admin.questionnaires.blockEditor.feelingDescription")}
              </p>
            </div>
          )}

          {/* Scoring / Advanced config — collapsible */}
          {hasScoring && (
            <Accordion type="single" collapsible>
              <AccordionItem value="scoring">
                <AccordionTrigger className="text-sm font-medium">
                  {t("admin.questionnaires.blockEditor.scoringConfig")}
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t("admin.questionnaires.blockEditor.scoringDomain")}</Label>
                      <Input
                        value={block.scoring_domain}
                        onChange={(e) => update({ scoring_domain: e.target.value })}
                        placeholder="e.g., vitality, immunity, pain"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("admin.questionnaires.blockEditor.scoringDomainHelp")}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("admin.questionnaires.blockEditor.sectionKey")}</Label>
                      <Input
                        value={block.section_key}
                        onChange={(e) => update({ section_key: e.target.value })}
                        placeholder="e.g., A, B, C"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("admin.questionnaires.blockEditor.sectionKeyHelp")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={block.reversed}
                      onCheckedChange={(checked) => update({ reversed: checked })}
                    />
                    <Label>{t("admin.questionnaires.blockEditor.reversed")}</Label>
                    <span className="text-xs text-muted-foreground ml-2">
                      {t("admin.questionnaires.blockEditor.reversedHelp")}
                    </span>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          {/* Live Preview */}
          {showPreview && (
            <div className="border rounded-lg p-4 bg-muted/30">
              <h4 className="font-medium mb-3">
                {t("admin.questionnaires.blockEditor.previewTitle")}
              </h4>
              <BlockPreview block={block} lang={activeLang} />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={onSave} disabled={isSaving}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** WYSIWYG-style preview of how the block renders */
function BlockPreview({
  block,
  lang,
}: {
  block: QuestionBlockFormData;
  lang: SupportedLanguage;
}) {
  const { t } = useTranslation();
  const text = block.text[lang] || block.text.en || block.code;
  const description = block.description[lang] || block.description.en;

  return (
    <div className="space-y-3 max-w-md">
      <div>
        <p className="font-medium text-sm">
          {text}
          {block.required && <span className="text-destructive ml-1">*</span>}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>

      {/* Render preview based on type */}
      {block.type === "text" && (
        <Input disabled placeholder={t("admin.questionnaires.blockEditor.previewPlaceholder")} />
      )}

      {block.type === "textarea" && (
        <Textarea disabled rows={3} placeholder={t("admin.questionnaires.blockEditor.previewPlaceholder")} />
      )}

      {block.type === "number" && (
        <Input type="number" disabled placeholder="0" className="w-32" />
      )}

      {block.type === "date" && (
        <Input type="date" disabled className="w-48" />
      )}

      {block.type === "scale" && (
        <div className="space-y-1">
          <div className="flex gap-1">
            {Array.from({ length: block.max - block.min + 1 }, (_, i) => block.min + i).map(
              (val) => (
                <button
                  key={val}
                  type="button"
                  disabled
                  className="w-8 h-8 rounded border text-xs font-medium bg-background"
                >
                  {val}
                </button>
              )
            )}
          </div>
          {block.scaleLabels.length > 0 && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{block.scaleLabels[0]?.label[lang]}</span>
              {block.scaleLabels.length > 1 && (
                <span>{block.scaleLabels[block.scaleLabels.length - 1]?.label[lang]}</span>
              )}
            </div>
          )}
        </div>
      )}

      {(block.type === "select" || block.type === "radio" || block.type === "checkbox") && (
        <div className="space-y-1">
          {block.options.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              {t("admin.questionnaires.noOptions")}
            </p>
          ) : (
            block.options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <div
                  className={`w-4 h-4 border rounded${
                    block.type === "radio" ? "-full" : ""
                  }`}
                />
                <span>{opt.label[lang] || opt.value}</span>
              </div>
            ))
          )}
        </div>
      )}

      {block.type === "boolean" && (
        <div className="flex gap-4">
          <Badge variant="outline" className="px-4 py-1 cursor-default">
            {t("common.yes")}
          </Badge>
          <Badge variant="outline" className="px-4 py-1 cursor-default">
            {t("common.no")}
          </Badge>
        </div>
      )}

      {block.type === "tags" && (
        <div className="flex flex-wrap gap-2">
          {block.options.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              {t("admin.questionnaires.blockEditor.noTagOptions")}
            </p>
          ) : (
            block.options.map((opt, i) => (
              <Badge
                key={i}
                variant="outline"
                className="px-3 py-1 cursor-default"
              >
                {opt.label[lang] || opt.value}
              </Badge>
            ))
          )}
          {block.multi_select && (
            <span className="text-xs text-muted-foreground self-center">
              ({t("admin.questionnaires.blockEditor.multiSelect")})
            </span>
          )}
        </div>
      )}

      {block.type === "feeling_preset" && (
        <div className="flex gap-3">
          {[Frown, Annoyed, Meh, Smile, Laugh].map((Icon, i) => (
            <button
              key={i}
              type="button"
              disabled
              className="w-10 h-10 rounded-lg border bg-background flex items-center justify-center"
            >
              <Icon className="h-5 w-5 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {/* Scoring info badge */}
      {block.scoring_domain && (
        <div className="flex items-center gap-2 pt-2 border-t">
          <Badge variant="secondary" className="text-xs">
            {t("admin.questionnaires.blockEditor.domain")}: {block.scoring_domain}
          </Badge>
          {block.section_key && (
            <Badge variant="outline" className="text-xs">
              {t("admin.questionnaires.blockEditor.section")}: {block.section_key}
            </Badge>
          )}
          {block.reversed && (
            <Badge variant="destructive" className="text-xs">
              {t("admin.questionnaires.blockEditor.reversedShort")}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
