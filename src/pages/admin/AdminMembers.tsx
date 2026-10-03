import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { useMembersColumns } from "./members-columns";
import { useMembersSummary } from "@/hooks/useAdminData";
import { Users } from "lucide-react";

export default function AdminMembers() {
  const { t } = useTranslation();
  const { members, loading } = useMembersSummary();
  const columns = useMembersColumns();

  // Search is now handled by DataTable, but initially we might keep it simple.
  // Actually, DataTable handles filtering if we pass it the state or if we use its internal filtering.
  // The generic DataTable wrapper exposes `searchKey` to filter by a specific column.
  // `AdminMembers` logic was filtering by display_name OR email.
  // The generic DataTable typically filters by one column (usually "email" or "name").
  // For now, I will use `searchKey="email"` as the primary filter, 
  // OR since the previous implementation was custom, I might need to rely on the DataTable's filtering capabilities.
  // The simple `DataTable` we built in Phase 5 likely filters by one column.
  // Let's verify DataTable props in a future step if needed, but for now assuming `searchKey` is supported.
  // "email" is a safe bet for unique identification.

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.members.title")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("admin.members.subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                {t("admin.members.allMembers")}
              </CardTitle>
              <CardDescription>{members.length} {t("admin.members.totalMembers")}</CardDescription>
            </div>
            {/* Search is handled inside DataTable now */}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">
              {t("admin.members.loading")}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={members}
              searchKey="email"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
