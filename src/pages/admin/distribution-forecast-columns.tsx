import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTableColumnHeader } from "@/components/ui/data-table/DataTableColumnHeader";
import { ForecastData } from "@/hooks/useAdminDistributionForecast";
import {
    Package
} from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

const PRODUCTION_STATUSES = ['planning', 'reserved', 'in_production', 'ready', 'distributed'];

const STATUS_COLORS: Record<string, string> = {
    planning: 'bg-gray-100 text-gray-800',
    reserved: 'bg-blue-100 text-blue-800',
    in_production: 'bg-yellow-100 text-yellow-800',
    ready: 'bg-green-100 text-green-800',
    distributed: 'bg-purple-100 text-purple-800',
};

export const getForecastColumns = (
    t: (key: string, options?: Record<string, string | number>) => string,
    onStatusChange: (forecastId: string, newStatus: string) => void,
    formatCurrency: (amount: number, currencyCode?: string) => string
): ColumnDef<ForecastData>[] => {
    return [
        {
            accessorKey: "product_name",
            header: t("admin.distributionForecast.table.product"),
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{row.original.product_name || t("common.placeholderHyphen")}</span>
                </div>
            ),
        },
        {
            id: "study",
            header: t("admin.distributionForecast.table.study"),
            cell: ({ row }) => row.original.study_name ? (
                <div>
                    <div className="font-medium">{row.original.study_name}</div>
                    <div className="text-xs text-muted-foreground">{row.original.study_code}</div>
                </div>
            ) : (
                <span className="text-muted-foreground">{t("admin.distributionForecast.noStudy")}</span>
            ),
        },
        {
            accessorKey: "total_members",
            header: () => (
                <div className="text-center">
                    {t("admin.distributionForecast.table.members")}
                </div>
            ),
            cell: ({ row }) => (
                <div className="text-center">
                    <Badge variant="outline">{row.original.total_members}</Badge>
                </div>
            ),
        },
        {
            accessorKey: "vip_members",
            header: () => (
                <div className="text-center">
                    {t("admin.distributionForecast.table.vipMembers")}
                </div>
            ),
            cell: ({ row }) => (
                <div className="text-center">
                    {row.original.vip_members > 0 ? (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                            {row.original.vip_members} {t("common.vip")}
                        </Badge>
                    ) : (
                        <span className="text-muted-foreground">{t("common.placeholderHyphen")}</span>
                    )}
                </div>
            ),
        },
        {
            accessorKey: "required_packages",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={t("admin.distributionForecast.table.packages")} className="justify-center" />
            ),
            cell: ({ row }) => (
                <div className="text-center">
                    <div className="font-bold text-lg">{row.original.required_packages}</div>
                </div>
            ),
        },
        {
            id: "deviation",
            header: () => (
                <div className="text-center">{t("admin.distributionForecast.table.deviation")}</div>
            ),
            cell: ({ row }) => {
                const forecast = row.original;
                return (
                    <div className="text-center">
                        {forecast.deviation_sample_size > 0 ? (
                            <div className="flex flex-col items-center">
                                <Badge
                                    variant="outline"
                                    className={forecast.reported_deviation_percent > 10 ? 'border-destructive text-destructive' :
                                        forecast.reported_deviation_percent < -10 ? 'border-green-500 text-green-600' : ''}
                                >
                                    {forecast.reported_deviation_percent > 0 ? '+' : ''}{forecast.reported_deviation_percent.toFixed(1)}%
                                </Badge>
                                <span className="text-xs text-muted-foreground mt-1">
                                    {t("admin.distributionForecast.deviationSampleSize", { n: forecast.deviation_sample_size })}
                                </span>
                            </div>
                        ) : (
                            <span className="text-muted-foreground text-xs">{t("admin.distributionForecast.noData")}</span>
                        )}
                    </div>
                );
            }
        },
        {
            accessorKey: "compensated_value",
            header: () => (
                <div className="text-right">{t("admin.distributionForecast.table.value")}</div>
            ),
            cell: ({ row }) => (
                <div className="text-right">
                    {row.original.compensated_value > 0 ? (
                        <span className="font-medium text-green-600">
                            {formatCurrency(row.original.compensated_value)}
                        </span>
                    ) : (
                        <span className="text-muted-foreground">{t("common.placeholderHyphen")}</span>
                    )}
                </div>
            ),
        },
        {
            accessorKey: "production_status",
            header: t("admin.distributionForecast.table.status"),
            cell: ({ row }) => (
                <Select
                    value={row.original.production_status}
                    onValueChange={(value) => onStatusChange(row.original.id, value)}
                >
                    <SelectTrigger className="w-[150px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {PRODUCTION_STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                                <Badge className={STATUS_COLORS[status]}>
                                    {t(`admin.distributionForecast.status.${status}`)}
                                </Badge>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            ),
        },
    ];
};
