import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@/hooks/useSession";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package } from "lucide-react";
import {
  useProductsAdmin,
  useDeleteProduct,
  type ProductAdmin,
} from "@/hooks/useAdminProducts";
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
  LOCALE_LABELS,
  type LocaleCode,
} from "@/hooks/useDynamicTranslations";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { useProductColumns } from "./products-columns";
import { useSupportedLanguages } from "@/hooks/useSupportedLanguages";
import { toast } from "sonner";
import { ProductFormDialog, DeleteProductDialog } from "./products";

export default function AdminProducts() {
  const { t } = useTranslation();
  const { user, isLoading: sessionLoading } = useSession();
  const { data: supportedLanguages = [] } = useSupportedLanguages();

  const activeLanguages = useMemo(
    () => supportedLanguages.filter((lang) => lang.is_active === true),
    [supportedLanguages]
  );

  const isSupportedLocale = (code: string): code is SupportedLocale =>
    (SUPPORTED_LOCALES as readonly string[]).includes(code);

  const activeLocales = useMemo(() => {
    const codes = activeLanguages
      .map((lang) => lang.code)
      .filter(isSupportedLocale);
    return codes.length > 0 ? codes : [...SUPPORTED_LOCALES];
  }, [activeLanguages]);

  const localeLabels = useMemo(() => {
    const labels: Record<LocaleCode, string> = { ...LOCALE_LABELS };
    activeLanguages.forEach((lang) => {
      if (isSupportedLocale(lang.code)) {
        labels[lang.code] = lang.name_native || lang.name_key || labels[lang.code];
      }
    });
    return labels;
  }, [activeLanguages]);

  const defaultLocale = useMemo<SupportedLocale>(() => {
    const preferred = activeLanguages.find((lang) => lang.is_default === true);
    if (preferred && isSupportedLocale(preferred.code)) {
      return preferred.code;
    }
    return "en";
  }, [activeLanguages]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductAdmin | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);

  const { data: products, isLoading } = useProductsAdmin(!!user && !sessionLoading);
  const deleteMutation = useDeleteProduct();

  const handleEdit = (product: ProductAdmin) => {
    setEditingProduct(product);
    setIsDialogOpen(true);
  };

  const handleFormSuccess = () => {
    setEditingProduct(null);
    setIsDialogOpen(false);
  };

  const requestDelete = (id: string) => {
    setProductToDelete(id);
    setDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!productToDelete) return;
    try {
      await deleteMutation.mutateAsync(productToDelete);
      toast.success(t("admin.products.deleted"));
      setDeleteConfirmOpen(false);
      setProductToDelete(null);
    } catch {
      toast.error(t("admin.products.errors.deleteFailed"));
    }
  };

  const columns = useProductColumns(handleEdit, requestDelete);
  void t("admin.products.form.jsonPlaceholder");

  if (sessionLoading || isLoading) {
    return <div className="p-6">{t("common.loading")}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("admin.products.title")}</h1>
          <p className="text-muted-foreground">{t("admin.products.subtitle")}</p>
        </div>
        <ProductFormDialog
          activeLocales={activeLocales}
          defaultLocale={defaultLocale}
          editingProduct={editingProduct}
          localeLabels={localeLabels}
          onOpenChange={setIsDialogOpen}
          onSuccess={handleFormSuccess}
          open={isDialogOpen}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t("admin.products.allProducts")} ({products?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={products || []} searchKey="name" />
        </CardContent>
      </Card>

      <DeleteProductDialog
        onConfirm={() => void handleDelete()}
        onOpenChange={setDeleteConfirmOpen}
        open={deleteConfirmOpen}
      />
    </div>
  );
}
