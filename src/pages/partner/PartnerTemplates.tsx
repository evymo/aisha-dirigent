/**
 * Partner Templates Page
 * 
 * Allows partners to manage their StoryLoop templates.
 */

import { useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Plus, Edit, Trash2, LayoutTemplate, CheckCircle, XCircle } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { PartnerTemplateBuilder } from "@/components/storyloop/PartnerTemplateBuilder";
import {
  usePartnerTemplates,
  useSavePartnerTemplate,
  useDeletePartnerTemplate,
  PartnerTemplateRow,
} from "@/hooks/usePartnerTemplates";
import { useMyPartnerProfile } from "@/hooks/usePartners";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { PartnerTemplate } from "@/schemas/partnerTemplateSchemas";

export default function PartnerTemplates() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);
  
  const { data: partnerProfile } = useMyPartnerProfile();
  const { data: templates, isLoading } = usePartnerTemplates(partnerProfile?.id);
  const saveTemplate = useSavePartnerTemplate();
  const deleteTemplate = useDeletePartnerTemplate();

  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PartnerTemplateRow | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleCreateNew = () => {
    setEditingTemplate(null);
    setIsBuilderOpen(true);
  };

  const handleEdit = (template: PartnerTemplateRow) => {
    setEditingTemplate(template);
    setIsBuilderOpen(true);
  };

  const handleSave = async (templateData: Partial<PartnerTemplate>) => {
    await saveTemplate.mutateAsync({
      ...templateData,
      id: editingTemplate?.id,
    });
    setIsBuilderOpen(false);
    setEditingTemplate(null);
  };

  const handleDelete = async () => {
    if (deleteConfirmId) {
      await deleteTemplate.mutateAsync(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const categoryLabels: Record<string, string> = {
    onboarding: t("templates.categoryOnboarding"),
    follow_up: t("templates.categoryFollowUp"),
    assessment: t("templates.categoryAssessment"),
    custom: t("templates.categoryCustom"),
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <LayoutTemplate className="h-6 w-6" />
              {t("partnerTemplates.title")}
            </h1>
            <p className="text-muted-foreground">
              {t("partnerTemplates.description")}
            </p>
          </div>
          <Button onClick={handleCreateNew}>
            <Plus className="h-4 w-4 mr-2" />
            {t("partnerTemplates.create")}
          </Button>
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="h-24 bg-muted rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : templates && templates.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <Card
                key={template.id}
                className={cn(
                  "relative group cursor-pointer transition-shadow hover:shadow-md",
                  !template.is_active && "opacity-60"
                )}
                onClick={() => handleEdit(template)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">
                        {template.name}
                      </CardTitle>
                      <CardDescription className="line-clamp-2">
                        {template.description || t("templates.noDescription")}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {template.is_active ? (
                        <CheckCircle className="h-4 w-4 text-chart-2" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 flex-wrap mb-3">
                    <Badge variant="outline">
                      {categoryLabels[template.category] || template.category}
                    </Badge>
                    {template.is_default && (
                      <Badge variant="secondary">
                        {t("templates.isDefault")}
                      </Badge>
                    )}
                    <Badge variant="secondary">
                      {template.blocks.length} {t("templates.blocks")}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {t("templates.updated")} {" "}
                      {format(new Date(template.updated_at), "d. MMM yyyy", {
                        locale: dateLocale,
                      })}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(template);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(template.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="text-center py-12">
            <CardContent>
              <LayoutTemplate className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {t("partnerTemplates.empty")}
              </h3>
              <p className="text-muted-foreground mb-4">
                {t("partnerTemplates.emptyHint")}
              </p>
              <Button onClick={handleCreateNew}>
                <Plus className="h-4 w-4 mr-2" />
                {t("partnerTemplates.create")}
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />

      {/* Template Builder Dialog */}
      <Dialog open={isBuilderOpen} onOpenChange={setIsBuilderOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate
                ? t("templates.editTemplate")
                : t("templates.createTemplate")}
            </DialogTitle>
            <DialogDescription>
              {t("templates.builderHint")}
            </DialogDescription>
          </DialogHeader>
          <PartnerTemplateBuilder
            template={
              editingTemplate
                ? {
                    ...editingTemplate,
                    description: editingTemplate.description ?? undefined,
                    category: editingTemplate.category as "onboarding" | "follow_up" | "assessment" | "custom",
                    usage_count: 0,
                    last_used_at: null,
                  }
                : undefined
            }
            onSave={handleSave}
            onCancel={() => setIsBuilderOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("partnerTemplates.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("partnerTemplates.deleteConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("partnerTemplates.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
