import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import {
  type QuestionFormData,
  type QuestionType,
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  QUESTION_TYPES,
  emptyLocaleRecord,
} from "./types";

interface QuestionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingQuestion: QuestionFormData | null;
  setEditingQuestion: React.Dispatch<React.SetStateAction<QuestionFormData | null>>;
  onSave: () => void;
}

export function QuestionDialog({
  open,
  onOpenChange,
  editingQuestion,
  setEditingQuestion,
  onSave,
}: QuestionDialogProps) {
  const { t } = useTranslation();

  const handleAddOption = () => {
    if (!editingQuestion) return;
    setEditingQuestion(prev => ({
      ...prev!,
      options: [...prev!.options, { value: `opt_${Date.now()}`, label: emptyLocaleRecord() }],
    }));
  };

  const handleRemoveOption = (index: number) => {
    if (!editingQuestion) return;
    setEditingQuestion(prev => ({
      ...prev!,
      options: prev!.options.filter((_, i) => i !== index),
    }));
  };

  const handleAddScaleLabel = () => {
    if (!editingQuestion) return;
    setEditingQuestion((prev) => ({
      ...prev!,
      scaleLabels: [
        ...prev!.scaleLabels,
        { value: `${(prev!.scaleLabels.length ?? 0) + 1}`, label: emptyLocaleRecord() },
      ],
    }));
  };

  const handleRemoveScaleLabel = (index: number) => {
    if (!editingQuestion) return;
    setEditingQuestion((prev) => ({
      ...prev!,
      scaleLabels: prev!.scaleLabels.filter((_, i) => i !== index),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("admin.questionnaires.editQuestion")}</DialogTitle>
        </DialogHeader>

        {editingQuestion && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("admin.questionnaires.questionType")}</Label>
                <Select
                  value={editingQuestion.type}
                  onValueChange={(v) => setEditingQuestion(prev => ({ ...prev!, type: v as QuestionType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUESTION_TYPES.map(type => (
                      <SelectItem key={type} value={type}>
                        {t(`admin.questionnaires.types.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.questionnaires.questionId")}</Label>
                <Input
                  value={editingQuestion.id}
                  onChange={(e) => setEditingQuestion(prev => ({ ...prev!, id: e.target.value }))}
                />
              </div>
            </div>

            <Tabs defaultValue="en">
              <TabsList>
                {SUPPORTED_LOCALES.map(lang => (
                  <TabsTrigger key={lang} value={lang}>
                    {LOCALE_LABELS[lang]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {SUPPORTED_LOCALES.map(lang => (
                <TabsContent key={lang} value={lang} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>{t("admin.questionnaires.questionText")} ({LOCALE_LABELS[lang]}) *</Label>
                    <Textarea
                      value={editingQuestion.text[lang]}
                      onChange={(e) => setEditingQuestion(prev => ({
                        ...prev!,
                        text: { ...prev!.text, [lang]: e.target.value },
                      }))}
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.questionnaires.questionDescription")} ({LOCALE_LABELS[lang]})</Label>
                    <Input
                      value={editingQuestion.description[lang]}
                      onChange={(e) => setEditingQuestion(prev => ({
                        ...prev!,
                        description: { ...prev!.description, [lang]: e.target.value },
                      }))}
                      placeholder={t("admin.questionnaires.descriptionPlaceholder")}
                    />
                  </div>
                </TabsContent>
              ))}
            </Tabs>

            <div className="flex items-center space-x-2">
              <Switch
                checked={editingQuestion.required}
                onCheckedChange={(checked) => setEditingQuestion(prev => ({ ...prev!, required: checked }))}
              />
              <Label>{t("admin.questionnaires.requiredField")}</Label>
            </div>

            {editingQuestion.type === "scale" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("admin.questionnaires.minValue")}</Label>
                  <Input
                    type="number"
                    value={editingQuestion.min}
                    onChange={(e) => setEditingQuestion(prev => ({ ...prev!, min: parseInt(e.target.value) || 1 }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.questionnaires.maxValue")}</Label>
                  <Input
                    type="number"
                    value={editingQuestion.max}
                    onChange={(e) => setEditingQuestion(prev => ({ ...prev!, max: parseInt(e.target.value) || 10 }))}
                  />
                </div>
              </div>
            )}

            {editingQuestion.type === "scale" && (
              <ScaleLabelsEditor
                scaleLabels={editingQuestion.scaleLabels}
                onAdd={handleAddScaleLabel}
                onRemove={handleRemoveScaleLabel}
                onChange={(newLabels) => setEditingQuestion(prev => ({ ...prev!, scaleLabels: newLabels }))}
              />
            )}

            {["select", "radio", "checkbox"].includes(editingQuestion.type) && (
              <OptionsEditor
                options={editingQuestion.options}
                onAdd={handleAddOption}
                onRemove={handleRemoveOption}
                onChange={(newOptions) => setEditingQuestion(prev => ({ ...prev!, options: newOptions }))}
              />
            )}

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" onClick={onSave}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ScaleLabelsEditorProps {
  scaleLabels: QuestionFormData["scaleLabels"];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (labels: QuestionFormData["scaleLabels"]) => void;
}

function ScaleLabelsEditor({ scaleLabels, onAdd, onRemove, onChange }: ScaleLabelsEditorProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{t("admin.questionnaires.scaleLabels")}</Label>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1" />
          {t("admin.questionnaires.addScaleLabel")}
        </Button>
      </div>
      {scaleLabels.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t("admin.questionnaires.noScaleLabels")}
        </p>
      ) : (
        <div className="space-y-2">
          {scaleLabels.map((label, index) => (
            <div key={index} className="flex gap-2 items-start p-3 bg-muted/50 rounded">
              <div className="w-20">
                <Input
                  value={label.value}
                  onChange={(e) => {
                    const newLabels = [...scaleLabels];
                    newLabels[index] = { ...newLabels[index], value: e.target.value };
                    onChange(newLabels);
                  }}
                />
              </div>
              <div className="flex-1 grid grid-cols-2 gap-2">
                {SUPPORTED_LOCALES.map((lang) => (
                  <Input
                    key={lang}
                    placeholder={`${LOCALE_LABELS[lang]}...`}
                    value={label.label[lang]}
                    onChange={(e) => {
                      const newLabels = [...scaleLabels];
                      newLabels[index] = {
                        ...newLabels[index],
                        label: { ...newLabels[index].label, [lang]: e.target.value },
                      };
                      onChange(newLabels);
                    }}
                  />
                ))}
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(index)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface OptionsEditorProps {
  options: QuestionFormData["options"];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (options: QuestionFormData["options"]) => void;
}

function OptionsEditor({ options, onAdd, onRemove, onChange }: OptionsEditorProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{t("admin.questionnaires.options")}</Label>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1" />
          {t("admin.questionnaires.addOption")}
        </Button>
      </div>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t("admin.questionnaires.noOptions")}
        </p>
      ) : (
        <div className="space-y-2">
          {options.map((option, index) => (
            <div key={index} className="flex gap-2 items-start p-3 bg-muted/50 rounded">
              <div className="flex-1 grid grid-cols-2 gap-2">
                {SUPPORTED_LOCALES.map(lang => (
                  <Input
                    key={lang}
                    placeholder={`${LOCALE_LABELS[lang]}...`}
                    value={option.label[lang]}
                    onChange={(e) => {
                      const newOptions = [...options];
                      newOptions[index] = {
                        ...newOptions[index],
                        label: { ...newOptions[index].label, [lang]: e.target.value },
                      };
                      onChange(newOptions);
                    }}
                  />
                ))}
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(index)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
