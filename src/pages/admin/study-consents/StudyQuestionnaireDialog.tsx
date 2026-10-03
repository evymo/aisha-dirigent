/**
 * Dialog for adding / editing a study questionnaire assignment.
 * @module StudyQuestionnaireDialog
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { LOCALE_LABELS, type SupportedLocale } from "@/hooks/useDynamicTranslations";

import type { StudyQuestionnaireForm } from "./studyConsentsTypes";

/** Minimal questionnaire shape needed by this dialog. */
interface QuestionnaireOption {
  id: string;
  name: string;
  code: string;
}

interface FrequencyOption {
  label: string;
  value: string;
}

interface StudyQuestionnaireDialogProps {
  editingQuestionnaire: StudyQuestionnaireForm | null;
  frequencyOptions: FrequencyOption[];
  getQuestionnaireTypeLabel: (type: string) => string;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  open: boolean;
  questionnaireTypeOptions: string[];
  questionnaires: QuestionnaireOption[] | undefined;
  setEditingQuestionnaire: Dispatch<SetStateAction<StudyQuestionnaireForm | null>>;
}

export default function StudyQuestionnaireDialog({
  editingQuestionnaire,
  frequencyOptions,
  getQuestionnaireTypeLabel,
  isPending,
  onOpenChange,
  onSave,
  open,
  questionnaireTypeOptions,
  questionnaires,
  setEditingQuestionnaire,
}: StudyQuestionnaireDialogProps) {
  const { t } = useTranslation();
  const [langTab, setLangTab] = useState<SupportedLocale>("cs");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>
            {editingQuestionnaire?.id
              ? t("admin.studyConsents.questionnaires.edit")
              : t("admin.studyConsents.questionnaires.add")}
          </DialogTitle>
          <DialogDescription>
            {t("admin.studyConsents.questionnaires.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("admin.studyConsents.questionnaires.selectQuestionnaire")}</Label>
                <Select
                  value={editingQuestionnaire?.questionnaire_id}
                  onValueChange={(v) =>
                    setEditingQuestionnaire((prev) =>
                      prev ? { ...prev, questionnaire_id: v } : null,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("admin.studyConsents.questionnaires.selectPlaceholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {questionnaires?.map((q) => (
                      <SelectItem key={q.id} value={q.id}>
                        {q.name} ({q.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.studyConsents.questionnaires.type")}</Label>
                <Select
                  value={editingQuestionnaire?.questionnaire_type ?? ""}
                  onValueChange={(value) =>
                    setEditingQuestionnaire((prev) =>
                      prev ? { ...prev, questionnaire_type: value } : null,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("admin.studyConsents.questionnaires.typePlaceholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {questionnaireTypeOptions.map((type) => (
                      <SelectItem key={type} value={type}>
                        {getQuestionnaireTypeLabel(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Language tabs for title and description */}
            <Tabs value={langTab} onValueChange={(v) => setLangTab(v as SupportedLocale)}>
              <TabsList>
                {(["cs", "en"] as const).map((locale) => (
                  <TabsTrigger key={locale} value={locale}>
                    {LOCALE_LABELS[locale]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {(["cs", "en"] as const).map((locale) => (
                <TabsContent key={locale} value={locale} className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t("admin.studyConsents.questionnaires.titleLabel")}</Label>
                    <Input
                      value={editingQuestionnaire?.title[locale] ?? ""}
                      onChange={(e) =>
                        setEditingQuestionnaire((prev) =>
                          prev
                            ? { ...prev, title: { ...prev.title, [locale]: e.target.value } }
                            : null,
                        )
                      }
                      placeholder={t("admin.studyConsents.questionnaires.titlePlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.studyConsents.questionnaires.descriptionLabel")}</Label>
                    <Textarea
                      value={editingQuestionnaire?.description[locale] ?? ""}
                      onChange={(e) =>
                        setEditingQuestionnaire((prev) =>
                          prev
                            ? {
                                ...prev,
                                description: { ...prev.description, [locale]: e.target.value },
                              }
                            : null,
                        )
                      }
                      placeholder={t("admin.studyConsents.questionnaires.descriptionPlaceholder")}
                      rows={3}
                    />
                  </div>
                </TabsContent>
              ))}
            </Tabs>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("admin.studyConsents.questionnaires.frequency")}</Label>
                <Select
                  value={editingQuestionnaire?.frequency_type}
                  onValueChange={(v) =>
                    setEditingQuestionnaire((prev) =>
                      prev ? { ...prev, frequency_type: v } : null,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {frequencyOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.studyConsents.questionnaires.tokenReward")}</Label>
                <Input
                  type="number"
                  value={editingQuestionnaire?.token_reward ?? 0}
                  onChange={(e) =>
                    setEditingQuestionnaire((prev) =>
                      prev ? { ...prev, token_reward: parseInt(e.target.value) || 0 } : null,
                    )
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{t("admin.studyConsents.questionnaires.displayOrder")}</Label>
                <Input
                  type="number"
                  value={editingQuestionnaire?.display_order ?? 1}
                  onChange={(e) =>
                    setEditingQuestionnaire((prev) =>
                      prev ? { ...prev, display_order: parseInt(e.target.value) || 1 } : null,
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.studyConsents.questionnaires.startsAfterDays")}</Label>
                <Input
                  type="number"
                  value={editingQuestionnaire?.starts_after_days ?? 0}
                  onChange={(e) =>
                    setEditingQuestionnaire((prev) =>
                      prev ? { ...prev, starts_after_days: parseInt(e.target.value) || 0 } : null,
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.studyConsents.questionnaires.endsAfterDays")}</Label>
                <Input
                  type="number"
                  value={editingQuestionnaire?.ends_after_days ?? ""}
                  onChange={(e) =>
                    setEditingQuestionnaire((prev) =>
                      prev
                        ? { ...prev, ends_after_days: e.target.value ? parseInt(e.target.value) : null }
                        : null,
                    )
                  }
                  placeholder={t("admin.studyConsents.questionnaires.endsAfterDaysPlaceholder")}
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={editingQuestionnaire?.is_required ?? true}
                  onCheckedChange={(checked) =>
                    setEditingQuestionnaire((prev) =>
                      prev ? { ...prev, is_required: checked } : null,
                    )
                  }
                />
                <Label>{t("common.required")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={editingQuestionnaire?.is_active ?? true}
                  onCheckedChange={(checked) =>
                    setEditingQuestionnaire((prev) =>
                      prev ? { ...prev, is_active: checked } : null,
                    )
                  }
                />
                <Label>{t("common.active")}</Label>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onSave} disabled={isPending}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
