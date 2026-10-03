/**
 * Dialog for managing study consent requirements.
 * @module ConsentRequirementDialog
 */

import type { Dispatch, SetStateAction } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import type { ConsentTemplateAdmin } from "@/hooks";

import type { StudyConsentRequirementForm } from "./studyConsentsTypes";

interface ConsentRequirementDialogProps {
  consentTemplates: ConsentTemplateAdmin[] | undefined;
  editingRequirement: StudyConsentRequirementForm | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  open: boolean;
  setEditingRequirement: Dispatch<SetStateAction<StudyConsentRequirementForm | null>>;
}

export default function ConsentRequirementDialog({
  consentTemplates,
  editingRequirement,
  isPending,
  onOpenChange,
  onSave,
  open,
  setEditingRequirement,
}: ConsentRequirementDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.studyConsents.requirements.add")}</DialogTitle>
          <DialogDescription>{t("admin.studyConsents.requirements.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("admin.studyConsents.requirements.selectTemplate")}</Label>
            <Select
              value={editingRequirement?.consent_template_id}
              onValueChange={(v) =>
                setEditingRequirement((prev) =>
                  prev ? { ...prev, consent_template_id: v } : null,
                )
              }
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("admin.studyConsents.requirements.selectTemplatePlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                {consentTemplates?.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.template_key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={editingRequirement?.is_required ?? true}
                onCheckedChange={(checked) =>
                  setEditingRequirement((prev) =>
                    prev ? { ...prev, is_required: checked } : null,
                  )
                }
              />
              <Label>{t("common.required")}</Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("admin.studyConsents.requirements.sortOrder")}</Label>
            <Input
              type="number"
              value={editingRequirement?.sort_order ?? 1}
              onChange={(e) =>
                setEditingRequirement((prev) =>
                  prev ? { ...prev, sort_order: parseInt(e.target.value) || 1 } : null,
                )
              }
            />
          </div>
        </div>

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
