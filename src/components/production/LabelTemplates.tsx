import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, FileText, Archive, Eye, Download, ExternalLink, CheckCircle } from "lucide-react";
import {
  useLabelTemplatesAdmin,
  useLabelArchiveAdmin,
  useProductsForLabels,
  useInitializeLabels,
  useArchiveLabelTemplate,
} from "@/hooks/useLabelTemplates";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import type { LabelTemplateAdminRow, LabelArchivePublicAdminRow } from "@/lib/schemas/adminSchemas";

export default function LabelTemplates() {
  const { t } = useTranslation();
  const [selectedLabel, setSelectedLabel] = useState<LabelTemplateAdminRow | null>(null);

  const { data: templates, isLoading } = useLabelTemplatesAdmin();
  const { data: archivedLabels } = useLabelArchiveAdmin();
  const { data: products } = useProductsForLabels();
  const initializeLabelsMutation = useInitializeLabels();
  const archiveLabelMutation = useArchiveLabelTemplate();

  // Resolve translation keys for display
  const allLabelKeys = (templates ?? []).flatMap(t => [
    t.product_name_key, t.description_key, t.composition_key, t.usage_instructions_key,
  ].filter((k): k is string => Boolean(k)));
  const translationsMap = useDynamicTranslationsMap(allLabelKeys, 'labels', 'en');

  const handleInitialize = () => {
    initializeLabelsMutation.mutate(undefined, {
      onSuccess: () => toast.success(t("admin.production.labels.initialized")),
      onError: () => toast.error(t("admin.production.labels.errors.initFailed")),
    });
  };

  const handleArchive = (template: LabelTemplateAdminRow) => {
    archiveLabelMutation.mutate(template, {
      onSuccess: () => toast.success(t("admin.production.labels.archived")),
      onError: () => toast.error(t("admin.production.labels.errors.archiveFailed")),
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle className="w-3 h-3 mr-1" />
            {t("admin.production.labels.status.active")}
          </Badge>
        );
      case "draft":
        return <Badge variant="outline">{t("admin.production.labels.status.draft")}</Badge>;
      case "archived":
        return <Badge variant="secondary">{t("admin.production.labels.status.archived")}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{t("admin.production.labels.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("admin.production.labels.subtitle")}</p>
        </div>
        {(!templates || templates.length === 0) && products && products.length > 0 && (
          <Button onClick={handleInitialize} disabled={initializeLabelsMutation.isPending}>
            <Plus className="w-4 h-4 mr-2" />
            {t("admin.production.labels.initializeFromDocuments")}
          </Button>
        )}
      </div>

      <Tabs defaultValue="current">
        <TabsList>
          <TabsTrigger value="current" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            {t("admin.production.labels.currentVersions")}
          </TabsTrigger>
          <TabsTrigger value="archive" className="flex items-center gap-2">
            <Archive className="w-4 h-4" />
            {t("admin.production.labels.archive")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              {isLoading ? (
                <div className="h-32 flex items-center justify-center text-muted-foreground">
                  {t("common.loading")}
                </div>
              ) : templates && templates.length > 0 ? (
                <div className="grid gap-4">
                  {templates.map((template: LabelTemplateAdminRow) => (
                    <div key={template.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-lg">
                            {template.product_name_key ? (translationsMap[template.product_name_key] ?? template.product_name ?? template.product_name_key) : template.product_name ?? "-"}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {t("admin.production.labels.version")}: {template.version} (
                            {template.version_date
                              ? new Date(template.version_date).toLocaleDateString()
                              : "-"}
                            )
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(template.status ?? "draft")}
                        </div>
                      </div>
                      <p className="text-sm mt-2 text-muted-foreground line-clamp-2">
                        {template.description_key ? (translationsMap[template.description_key] ?? template.description_key) : "-"}
                      </p>
                      <div className="flex gap-2 mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedLabel(template)}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          {t("common.view")}
                        </Button>
                        {template.label_pdf_url && (
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href={template.label_pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Download className="w-4 h-4 mr-1" />
                              {t("common.downloadPDF")}
                            </a>
                          </Button>
                        )}
                        {template.status === "active" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleArchive(template)}
                          >
                            <Archive className="w-4 h-4 mr-1" />
                            {t("admin.production.labels.archiveVersion")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t("admin.production.labels.noTemplates")}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="archive" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.production.labels.archivedVersions")}</CardTitle>
              <CardDescription>{t("admin.production.labels.archiveDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {archivedLabels && archivedLabels.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("admin.production.labels.product")}</TableHead>
                      <TableHead>{t("admin.production.labels.version")}</TableHead>
                      <TableHead>{t("admin.production.labels.archivedAt")}</TableHead>
                      <TableHead>{t("admin.production.labels.reason")}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {archivedLabels.map((label: LabelArchivePublicAdminRow) => (
                      <TableRow key={label.id}>
                        <TableCell>{label.product_name || "-"}</TableCell>
                        <TableCell className="font-mono">{label.version}</TableCell>
                        <TableCell>{new Date(label.archived_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{label.archive_reason || "-"}</Badge>
                        </TableCell>
                        <TableCell>
                          {label.pdf_url && (
                            <Button variant="ghost" size="sm" asChild>
                              <a href={label.pdf_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t("admin.production.labels.noArchived")}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Label Detail Dialog */}
      <Dialog open={!!selectedLabel} onOpenChange={(open) => !open && setSelectedLabel(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedLabel &&
                (selectedLabel.product_name_key ? (translationsMap[selectedLabel.product_name_key] ?? selectedLabel.product_name ?? selectedLabel.product_name_key) : selectedLabel.product_name ?? "-")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.production.labels.version")}: {selectedLabel?.version}
            </DialogDescription>
          </DialogHeader>
          {selectedLabel && (
            <div className="space-y-4">
              <div>
                <Label className="text-muted-foreground">
                  {t("admin.production.labels.description")}
                </Label>
                <p className="mt-1">
                  {selectedLabel.description_key ? (translationsMap[selectedLabel.description_key] ?? selectedLabel.description_key) : "-"}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">
                  {t("admin.production.labels.composition")}
                </Label>
                <p className="mt-1">
                  {selectedLabel.composition_key ? (translationsMap[selectedLabel.composition_key] ?? selectedLabel.composition_key) : "-"}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">
                  {t("admin.production.labels.usage")}
                </Label>
                <p className="mt-1">
                  {selectedLabel.usage_instructions_key ? (translationsMap[selectedLabel.usage_instructions_key] ?? selectedLabel.usage_instructions_key) : "-"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">
                    {t("admin.production.labels.manufacturer")}
                  </Label>
                  <p className="mt-1">{selectedLabel.manufacturer}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">
                    {t("admin.production.labels.registrationNumber")}
                  </Label>
                  <p className="mt-1">{selectedLabel.registration_number || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">
                    {t("admin.production.labels.countryOfOrigin")}
                  </Label>
                  <p className="mt-1">{selectedLabel.country_of_origin}</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
