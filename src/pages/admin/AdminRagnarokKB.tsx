import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Upload, Loader2, Database, Trash2, AlertCircle, RefreshCw } from "lucide-react";
import {
  useRagnarokKBList,
  useRagnarokUpload,
  useRagnarokDelete,
} from "@/hooks/useRagnarokKB";

export default function AdminRagnarokKB() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [kbToDelete, setKbToDelete] = useState<string | null>(null);
  const [targetKbId, setTargetKbId] = useState("");

  const { data: knowledgeBases = [], isLoading, isError, refetch } = useRagnarokKBList();
  const uploadMutation = useRagnarokUpload();
  const deleteMutation = useRagnarokDelete();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    uploadMutation.mutate({
      file,
      kb_id: targetKbId || undefined,
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDeleteClick = (kbId: string) => {
    setKbToDelete(kbId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (kbToDelete) {
      deleteMutation.mutate(
        { kb_id: kbToDelete },
        {
          onSuccess: () => {
            setDeleteDialogOpen(false);
            setKbToDelete(null);
          },
        },
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-serif">
            {t("admin.ragnarokKb.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("admin.ragnarokKb.subtitle")}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.ragnarokKb.uploadTitle")}</CardTitle>
          <CardDescription>{t("admin.ragnarokKb.uploadDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">
                {t("admin.ragnarokKb.targetKbId")}
              </label>
              <Input
                placeholder={t("admin.ragnarokKb.targetKbIdPlaceholder")}
                value={targetKbId}
                onChange={(e) => setTargetKbId(e.target.value)}
              />
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt,.md,.csv"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                {t("admin.ragnarokKb.uploadButton")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            {t("admin.ragnarokKb.listTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{t("admin.ragnarokKb.loading")}</span>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center" role="alert">
              <AlertCircle className="w-6 h-6 text-destructive" />
              <p className="text-sm text-muted-foreground">
                {t("admin.ragnarokKb.loadError")}
              </p>
              <Button variant="outline" onClick={() => void refetch()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                {t("admin.ragnarokKb.retry")}
              </Button>
            </div>
          ) : knowledgeBases.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t("admin.ragnarokKb.empty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.ragnarokKb.columnKbId")}</TableHead>
                  <TableHead>{t("admin.ragnarokKb.columnProject")}</TableHead>
                  <TableHead>{t("admin.ragnarokKb.columnDocs")}</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {knowledgeBases.map((kb) => (
                  <TableRow key={kb.kb_id}>
                    <TableCell className="font-mono text-sm">{kb.kb_id}</TableCell>
                    <TableCell>{kb.project_id}</TableCell>
                    <TableCell>{kb.document_count ?? "—"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteClick(kb.kb_id)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.ragnarokKb.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.ragnarokKb.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
