/**
 * Dialog for creating / editing a consent template.
 * @module ConsentTemplateDialog
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { LOCALE_LABELS, type SupportedLocale } from "@/hooks/useDynamicTranslations";

import type { ConsentTemplateForm } from "./studyConsentsTypes";

interface ConsentTemplateDialogProps {
  editingTemplate: ConsentTemplateForm | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  open: boolean;
  setEditingTemplate: Dispatch<SetStateAction<ConsentTemplateForm | null>>;
}

export default function ConsentTemplateDialog({
  editingTemplate,
  isPending,
  onOpenChange,
  onSave,
  open,
  setEditingTemplate,
}: ConsentTemplateDialogProps) {
  const { t } = useTranslation();
  const [langTab, setLangTab] = useState<SupportedLocale>("cs");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>
            {editingTemplate?.id
              ? t("admin.studyConsents.templates.edit")
              : t("admin.studyConsents.templates.new")}
          </DialogTitle>
          <DialogDescription>{t("admin.studyConsents.templates.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("admin.studyConsents.templates.key")}</Label>
                <Input
                  value={editingTemplate?.template_key ?? ""}
                  onChange={(e) =>
                    setEditingTemplate((prev) =>
                      prev ? { ...prev, template_key: e.target.value } : null,
                    )
                  }
                  placeholder={t("admin.studyConsents.templates.keyPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("admin.studyConsents.templates.version")}</Label>
                <Input
                  value={editingTemplate?.version ?? ""}
                  onChange={(e) =>
                    setEditingTemplate((prev) =>
                      prev ? { ...prev, version: e.target.value } : null,
                    )
                  }
                  placeholder={t("admin.studyConsents.templates.versionPlaceholder")}
                />
              </div>
            </div>

            {/* Language tabs for title and content */}
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
                    <Label>{t("admin.studyConsents.templates.title")}</Label>
                    <Input
                      value={editingTemplate?.title[locale] ?? ""}
                      onChange={(e) =>
                        setEditingTemplate((prev) =>
                          prev
                            ? { ...prev, title: { ...prev.title, [locale]: e.target.value } }
                            : null,
                        )
                      }
                      placeholder={t("admin.studyConsents.templates.titlePlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.studyConsents.templates.content")}</Label>
                    <Textarea
                      value={editingTemplate?.content[locale] ?? ""}
                      onChange={(e) =>
                        setEditingTemplate((prev) =>
                          prev
                            ? { ...prev, content: { ...prev.content, [locale]: e.target.value } }
                            : null,
                        )
                      }
                      placeholder={t("admin.studyConsents.templates.contentPlaceholder")}
                      rows={6}
                    />
                  </div>
                </TabsContent>
              ))}
            </Tabs>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={editingTemplate?.requires_signature ?? false}
                  onCheckedChange={(checked) =>
                    setEditingTemplate((prev) =>
                      prev ? { ...prev, requires_signature: checked } : null,
                    )
                  }
                />
                <Label>{t("admin.studyConsents.templates.requiresSignature")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={editingTemplate?.is_active ?? true}
                  onCheckedChange={(checked) =>
                    setEditingTemplate((prev) =>
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
