import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type Invitation, useInvitations } from "@/hooks/useInvitations";
import { useStudies } from "@/hooks/useStudies";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Loader2 } from "lucide-react";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { useInvitationColumns } from "./invitations-columns";

export default function Invitations() {
  const { t } = useTranslation();
  const { invitations, isLoading, createInvitation, toggleInvitation } = useInvitations();
  const { studies } = useStudies();
  const { hasPermission } = usePermissions();
  const canManageUsers = hasPermission("manage_users");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newInvite, setNewInvite] = useState({
    code: "",
    study_id: "null",
    role: "null",
    max_uses: "",
    email: "",
  });

  const handleCreate = async () => {
    try {
      await createInvitation.mutateAsync({
        study_id: newInvite.study_id === "null" ? null : newInvite.study_id,
        role: newInvite.role === "null" ? null : newInvite.role,
        max_uses: newInvite.max_uses ? Math.max(1, parseInt(newInvite.max_uses, 10)) : null,
        email: newInvite.email || null,
        ...(newInvite.code.trim() ? { code: newInvite.code } : {}),
      });
      setIsCreateOpen(false);
      setNewInvite({ code: "", study_id: "null", role: "null", max_uses: "", email: "" });
      toast(t("invitations.created"));
    } catch {
      toast.error(t("common.error"), { description: t("common.tryAgain") });
    }
  };

  const copyLink = (code: string) => {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      toast.error(t("common.error"), { description: t("common.tryAgain") });
      return;
    }

    if (!navigator.clipboard?.writeText) {
      toast.error(t("common.error"), { description: t("common.tryAgain") });
      return;
    }

    const url = `${window.location.origin}/invite/${code}`;
    navigator.clipboard
      .writeText(url)
      .then(() => toast(t("common.copied")))
      .catch(() => toast.error(t("common.error"), { description: t("common.tryAgain") }));
  };

  const sendEmail = (invite: Invitation) => {
    if (!invite.email) return;
    if (typeof window === "undefined") {
      toast.error(t("common.error"), { description: t("common.tryAgain") });
      return;
    }

    const url = `${window.location.origin}/invite/${invite.code}`;
    const subject = t("invitations.email_subject");
    const body = t("invitations.email_body", { url });
    window.location.href = `mailto:${invite.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; // external mailto
  };

  const handleToggle = (id: string, active: boolean) => {
    toggleInvitation.mutate({ id, is_active: active });
  };

  const columns = useInvitationColumns(copyLink, sendEmail, handleToggle);

  if (isLoading) return <Loader2 className="h-8 w-8 animate-spin" />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">{t("invitations.title")}</h1>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> {t("invitations.create")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("invitations.create_new")}</DialogTitle>
              <DialogDescription>{t("invitations.code_hint")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t("invitations.code")}</Label>
                <Input
                  placeholder={t("invitations.code_placeholder")}
                  value={newInvite.code}
                  onChange={(e) => setNewInvite({ ...newInvite, code: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">{t("invitations.leave_empty_for_auto")}</p>
              </div>
              <div>
                <Label>
                  {t("invitations.email")} ({t("common.optional")})
                </Label>
                <Input
                  type="email"
                  placeholder={t("invitations.email_placeholder")}
                  value={newInvite.email}
                  onChange={(e) => setNewInvite({ ...newInvite, email: e.target.value })}
                />
              </div>
              <div>
                <Label>{t("invitations.study")}</Label>
                <Select value={newInvite.study_id} onValueChange={(v) => setNewInvite({ ...newInvite, study_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("invitations.select_study")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="null">{t("common.none")}</SelectItem>
                    {studies?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("invitations.role")}</Label>
                <Select value={newInvite.role} onValueChange={(v) => setNewInvite({ ...newInvite, role: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("invitations.select_role")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="null">{t("common.none")}</SelectItem>
                    <SelectItem value="member">{t("admin.roles.roleTypes.member")}</SelectItem>
                    {canManageUsers && (
                      <>
                        <SelectItem value="practitioner">{t("admin.roles.roleTypes.practitioner")}</SelectItem>
                        <SelectItem value="staff">{t("admin.roles.roleTypes.staff")}</SelectItem>
                        <SelectItem value="admin">{t("admin.roles.roleTypes.admin")}</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("invitations.max_uses")}</Label>
                <Input
                  type="number"
                  value={newInvite.max_uses}
                  onChange={(e) => setNewInvite({ ...newInvite, max_uses: e.target.value })}
                />
              </div>
              <Button onClick={handleCreate} className="w-full" disabled={createInvitation.isPending}>
                {createInvitation.isPending ? t("common.loading") : t("common.create")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border rounded-lg">
        <DataTable
          columns={columns}
          data={invitations || []}
          searchKey="code"
        />
      </div>
    </div>
  );
}
