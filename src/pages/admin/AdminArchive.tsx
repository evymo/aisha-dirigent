import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Plus, Loader2, Archive } from "lucide-react";
import {
  useArchiveDocumentsAdmin,
  useDeleteArchiveDocument,
} from "@/hooks/useArchiveAdmin";
import type { AdminArchiveDocument } from "@/lib/schemas/adminSchemas";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { useArchiveColumns } from "./archive-columns";
import { ArchiveDocumentFormDialog } from "./archive";

export default function AdminArchive() {
  const { t } = useTranslation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AdminArchiveDocument | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const { data: documents = [], isLoading } = useArchiveDocumentsAdmin();
  const deleteMutation = useDeleteArchiveDocument();

  const handleEdit = (item: AdminArchiveDocument) => {
    setEditingItem(item);
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (id: string) => {
    setItemToDelete(id);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (itemToDelete) {
      deleteMutation.mutate(itemToDelete, {
        onSuccess: () => {
          setDeleteDialogOpen(false);
          setItemToDelete(null);
        },
      });
    }
  };

  const handleFormSuccess = () => {
    setEditingItem(null);
    setIsDialogOpen(false);
  };

  const columns = useArchiveColumns(handleEdit, handleDeleteClick);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-serif">{t("admin.archive.title")}</h1>
          <p className="text-muted-foreground">{t("admin.archive.subtitle")}</p>
        </div>
        <Button
          onClick={() => {
            setEditingItem(null);
            setIsDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t("admin.archive.addDocument")}
        </Button>
      </div>

      <ArchiveDocumentFormDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        editingItem={editingItem}
        onSuccess={handleFormSuccess}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            {t("admin.archive.allDocuments")}
          </CardTitle>
          <CardDescription>{t("admin.archive.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={documents} searchKey="title" />
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.areYouSure")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.archive.deleteWarning")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

