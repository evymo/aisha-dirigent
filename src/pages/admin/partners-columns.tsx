import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { PartnerProfileAdmin, useTogglePartnerVisibility, useRevokePartnerCertification, useDeletePartnerProfile } from "@/hooks/useAdminPartners";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { format } from "date-fns";
import {
    Building,
    User,
    MapPin,
    Mail,
    Phone,
    Award,
    MoreHorizontal,
    Trash2,
    ShieldX
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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

// --- Interactive Components ---

function PartnerVisibilitySwitch({ partner }: { partner: PartnerProfileAdmin }) {
    const { t } = useTranslation();
    const toggleVisibilityMutation = useTogglePartnerVisibility();

    const handleToggle = async (checked: boolean) => {
        try {
            await toggleVisibilityMutation.mutateAsync({ partnerId: partner.id, isVisible: checked });
            toast.success(t("admin.partners.visibilityUpdated"), {
                description: checked
                    ? t("admin.partners.nowVisible")
                    : t("admin.partners.nowHidden"),
            });
        } catch {
            toast.error(t("common.error"), {
                description: t("admin.partners.updateFailed"),
            });
        }
    };

    return (
        <Switch
            checked={partner.is_visible}
            onCheckedChange={handleToggle}
        />
    );
}

function PartnerActions({ partner }: { partner: PartnerProfileAdmin }) {
    const { t } = useTranslation();
    const [confirmDialog, setConfirmDialog] = useState<{
        open: boolean;
        type: "revoke" | "delete";
    }>({ open: false, type: "revoke" });

    const revokeCertificationMutation = useRevokePartnerCertification();
    const deletePartnerMutation = useDeletePartnerProfile();

    const handleRevoke = async () => {
        try {
            await revokeCertificationMutation.mutateAsync(partner.id);
            toast.success(t("admin.partners.certificationRevoked"), {
                description: t("admin.partners.certificationRevokedDesc"),
            });
        } catch {
            toast.error(t("common.error"), {
                description: t("admin.partners.updateFailed"),
            });
        } finally {
            setConfirmDialog({ ...confirmDialog, open: false });
        }
    };

    const handleDelete = async () => {
        try {
            await deletePartnerMutation.mutateAsync(partner.id);
            toast.success(t("admin.partners.partnerDeleted"), {
                description: t("admin.partners.partnerDeletedDesc"),
            });
        } catch {
            toast.error(t("common.error"), {
                description: t("admin.partners.updateFailed"),
            });
        } finally {
            setConfirmDialog({ ...confirmDialog, open: false });
        }
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {partner.certification_score !== null && (
                        <DropdownMenuItem
                            onClick={() => setConfirmDialog({ open: true, type: "revoke" })}
                            className="text-amber-500 focus:text-amber-500"
                        >
                            <ShieldX className="h-4 w-4 mr-2" />
                            {t("admin.partners.revokeCertification")}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onClick={() => setConfirmDialog({ open: true, type: "delete" })}
                        className="text-destructive focus:text-destructive"
                    >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t("admin.partners.deletePartner")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(p => ({ ...p, open }))}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {confirmDialog.type === "revoke"
                                ? t("admin.partners.revokeTitle")
                                : t("admin.partners.deleteTitle")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmDialog.type === "revoke"
                                ? t("admin.partners.revokeDescription", { name: partner.display_name })
                                : t("admin.partners.deleteDescription", { name: partner.display_name })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDialog.type === "revoke" ? handleRevoke : handleDelete}
                            className={confirmDialog.type === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
                        >
                            {confirmDialog.type === "revoke"
                                ? t("admin.partners.confirmRevoke")
                                : t("admin.partners.confirmDelete")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

// --- Columns ---

export const usePartnersColumns = (): ColumnDef<PartnerProfileAdmin>[] => {
    const { t } = useTranslation();

    return [
    {
        accessorKey: "display_name",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.partners.table.name")} />;
        },
        cell: ({ row }) => {
            const partner = row.original;
            return (
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        {partner.is_production_provider ? (
                            <Building className="h-5 w-5 text-primary" />
                        ) : (
                            <User className="h-5 w-5 text-primary" />
                        )}
                    </div>
                    <div>
                        <p className="font-medium">{partner.display_name}</p>
                        {partner.business_name && (
                            <p className="text-sm text-muted-foreground">{partner.business_name}</p>
                        )}
                    </div>
                </div>
            );
        },
    },
    {
        accessorKey: "is_production_provider",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.partners.table.type")} />;
        },
        cell: ({ row }) => {
            const isProvider = row.original.is_production_provider;
            return (
                <Badge variant={isProvider ? "default" : "secondary"}>
                    {isProvider ? t("admin.partners.typeProvider") : t("admin.partners.typeIndividual")}
                </Badge>
            );
        },
    },
    {
        accessorKey: "city",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.partners.table.location")} />;
        },
        cell: ({ row }) => {
            const partner = row.original;
            return (
                <div className="flex items-center gap-1 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    {partner.city}, {partner.country}
                </div>
            );
        },
    },
    {
        id: "contact",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.partners.table.contact")} />;
        },
        cell: ({ row }) => {
            const partner = row.original;
            return (
                <div className="space-y-1">
                    {partner.email && (
                        <div className="flex items-center gap-1 text-sm">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            <span className="truncate max-w-[150px]">{partner.email}</span>
                        </div>
                    )}
                    {partner.phone && (
                        <div className="flex items-center gap-1 text-sm">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            {partner.phone}
                        </div>
                    )}
                </div>
            );
        }
    },
    {
        accessorKey: "certification_score",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.partners.table.score")} />;
        },
        cell: ({ row }) => {
            const score = row.original.certification_score;
            if (score === null) return null;
            return (
                <div className="flex items-center gap-1">
                    <Award className="h-4 w-4 text-amber-500" />
                    <span className="font-medium">{score}%</span>
                </div>
            );
        },
    },
    {
        accessorKey: "created_at",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.partners.table.joined")} />;
        },
        cell: ({ row }) => {
            return <span className="text-sm text-muted-foreground">{format(new Date(row.original.created_at), "d.M.yyyy")}</span>;
        },
    },
    {
        accessorKey: "is_visible",
        header: ({ column }) => {
            return <DataTableColumnHeader column={column} title={t("admin.partners.table.visible")} className="text-center" />;
        },
        cell: ({ row }) => <div className="flex justify-center"><PartnerVisibilitySwitch partner={row.original} /></div>,
    },
    {
        id: "actions",
        cell: ({ row }) => <PartnerActions partner={row.original} />,
    }
];
};
