import { ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Trash2, Image } from "lucide-react";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { HeroSlideAdmin } from "@/hooks/useAdminHeroSlides";

interface HeroSlideColumnResolvers {
  resolvePrimary: (slide: HeroSlideAdmin) => string;
  resolveSecondary: (slide: HeroSlideAdmin) => string;
  resolveImageAlt?: (slide: HeroSlideAdmin) => string;
}

export const useHeroSlideColumns = (
  onEdit: (slide: HeroSlideAdmin) => void,
  onDelete: (id: string) => void,
  resolvers: HeroSlideColumnResolvers
): ColumnDef<HeroSlideAdmin>[] => {
  const { t } = useTranslation();
  const resolvePrimary = resolvers.resolvePrimary;
  const resolveSecondary = resolvers.resolveSecondary;

  return [
    {
      accessorKey: "background_image_url",
      header: t("admin.heroSlides.table.image"),
      cell: ({ row }) => {
        const url = row.original.background_image_url;
        const altText =
          resolvers.resolveImageAlt?.(row.original) ||
          resolvePrimary(row.original) ||
          row.original.title_key;
        return url ? (
          <img
            src={url}
            alt={altText}
            className="h-10 w-16 object-cover rounded border border-border"
          />
        ) : (
          <div className="h-10 w-16 bg-muted rounded flex items-center justify-center border border-border">
            <Image className="h-4 w-4 text-muted-foreground" />
          </div>
        );
      },
    },
    {
      id: "title",
      accessorFn: (row) => resolvePrimary(row),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.heroSlides.table.title")} />
      ),
      cell: ({ row }) => (
        <div className="flex flex-col max-w-[300px]">
          <span className="font-medium truncate">
            {resolvePrimary(row.original) || row.original.title_key}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {resolveSecondary(row.original)}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "target_audience",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.heroSlides.table.audience")} />
      ),
      cell: ({ row }) => (
        <Badge variant="outline">
          {t(`admin.heroSlides.audiences.${row.original.target_audience}`)}
        </Badge>
      ),
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id));
      },
    },
    {
      accessorKey: "linked_product_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.heroSlides.table.product")} />
      ),
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.linked_product_name || <span className="text-muted-foreground">—</span>}
        </span>
      ),
    },
    {
      accessorKey: "sort_order",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("admin.heroSlides.table.order")} />
      ),
      cell: ({ row }) => (
        <div className="font-mono text-center w-10">
          {row.original.sort_order}
        </div>
      ),
    },
    {
      accessorKey: "is_active",
      header: t("admin.heroSlides.table.status"),
      cell: ({ row }) =>
        row.original.is_active ? (
          <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20 shadow-none border-0">
            {t("admin.heroSlides.active")}
          </Badge>
        ) : (
          <Badge variant="secondary">
            {t("admin.heroSlides.inactive")}
          </Badge>
        ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const slide = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">{t("common.openMenu")}</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("common.actions")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onEdit(slide)}>
                <Pencil className="mr-2 h-4 w-4" />
                {t("common.edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(slide.id)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
};
