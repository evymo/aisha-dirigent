import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, MoreHorizontal, Pencil, Trash2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useAdminWebPages,
  useBrandingSites,
  useUpsertWebPage,
  useDeleteWebPage,
  type UpsertWebPageInput,
} from "@/hooks/useAdminWebPages";
import type { WebPageAdminList, BrandingSiteAdmin } from "@/lib/schemas/webPageSchemas";
import { DataTable } from "@/components/ui/data-table/DataTable";
import type { ColumnDef } from "@tanstack/react-table";
import { safeError } from "@/lib/security/safeLogger";

/** Sentinel value for the "all sites" filter / "global page" assignment. */
const GLOBAL_SITE = "__global__";

/**
 * Human label for a brand/site id (module-level pure helper — no hook, so it
 * adds no manual memo and is a stable reference for the columns memo).
 */
function formatSiteLabel(
  id: string | null,
  sites: BrandingSiteAdmin[],
  t: (key: string) => string,
): string {
  if (!id) return t("admin.pages.globalSite");
  const site = sites.find((s) => s.branding_profile_id === id);
  if (!site) return id;
  const name = site.operator_name ?? id;
  return site.hostnames.length > 0 ? `${name} (${site.hostnames[0]})` : name;
}

export default function AdminPages() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [siteFilter, setSiteFilter] = useState<string>(GLOBAL_SITE);
  const { sites: sitesRaw } = useBrandingSites();
  const sites = sitesRaw as unknown as BrandingSiteAdmin[];
  const { data, isLoading } = useAdminWebPages(
    siteFilter === GLOBAL_SITE ? null : siteFilter,
  );
  const pages = (data ?? []) as unknown as WebPageAdminList[];
  const upsertPage = useUpsertWebPage();
  const deletePage = useDeleteWebPage();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<WebPageAdminList | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    slug: "",
    title_key: "",
    description_key: "",
    sort_order: 0,
    is_active: true,
    og_image_url: "",
    branding_profile_id: null as string | null,
  });

  const resetForm = useCallback(() => {
    setFormData({
      slug: "",
      title_key: "",
      description_key: "",
      sort_order: 0,
      is_active: true,
      og_image_url: "",
      branding_profile_id: siteFilter === GLOBAL_SITE ? null : siteFilter,
    });
    setEditingPage(null);
  }, [siteFilter]);

  const openCreate = useCallback(() => {
    resetForm();
    setIsDialogOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((page: WebPageAdminList) => {
    setEditingPage(page);
    setFormData({
      slug: page.slug,
      title_key: page.title_key ?? "",
      description_key: page.description_key ?? "",
      sort_order: page.sort_order,
      is_active: page.is_active,
      og_image_url: "",
      branding_profile_id: page.branding_profile_id,
    });
    setIsDialogOpen(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!formData.slug.trim()) {
      toast.error(t("admin.pages.slugRequired"));
      return;
    }

    const input: UpsertWebPageInput = {
      slug: formData.slug.trim(),
      title_key: formData.title_key.trim() || undefined,
      description_key: formData.description_key.trim() || undefined,
      sort_order: formData.sort_order,
      og_image_url: formData.og_image_url.trim() || undefined,
      branding_profile_id: formData.branding_profile_id,
    };

    if (editingPage) {
      (input as UpsertWebPageInput & { id: string }).id = editingPage.id;
    }

    try {
      await upsertPage.mutateAsync(input);
      toast.success(
        editingPage
          ? t("admin.pages.updated")
          : t("admin.pages.created")
      );
      setIsDialogOpen(false);
      resetForm();
    } catch (error) {
      safeError("AdminPages.handleSubmit", error);
      toast.error(t("admin.pages.saveFailed"));
    }
  }, [formData, editingPage, upsertPage, t, resetForm]);

  const handleDelete = useCallback(async () => {
    if (!itemToDelete) return;
    try {
      await deletePage.mutateAsync(itemToDelete);
      toast.success(t("admin.pages.deleted"));
    } catch (error) {
      safeError("AdminPages.handleDelete", error);
      toast.error(t("admin.pages.deleteFailed"));
    } finally {
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  }, [itemToDelete, deletePage, t]);

  const columns = useMemo<ColumnDef<WebPageAdminList>[]>(
    () => [
      {
        accessorKey: "slug",
        header: t("admin.pages.colSlug"),
        cell: ({ row }) => {
          // ⛔ ÚTRŽEK VYPADÁ JAKO STRÁNKA, ale nemá adresu — je to sdílený
          // obsah (hlavička, patička), který se vkládá do ostatních stránek
          // značkou `data-partial`. Bez odznaku by ho autor viděl ve výpisu
          // stránek a marně zkoušel navštívit /nav/.
          //
          // Zobrazuje se syrová hodnota z dat, ne přeložený text — týž postup
          // jako u odznaku `status` níž, takže nepřibývá klíč, který by musel
          // někdo udržovat v šesti jazycích.
          const role = (row.original.page_settings as { role?: string } | null)?.role;
          return (
            <span className="flex items-center gap-2">
              <span className="font-mono text-sm">{row.original.slug}</span>
              {role === "partial" && <Badge variant="outline">{role}</Badge>}
            </span>
          );
        },
      },
      {
        accessorKey: "title_key",
        header: t("admin.pages.colTitle"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.title_key ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "branding_profile_id",
        header: t("admin.pages.colSite"),
        cell: ({ row }) => (
          <Badge variant={row.original.branding_profile_id ? "secondary" : "outline"}>
            {formatSiteLabel(row.original.branding_profile_id, sites, t)}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: t("admin.pages.colStatus"),
        cell: ({ row }) => (
          <Badge variant={row.original.status === "published" ? "default" : "secondary"}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: "sort_order",
        header: t("admin.pages.colOrder"),
      },
      {
        accessorKey: "is_active",
        header: t("admin.pages.colActive"),
        cell: ({ row }) => (
          <Badge variant={row.original.is_active ? "default" : "outline"}>
            {row.original.is_active ? t("common.yes") : t("common.no")}
          </Badge>
        ),
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate(`/admin/pages/${row.original.id}/edit`)}>
                <Pencil className="h-4 w-4 mr-2" />
                {t("admin.pages.editCanvas")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openEdit(row.original)}>
                <FileText className="h-4 w-4 mr-2" />
                {t("admin.pages.editMeta")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  setItemToDelete(row.original.id);
                  setDeleteDialogOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [t, navigate, openEdit, sites]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("admin.pages.title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={siteFilter} onValueChange={setSiteFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder={t("admin.pages.filterSite")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GLOBAL_SITE}>{t("admin.pages.allSites")}</SelectItem>
                {sites.map((site) => (
                  <SelectItem key={site.branding_profile_id} value={site.branding_profile_id}>
                    {formatSiteLabel(site.branding_profile_id, sites, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("admin.pages.addPage")}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>
                  {editingPage
                    ? t("admin.pages.editTitle")
                    : t("admin.pages.createTitle")}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="branding_profile_id">{t("admin.pages.site")}</Label>
                  <Select
                    value={formData.branding_profile_id ?? GLOBAL_SITE}
                    onValueChange={(value) =>
                      setFormData((prev) => ({
                        ...prev,
                        branding_profile_id: value === GLOBAL_SITE ? null : value,
                      }))
                    }
                    disabled={!!editingPage}
                  >
                    <SelectTrigger id="branding_profile_id">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={GLOBAL_SITE}>{t("admin.pages.globalSite")}</SelectItem>
                      {sites.map((site) => (
                        <SelectItem key={site.branding_profile_id} value={site.branding_profile_id}>
                          {formatSiteLabel(site.branding_profile_id, sites, t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">{t("admin.pages.slug")}</Label>
                  <Input
                    id="slug"
                    value={formData.slug}
                    onChange={(e) => setFormData((prev) => ({ ...prev, slug: e.target.value }))}
                    placeholder={t("admin.pages.slugPlaceholder")}
                    disabled={!!editingPage}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="title_key">{t("admin.pages.titleKey")}</Label>
                  <Input
                    id="title_key"
                    value={formData.title_key}
                    onChange={(e) => setFormData((prev) => ({ ...prev, title_key: e.target.value }))}
                    placeholder={t("admin.pages.titleKeyPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description_key">{t("admin.pages.descKey")}</Label>
                  <Input
                    id="description_key"
                    value={formData.description_key}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, description_key: e.target.value }))
                    }
                    placeholder={t("admin.pages.descKeyPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sort_order">{t("admin.pages.sortOrder")}</Label>
                  <Input
                    id="sort_order"
                    type="number"
                    value={formData.sort_order}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, sort_order: Number(e.target.value) }))
                    }
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({ ...prev, is_active: checked }))
                    }
                  />
                  <Label htmlFor="is_active">{t("admin.pages.active")}</Label>
                </div>
              </div>
              <Button
                onClick={() => void handleSubmit()}
                disabled={upsertPage.isPending}
                className="w-full"
              >
                {upsertPage.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingPage ? t("common.save") : t("common.create")}
              </Button>
            </DialogContent>
          </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <DataTable columns={columns} data={pages} searchKey="slug" />
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.pages.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.pages.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
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
